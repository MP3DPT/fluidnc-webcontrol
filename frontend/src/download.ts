/** Triggers a browser "Save As" for a JSON object - shared by the Logs panel's diagnostics export and the Settings panel's backup export. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

// Minimal shape of the File System Access API's save picker - not in every
// TS DOM lib version, and only actually implemented by Chromium browsers in
// a secure context, so this is typed by hand rather than depending on it
// being ambiently available.
interface WritableFileStream {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
}
interface SaveFileHandle {
  createWritable(): Promise<WritableFileStream>;
}
type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<SaveFileHandle>;

/**
 * Same end result as downloadJson, but tries the browser's native "Save As"
 * dialog first (File System Access API) so the user can actually pick where
 * it lands, instead of it silently landing in the default Downloads folder.
 * Chromium browsers only, and only in a secure context (localhost counts) -
 * anything else falls back to downloadJson, still a real backup file
 * either way, just without the picker. Used by UpdateModal's "back up
 * first" step; AppSettingsPanel's own Export backup button deliberately
 * keeps using plain downloadJson - the picker is a nice-to-have there, not
 * worth the extra complexity for a button that isn't gating a self-update.
 *
 * Throws (rather than silently falling back) if the user explicitly
 * cancels the picker - the caller should treat that as "the user said no",
 * not "proceed anyway with an unconfirmed save".
 */
export async function saveJsonWithPicker(filename: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // Any other failure (permission denied, etc.) - fall through to the plain download below.
    }
  }
  downloadJson(filename, data);
}
