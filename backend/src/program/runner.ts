import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { FluidNCConnection } from '../serial/connection.js';
import type { StatusReport } from '../serial/types.js';
import { LastRunStore } from './lastRunStore.js';

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

  // Real job timing. Measured here rather than in the browser so a page
  // reload mid-cut loses nothing, and so the browser's clock (which can
  // disagree with a Pi that has no real-time clock) never matters: the
  // frontend only ever receives a duration, never a timestamp to compare.
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private pausedAt: number | null = null;
  private pausedMs = 0;

  private lastRunStore: LastRunStore;
  private programKey: string | null = null;
  private programName = '';

  constructor(connection: FluidNCConnection, lastRunStore: LastRunStore = new LastRunStore()) {
    super();
    this.connection = connection;
    this.lastRunStore = lastRunStore;
  }

  /** Cutting time so far in ms: frozen while paused and once the run ended, pauses never counted. */
  private elapsedMs(): number {
    if (this.startedAt === null) return 0;
    const end = this.endedAt ?? this.pausedAt ?? Date.now();
    return Math.max(0, end - this.startedAt - this.pausedMs);
  }

  private resetTiming() {
    this.startedAt = null;
    this.endedAt = null;
    this.pausedAt = null;
    this.pausedMs = 0;
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
    this.resetTiming();
    this.programName = name;
    // Hash the stripped lines, not the raw text: a comment-only edit or a
    // different line ending is still the same job to the machine.
    this.programKey =
      this.lines.length > 0 ? createHash('sha1').update(this.lines.join('\n')).digest('hex') : null;
    this.emit('loaded', { name, total: this.lines.length, ...this.getTimingState() });
  }

  private getTimingState() {
    const last = this.programKey ? this.lastRunStore.get(this.programKey) : null;
    return { elapsedMs: this.elapsedMs(), lastRunSeconds: last ? last.seconds : null };
  }

  getState() {
    return { state: this.state, sent: this.index, total: this.lines.length, ...this.getTimingState() };
  }

  /**
   * Resolves once the controller has actually finished moving. A line's
   * "ok" only means it was queued into the planner buffer, so the stream
   * finishes well ahead of the cut - on a job made of thousands of tiny
   * moves that's seconds of motion still to go. Two consecutive Idle reports
   * (not one) so a report taken just as the last block was being queued
   * can't end the timer early.
   */
  private waitForMotionEnd(token: number): Promise<'idle' | 'aborted' | 'alarm' | 'closed'> {
    return new Promise((resolve) => {
      let idleReports = 0;
      const finish = (result: 'idle' | 'aborted' | 'alarm' | 'closed') => {
        this.connection.off('status', onStatus);
        this.connection.off('close', onClose);
        clearInterval(abortCheck);
        resolve(result);
      };
      const onStatus = (report: StatusReport) => {
        if (token !== this.runToken) return finish('aborted');
        if (report.state === 'Alarm') return finish('alarm');
        idleReports = report.state === 'Idle' ? idleReports + 1 : 0;
        if (idleReports >= 2) finish('idle');
      };
      const onClose = () => finish('closed');
      // stop() bumps the token without any status report guaranteed to follow.
      const abortCheck = setInterval(() => {
        if (token !== this.runToken) finish('aborted');
      }, 250);
      this.connection.on('status', onStatus);
      this.connection.on('close', onClose);
    });
  }

  async run() {
    if (this.state === 'running') return;
    if (this.lines.length === 0) throw new Error('No program loaded');

    // run() always means "start from the beginning" - only resume() (via
    // the paused-loop signal below) continues mid-file. Without this, a
    // repeat run after a prior completion finds the index already at the
    // end, sends nothing, and immediately reports "complete" again.
    this.index = 0;
    this.resetTiming();
    this.startedAt = Date.now();
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
        this.endedAt = Date.now();
        this.state = 'error';
        this.emit('programStatus', this.getState());
        this.emit('programError', err instanceof Error ? err.message : String(err));
        return;
      }

      this.emit('programProgress', { sent: this.index + 1, total: this.lines.length, line } satisfies ProgramProgress);
    }

    // Every line is queued, but the machine is still cutting - the job is
    // only done (and the timer only stops) once it goes back to Idle.
    const outcome = await this.waitForMotionEnd(token);
    if (outcome === 'aborted') return; // stop() already reported the final state
    this.endedAt = Date.now();
    if (outcome === 'idle') {
      this.state = 'complete';
      if (this.programKey) {
        this.lastRunStore.set(this.programKey, {
          seconds: Math.round(this.elapsedMs() / 1000),
          finishedAt: this.endedAt,
          name: this.programName,
        });
      }
      this.emit('programStatus', this.getState());
      return;
    }
    this.state = 'error';
    this.emit('programStatus', this.getState());
    this.emit(
      'programError',
      outcome === 'alarm' ? 'The machine raised an alarm before the job finished' : 'Connection lost before the job finished',
    );
  }

  pause() {
    if (this.state !== 'running') return;
    this.connection.feedHold();
    this.pausedAt = Date.now();
    this.state = 'paused';
    // Setting resumeSignal to a placeholder marks "paused"; run() replaces it
    // with the real resolver on its next loop iteration.
    this.resumeSignal = () => {};
    this.emit('programStatus', this.getState());
  }

  resume() {
    if (this.state !== 'paused') return;
    this.connection.cycleStart();
    if (this.pausedAt !== null) {
      this.pausedMs += Date.now() - this.pausedAt;
      this.pausedAt = null;
    }
    this.state = 'running';
    const signal = this.resumeSignal;
    this.resumeSignal = null;
    signal?.();
    this.emit('programStatus', this.getState());
  }

  stop() {
    if (this.state !== 'running' && this.state !== 'paused') return;
    this.endedAt = this.pausedAt ?? Date.now();
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
