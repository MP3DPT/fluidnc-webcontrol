import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../dataDir.js';

export interface LastRun {
  /** Real cutting time, pauses excluded. */
  seconds: number;
  finishedAt: number;
  /** File name at the time of the run - only a label for a human reading the JSON, the key is the content hash. */
  name: string;
}

// Stored outside the deployable project tree, same convention as the
// settings and the G-code library, so it survives redeploys and reboots.
const STORE_PATH = join(DATA_DIR, 'last-runs.json');

// A shop only ever re-runs a handful of files; the cap just stops the file
// growing forever on a machine that cuts a new design every day.
const MAX_ENTRIES = 200;

/**
 * Remembers how long each program really took the last time it ran to
 * completion, keyed by a hash of its content (not its name - the same job
 * saved under another name is still the same job, and a different job that
 * reuses a name isn't). Measured, never estimated.
 */
export class LastRunStore {
  private runs: Record<string, LastRun>;

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    this.runs = this.load();
  }

  private load(): Record<string, LastRun> {
    try {
      const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  get(key: string): LastRun | null {
    return this.runs[key] ?? null;
  }

  set(key: string, run: LastRun) {
    this.runs[key] = run;
    const keys = Object.keys(this.runs);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => this.runs[a].finishedAt - this.runs[b].finishedAt)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete this.runs[k]);
    }
    try {
      writeFileSync(STORE_PATH, JSON.stringify(this.runs, null, 2));
    } catch {
      // A failed write only loses the "last cut" hint, never the job itself.
    }
  }
}
