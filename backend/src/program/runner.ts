import { EventEmitter } from 'node:events';
import type { FluidNCConnection } from '../serial/connection.js';

export type ProgramState = 'idle' | 'running' | 'paused' | 'complete' | 'stopped' | 'error';

export interface ProgramProgress {
  sent: number;
  total: number;
  line: string;
}

/** Strips G-code comments (";" to end of line, and "(...)" inline) and blank lines. */
function toLines(gcodeText: string): string[] {
  return gcodeText
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\(.*?\)/g, '').split(';')[0].trim())
    .filter((line) => line.length > 0);
}

/**
 * Streams a loaded G-code program through a FluidNCConnection, one line at a
 * time, reusing the connection's existing ack-gated queue (send, wait for
 * ok, send next) - so streaming inherits the same overrun-proof guarantee
 * as every other command. Pausing does not touch the queue at all; it just
 * blocks this runner from handing the *next* line to the connection, while
 * also sending a real feed-hold so any motion already in flight decelerates.
 */
export class ProgramRunner extends EventEmitter {
  private connection: FluidNCConnection;
  private lines: string[] = [];
  private index = 0;
  private state: ProgramState = 'idle';
  private resumeSignal: (() => void) | null = null;
  private runToken = 0;

  constructor(connection: FluidNCConnection) {
    super();
    this.connection = connection;
  }

  load(gcodeText: string, name: string) {
    // A running/paused run() loop is actively reading this.lines/this.index
    // between awaits - replacing them out from under it desyncs the loop's
    // notion of "current line" from what's actually loaded, so it keeps
    // sending lines from the new file at stale indices to a machine the UI
    // no longer shows as streaming. stop() (which zeroes runToken/index)
    // must happen first.
    if (this.state === 'running' || this.state === 'paused') {
      throw new Error('A program is currently running - stop it before loading a new file');
    }
    this.lines = toLines(gcodeText);
    this.index = 0;
    this.state = 'idle';
    this.emit('loaded', { name, total: this.lines.length });
  }

  getState() {
    return { state: this.state, sent: this.index, total: this.lines.length };
  }

  async run() {
    if (this.state === 'running') return;
    if (this.lines.length === 0) throw new Error('No program loaded');

    // run() always means "start from the beginning" - only resume() (via
    // the paused-loop signal below) continues mid-file. Without this, a
    // repeat run after a prior completion finds the index already at the
    // end, sends nothing, and immediately reports "complete" again.
    this.index = 0;
    this.state = 'running';
    const token = ++this.runToken;
    this.emit('programStatus', this.getState());

    for (; this.index < this.lines.length; this.index++) {
      if (token !== this.runToken) return; // superseded by stop() or a new run()

      if (this.resumeSignal) {
        await new Promise<void>((resolve) => {
          this.resumeSignal = resolve;
        });
        // stop() can resolve this same signal to unblock a paused loop -
        // re-check before acting on it, or we'd send one more line after stop.
        if (token !== this.runToken) return;
      }

      const line = this.lines[this.index];
      try {
        await this.connection.sendLine(line);
      } catch (err) {
        this.state = 'error';
        this.emit('programStatus', this.getState());
        this.emit('programError', err instanceof Error ? err.message : String(err));
        return;
      }

      this.emit('programProgress', { sent: this.index + 1, total: this.lines.length, line } satisfies ProgramProgress);
    }

    this.state = 'complete';
    this.emit('programStatus', this.getState());
  }

  pause() {
    if (this.state !== 'running') return;
    this.connection.feedHold();
    this.state = 'paused';
    // Setting resumeSignal to a placeholder marks "paused"; run() replaces it
    // with the real resolver on its next loop iteration.
    this.resumeSignal = () => {};
    this.emit('programStatus', this.getState());
  }

  resume() {
    if (this.state !== 'paused') return;
    this.connection.cycleStart();
    this.state = 'running';
    const signal = this.resumeSignal;
    this.resumeSignal = null;
    signal?.();
    this.emit('programStatus', this.getState());
  }

  stop() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.state = 'stopped';
    this.runToken++; // invalidate any in-flight run() loop
    // Unlike pause() - which preserves position for a deliberate resume -
    // stop() means abort. The next Run should start the job over, not
    // silently continue from an unverified mid-file position (this matters
    // most right after an emergency stop, where the physical position may
    // no longer be trustworthy without re-homing first).
    this.index = 0;
    const signal = this.resumeSignal;
    this.resumeSignal = null;
    signal?.();
    this.emit('programStatus', this.getState());
  }
}
