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
