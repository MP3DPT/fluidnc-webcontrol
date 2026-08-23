import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import {
  parseAlarm,
  parseError,
  parseProbeResult,
  parseStatusReport,
} from './status-parser.js';
import type { PortInfo, ProbeResult, StatusReport } from './types.js';

const STATUS_POLL_MS = 200; // 5 Hz
const DEFAULT_BAUD = 115200;

// Real-time commands are single bytes sent outside the line-based command
// queue - FluidNC/Grbl act on them immediately, no "ok" reply is expected.
const REALTIME = {
  STATUS_QUERY: '?',
  CYCLE_START: '~',
  FEED_HOLD: '!',
  SOFT_RESET: '\x18', // Ctrl-X
  JOG_CANCEL: '\x85',
} as const;

interface PendingCommand {
  line: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Owns a single serial connection to a FluidNC controller and speaks its
 * Grbl-derived line protocol.
 *
 * Streaming safety: FluidNC only has room for one unacknowledged line at a
 * time in this implementation (a "send one, wait for ok/error" queue). This
 * is the simple, conservative version of the Grbl streaming protocol - it's
 * slower than character-counting streaming, but it can never overrun the
 * controller's planner buffer, which is the class of bug that has bitten
 * other senders when paired with FluidNC's exact response format.
 */
export class FluidNCConnection extends EventEmitter {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private queue: PendingCommand[] = [];
  private pending: PendingCommand | null = null;
  private receivedWelcome = false;

