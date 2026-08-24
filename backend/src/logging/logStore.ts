import { EventEmitter } from 'node:events';

export interface BackendLogEntry {
  id: number;
  level: 'warn' | 'error';
  message: string;
  timestamp: number;
}

const MAX_ENTRIES = 300;

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Captures console.error/console.warn into an in-memory ring buffer so the
 * frontend can show them (Logs panel) without needing SSH + journalctl -
 * most people running the pre-flashed image won't have that set up.
 *
 * Deliberately NOT console.log: the only console.log calls in this codebase
 * are the raw serial echo (multiple times a second while connected, already
 * shown in the Console tab via a different path) and a one-time startup
 * line - capturing those would flood a 300-entry buffer with noise in
 * seconds and push out the errors this exists to surface.
 */
export class LogStore extends EventEmitter {
  private entries: BackendLogEntry[] = [];
  private nextId = 0;

  private push(level: BackendLogEntry['level'], args: unknown[]) {
    const entry: BackendLogEntry = {
      id: this.nextId++,
      level,
      message: args.map(formatArg).join(' '),
      timestamp: Date.now(),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.emit('line', entry);
  }

  /** Wraps console.error/warn globally so every call site - this file's own, every plugin's, any future one - is captured without needing to touch any of them individually. Still calls the original function first, so journalctl/stdout output is completely unchanged. */
  attachToConsole(): void {
    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);
    console.error = (...args: unknown[]) => {
      originalError(...args);
      this.push('error', args);
    };
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      this.push('warn', args);
    };
  }

  list(): BackendLogEntry[] {
    return this.entries;
  }
}
