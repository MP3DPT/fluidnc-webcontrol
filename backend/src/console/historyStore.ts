import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../dataDir.js';

const HISTORY_PATH = join(DATA_DIR, 'console-history.json');
const MAX_ENTRIES = 50;

/**
 * Command history for the Console tab's own input - what the user actually
 * typed and sent, not every G-code line the app sends on its own behalf
 * (Zero X, the jog panel's 0,0 button, a loaded program's lines, ...). Only
 * ConsolePanel's submit() ever calls add() here.
 *
 * Persisted to disk (not just kept in memory, and not just in the
 * browser) so it's the same regardless of which browser/device connects
 * and survives a Pi reboot - same reasoning as SettingsStore.
 */
export class ConsoleHistoryStore extends EventEmitter {
  private entries: string[];

  constructor() {
    super();
    this.entries = this.load();
  }

  private load(): string[] {
    try {
      const raw = readFileSync(HISTORY_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
    } catch {
      return [];
    }
  }

  private persist() {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    writeFileSync(HISTORY_PATH, JSON.stringify(this.entries, null, 2));
  }

  /** Oldest first, newest last - matches how a shell history file reads top to bottom. */
  list(): string[] {
    return this.entries;
  }

  /** Skips an exact repeat of the immediately previous entry, same as a normal shell history does - hitting Enter on the same line twice in a row shouldn't clutter it with duplicates. */
  add(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;
    if (this.entries[this.entries.length - 1] === trimmed) return;
    this.entries.push(trimmed);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.persist();
    this.emit('change', this.entries);
  }
}