  static async listPorts(): Promise<PortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      serialNumber: p.serialNumber,
    }));
  }

  get isOpen(): boolean {
    return this.port?.isOpen ?? false;
  }

  connect(path: string, baud: number = DEFAULT_BAUD): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.port) {
        reject(new Error('Already connected - disconnect first'));
        return;
      }

      this.receivedWelcome = false;
      const port = new SerialPort({ path, baudRate: baud, autoOpen: false });

      port.open((err) => {
        if (err) {
          reject(err);
          return;
        }

        this.port = port;
        this.parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
        this.parser.on('data', (line: string) => this.handleLine(line));

        port.on('close', () => this.handleClose());
        port.on('error', (e) => this.emit('portError', e));

        this.pollTimer = setInterval(() => this.requestStatus(), STATUS_POLL_MS);
        this.emit('open', { path, baud });
        resolve();
      });
    });
  }

  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (!this.port) {
        resolve();
        return;
      }
      this.port.close(() => resolve());
    });
  }

  private handleClose() {
    this.port = null;
    this.parser = null;
    this.queue.forEach((cmd) => cmd.reject(new Error('Connection closed')));
    this.queue = [];
    this.pending?.reject(new Error('Connection closed'));
    this.pending = null;
    this.emit('close');
  }

  private handleLine(rawLine: string) {
    const line = rawLine.trim();
    if (line.length === 0) return;

    this.emit('raw', line);

    const status = parseStatusReport(line);
    if (status) {
      this.emit('status', status satisfies StatusReport);
      return;
    }

    const probe = parseProbeResult(line);
    if (probe) {
      const result: ProbeResult = { ...probe, raw: line };
      this.emit('probeResult', result);
      return;
    }

    const alarmCode = parseAlarm(line);
    if (alarmCode !== null) {
      this.emit('alarm', alarmCode);
      this.failPending(new Error(`ALARM:${alarmCode}`));
      return;
    }

    if (line === 'ok') {
      this.resolvePending();
      return;
    }

    const errorCode = parseError(line);
    if (errorCode !== null) {
      this.failPending(new Error(`error:${errorCode}`));
      return;
    }

    if (line.startsWith('[')) {
      this.emit('feedback', line);
      return;
    }

    if (!this.receivedWelcome) {
      this.receivedWelcome = true;
      this.emit('welcome', line);
      return;
    }

    this.emit('message', line);
  }

  private resolvePending() {
    const cmd = this.pending;
    this.pending = null;
    cmd?.resolve();
    this.pump();
  }

  private failPending(err: Error) {
    const cmd = this.pending;
    this.pending = null;
    cmd?.reject(err);
    this.pump();
  }

  private pump() {
    if (this.pending || this.queue.length === 0 || !this.port) return;
    const next = this.queue.shift()!;
    this.pending = next;
    this.port.write(`${next.line}\n`);
  }

  /** Queues a line command and resolves once FluidNC replies "ok". */
  sendLine(line: string): Promise<void> {
    if (!this.port) return Promise.reject(new Error('Not connected'));
    return new Promise((resolve, reject) => {
      this.queue.push({ line, resolve, reject });
      this.pump();
    });
  }

  /** Sends a single real-time byte immediately, bypassing the command queue. */
  private sendRealtime(byte: string) {
    this.port?.write(byte);
  }

  requestStatus() {
    this.sendRealtime(REALTIME.STATUS_QUERY);
  }

  feedHold() {
    this.sendRealtime(REALTIME.FEED_HOLD);
  }

  cycleStart() {
    this.sendRealtime(REALTIME.CYCLE_START);
  }

  /**
   * Flushes FluidNC's own jog buffer immediately. "ok" for a $J= line means
   * the command was *accepted*, not that the move finished - holding a jog
   * key sends commands faster than the machine can execute them, so on key
   * release the controller keeps working through an accepted backlog for a
   * few seconds unless explicitly told to cancel it. This is that command.
   *
   * That alone leaves one gap: any jog lines still sitting in *our own*
   * software queue - typed faster than FluidNC could acknowledge them -
   * haven't reached the controller yet, so the cancel byte doesn't touch
   * them. Once the currently in-flight line's "ok" arrives, the queue would
   * otherwise happily send the next one, causing one extra jog after the
   * key was released. Drop those unsent queued lines here; the one command
   * already in flight is left alone; it was already truncated by the
   * cancel byte and its eventual "ok" is just bookkeeping, not more motion.
   */
  cancelJog() {
    this.queue.forEach((cmd) => cmd.reject(new Error('Jog cancelled')));
    this.queue = [];
    this.sendRealtime(REALTIME.JOG_CANCEL);
  }

  /**
   * Soft reset. Clears the queue and rejects any in-flight command - FluidNC
   * won't send "ok" for a line that was in progress when the reset byte
   * lands, so leaving it unsettled would hang whatever was awaiting it
   * forever (e.g. a program run stuck mid-line, silently blocking every
   * future run since its start handler never sees its promise settle).
   */
  softReset() {
    this.queue.forEach((cmd) => cmd.reject(new Error('Soft reset')));
    this.queue = [];
    this.pending?.reject(new Error('Soft reset'));
    this.pending = null;
    this.sendRealtime(REALTIME.SOFT_RESET);
  }

  unlock(): Promise<void> {
    return this.sendLine('$X');
  }

  home(): Promise<void> {
    return this.sendLine('$H');
  }

  /**
   * Incremental jog, one or more axes at once (diagonal jog sends X and Y
   * in the same $J= line). FluidNC/Grbl jog commands are cancellable
   * mid-move by sending a fresh jog or a status query with the jog-cancel
   * real-time byte (0x85) - not yet exposed here, add when the UI needs
   * continuous/press-and-hold jogging.
   */
  jog(deltas: { X?: number; Y?: number; Z?: number }, feedrate: number): Promise<void> {
    const words = (['X', 'Y', 'Z'] as const)
      .filter((axis) => deltas[axis] !== undefined && deltas[axis] !== 0)
      .map((axis) => `${axis}${deltas[axis]}`);
    if (words.length === 0) return Promise.resolve();
    return this.sendLine(`$J=G91 G21 ${words.join(' ')} F${feedrate}`);
  }

  /**
   * Probes toward the work in the given axis direction. Resolves once
   * FluidNC replies "ok" to the G38.2 line - listen for the 'probeResult'
   * event (emitted from the [PRB:...] feedback line) to get the actual
   * trigger position and whether contact was made.
   */
  probe(axis: 'X' | 'Y' | 'Z', distance: number, feedrate: number): Promise<void> {
    const sign = distance >= 0 ? '' : '-';
    const magnitude = Math.abs(distance);
    return this.sendLine(`G38.2 G91 ${axis}${sign}${magnitude} F${feedrate}`);
  }

  /**
   * Probes, then sets the work zero corrected for a touch plate's
   * thickness, then retracts clear of the plate. This is the actual
   * real-world touch-off workflow (plate sits on top of the material) -
   * a bare probe() alone would zero at the top of the plate, not the
   * material surface, which is off by exactly the plate thickness.
   *
   * At the moment of contact the tool is `plateThickness` above the true
   * work zero, so instead of zeroing the current position, we tell the
   * controller the current position IS `plateThickness` (G10 L20 P1) -
   * work zero then correctly lands on the material surface once retracted.
   */
  async probeAndZero(
    axis: 'X' | 'Y' | 'Z',
    distance: number,
    feedrate: number,
    plateThickness: number,
    retractDistance: number,
  ): Promise<ProbeResult> {
    const result = await new Promise<ProbeResult>((resolve, reject) => {
      this.once('probeResult', (r: ProbeResult) => resolve(r));
      this.probe(axis, distance, feedrate).catch(reject);
    });

    if (!result.success) {
      throw new Error('Probe did not make contact within max travel');
    }

    const thicknessSign = plateThickness >= 0 ? '' : '-';
    await this.sendLine(`G10 L20 P1 ${axis}${thicknessSign}${Math.abs(plateThickness)}`);

    if (retractDistance !== 0) {
      // Retract opposite to the direction the probe travelled to trigger.
      const retractValue = (distance >= 0 ? -1 : 1) * Math.abs(retractDistance);
      const retractSign = retractValue >= 0 ? '' : '-';
      await this.sendLine(`G91`);
      await this.sendLine(`G0 ${axis}${retractSign}${Math.abs(retractValue)}`);
      await this.sendLine('G90');
    }

    return result;
  }

  /**
   * Reads FluidNC's Grbl-compatible settings dump ($$) - each line looks
   * like "$110=2000.000" (X max rate). Used for time estimation so rapid
   * moves are timed against the machine's real configured limits instead
   * of a guess, with no separate calibration step needed.
   */
  getSettings(): Promise<Record<string, number>> {
    const collected: Record<string, number> = {};
    const onMessage = (line: string) => {
      const match = line.match(/^\$(\d+)\s*=\s*(-?[\d.]+)/);
      if (match) collected[`$${match[1]}`] = Number(match[2]);
    };
    this.on('message', onMessage);
    return this.sendLine('$$')
      .then(() => collected)
      .finally(() => this.off('message', onMessage));
  }
}
