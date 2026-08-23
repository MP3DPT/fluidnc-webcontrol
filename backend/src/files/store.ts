import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../dataDir.js';

export interface Folder {
  id: string;
  name: string;
}

export interface DiskUsage {
  freeBytes: number;
  totalBytes: number;
}

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  savedAt: number;
  thumbnail: string | null;
  /** null = unfiled, at the library's top level. */
  folderId: string | null;
  /** Opaque to the backend - the frontend computes and interprets this (feed/spindle/tool/size/etc.), the backend just stores and returns it. */
  metadata: unknown | null;
}

interface LibraryIndex {
  folders: Folder[];
  files: FileEntry[];
}

// Stored outside the deployable project tree (which gets overwritten on
// every deploy) so the library survives redeploys as well as reboots -
// same convention as SettingsStore and the plugin install directory.
const LIBRARY_DIR = join(DATA_DIR, 'gcode-library');
const INDEX_PATH = join(LIBRARY_DIR, 'index.json');

function gcodePath(id: string): string {
  return join(LIBRARY_DIR, `${id}.gcode`);
}

/**
 * A small on-disk library of saved G-code files, browsable from the File
 * Manager panel and organizable into folders - separate from the one-off
 * "Load File" flow's in-memory program, though loading a local file also
 * adds it here automatically.
 */
export class FileLibraryStore {
  private index: LibraryIndex;

  constructor() {
    mkdirSync(LIBRARY_DIR, { recursive: true });
    this.index = this.load();
  }

  private load(): LibraryIndex {
    try {
      const parsed = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
      // Pre-folders index.json was a bare array of files.
      if (Array.isArray(parsed)) {
        return {
          folders: [],
          files: parsed.map((f: FileEntry) => ({ ...f, folderId: f.folderId ?? null, metadata: f.metadata ?? null })),
        };
      }
      // Pre-metadata entries won't have the field at all.
      parsed.files = (parsed.files ?? []).map((f: FileEntry) => ({ ...f, metadata: f.metadata ?? null }));
      return { folders: parsed.folders ?? [], files: parsed.files ?? [] };
    } catch {
      return { folders: [], files: [] };
    }
  }

  private persist() {
    writeFileSync(INDEX_PATH, JSON.stringify(this.index, null, 2));
  }

  list(): FileEntry[] {
    return this.index.files;
  }

  listFolders(): Folder[] {
    return this.index.folders;
  }

  createFolder(name: string): Folder {
    const folder: Folder = { id: randomUUID(), name };
    this.index.folders = [...this.index.folders, folder];
    this.persist();
    return folder;
  }

  /** Deleting a folder deletes everything inside it too - the caller is responsible for warning the user before calling this, since it's irreversible. */
  deleteFolder(id: string) {
    this.index.folders = this.index.folders.filter((f) => f.id !== id);
    const contained = this.index.files.filter((f) => f.folderId === id).map((f) => f.id);
    this.removeMany(contained);
  }

  add(name: string, gcode: string, thumbnail: string | null, folderId: string | null, metadata: unknown | null): FileEntry {
    const entry: FileEntry = {
      id: randomUUID(),
      name,
      size: Buffer.byteLength(gcode, 'utf-8'),
      savedAt: Date.now(),
      thumbnail,
      folderId,
      metadata,
    };
    writeFileSync(gcodePath(entry.id), gcode, 'utf-8');
    this.index.files = [entry, ...this.index.files];
    this.persist();
    return entry;
  }

  getGcode(id: string): string {
    const path = gcodePath(id);
    if (!existsSync(path)) throw new Error('File not found');
    return readFileSync(path, 'utf-8');
  }

  moveFiles(ids: string[], folderId: string | null) {
    const idSet = new Set(ids);
    this.index.files = this.index.files.map((f) => (idSet.has(f.id) ? { ...f, folderId } : f));
    this.persist();
  }

  /** Free/total space on the SD card (the filesystem the library itself lives on), via `df` since Node has no built-in cross-version-safe way to read this. */
  diskUsage(): DiskUsage | null {
    try {
      const out = execFileSync('df', ['-k', '--output=avail,size', LIBRARY_DIR], { encoding: 'utf-8' });
      const lastLine = out.trim().split('\n').at(-1) ?? '';
      const [avail, size] = lastLine.trim().split(/\s+/).map(Number);
      if (!Number.isFinite(avail) || !Number.isFinite(size)) return null;
      return { freeBytes: avail * 1024, totalBytes: size * 1024 };
    } catch {
      return null;
    }
  }

  removeMany(ids: string[]) {
    const idSet = new Set(ids);
    this.index.files = this.index.files.filter((e) => !idSet.has(e.id));
    this.persist();
    for (const id of ids) {
      const path = gcodePath(id);
      if (existsSync(path)) rmSync(path);
    }
  }
}
