import { useState } from 'react';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import type { LatestAppVersion } from '../version';
import type { PluginInfo, Settings, UpdateStatus } from '../types';
import { useOutdatedPlugins } from '../hooks/useOutdatedPlugins';
import { saveJsonWithPicker, timestampForFilename } from '../download';

interface Props {
  latestVersion: LatestAppVersion;
  plugins: PluginInfo[];
  /** null while settings haven't loaded yet - the "back up first" step just refuses to start until they have, same as everything else here waiting on the backend. */
  settings: Settings | null;
  /** Backend-tracked, not local state - see useSocket's updateStatus handling. Survives this modal being closed/reopened or the page being reloaded mid-update. */
  updateStatus: UpdateStatus;
  /** A running/paused job blocks starting an update, symmetric to how a running job already blocks loading a new file - the update ends in a service restart that would otherwise yank the connection out from under a streaming job with no controlled stop. */
  jobActive: boolean;
  onClose: () => void;
}

/** Downloads a plugin's .zip straight from the index (client-side - the
 * backend never reaches out to the internet itself) and installs it via the
 * same endpoint "Install from .zip" / PluginsManagerPanel's own per-plugin
 * update button use. Small enough to duplicate here rather than lift
 * PluginsManagerPanel's near-identical local logic into a shared module. */
async function installPluginZip(downloadUrl: string): Promise<void> {
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`Plugin download failed (${res.status})`);
  const body = await res.arrayBuffer();
  const installRes = await fetch('/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body,
  });
  const data = await installRes.json();
  if (!installRes.ok || !data.ok) throw new Error(data.error ?? 'Plugin install failed');
}

/**
 * The user-facing side of the in-app update flow: shows the release's own
 * notes, an optional "also update these plugins" checklist, a confirm
 * button, then live progress once it's underway. Everything past "the zip
 * landed on the backend" is driven by `updateStatus`, which is tracked
 * server-side (see websocket/server.ts) specifically so a reload or a
 * flaky reconnect mid-update still shows the real state instead of losing
 * it - this component never invents its own "is it done yet" guess.
 */
export function UpdateModal({ latestVersion, plugins, settings, updateStatus, jobActive, onClose }: Props) {
  const outdatedPlugins = useOutdatedPlugins(plugins);
  // null until the user touches a checkbox - defaults to "everything
  // checked" computed fresh from outdatedPlugins every render until then,
  // so a list that only finishes fetching after the first render (the index
  // fetch is async) still ends up fully checked instead of frozen at
  // whatever was known during a `useState(initial)` call.
  const [touchedSelection, setTouchedSelection] = useState<Set<string> | null>(null);
  const selected = touchedSelection ?? new Set(outdatedPlugins.map((p) => p.id));
  const togglePlugin = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTouchedSelection(next);
  };

  // Defaults on - cheap insurance before letting the app rebuild itself,
  // same "why wouldn't you" reasoning as the plugin checklist defaulting to
  // checked. Off by choice, not by default.
  const [backupFirst, setBackupFirst] = useState(true);
  const [starting, setStarting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const startUpdate = async () => {
    setStarting(true);
    setLocalError(null);
    try {
      if (backupFirst) {
        if (!settings) throw new Error("Settings haven't finished loading yet - try again in a moment.");
        // Same shape AppSettingsPanel's own Export backup produces - a
        // restore doesn't care which flow made the file.
        await saveJsonWithPicker(`fluidnc-webcontrol-settings-backup-${timestampForFilename()}.json`, {
          exportedAt: new Date().toISOString(),
          general: settings.general,
          plugins: settings.plugins,
        });
      }
      for (const plugin of outdatedPlugins) {
        if (!selected.has(plugin.id)) continue;
        await installPluginZip(plugin.download);
      }
      // The app's own release zip is downloaded by the backend, not here -
      // unlike a plugin's zip (raw.githubusercontent.com, fetched above),
      // GitHub's archive-zip endpoint doesn't send CORS headers, so a
      // browser-side fetch of it fails outright with a generic "Failed to
      // fetch". Just hand over which tag to update to.
      const updateRes = await fetch('/api/system/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: `v${latestVersion.version}` }),
      });
      const updateData = await updateRes.json();
      if (!updateRes.ok || !updateData.ok) throw new Error(updateData.error ?? 'Failed to start the update');
      // From here on, all real progress is the backend's own updateStatus
      // broadcasts (see props) - this function's job ends once the request
      // lands; `starting` stays true until that status actually shows up.
    } catch (err) {
      // The save-picker throws its own AbortError when the user cancels the
      // dialog - treat that as "no" for the whole update, not just the
      // backup step, rather than silently proceeding without the backup
      // they were just asked (and declined) to confirm a location for.
      const cancelled = err instanceof DOMException && err.name === 'AbortError';
      setLocalError(cancelled ? 'Backup cancelled - update not started.' : err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  };

  const updating = starting || updateStatus.status === 'running';
  const canClose = !updating;

  return (
    <div className="update-modal-overlay" onClick={canClose ? onClose : undefined}>
      <div className="update-modal" onClick={(e) => e.stopPropagation()}>
        <div className="update-modal-header">
          <h3>Update to v{latestVersion.version}</h3>
          {canClose && (
            <button onClick={onClose} aria-label="Close" title="Close">
              <X size={16} />
            </button>
          )}
        </div>

        {latestVersion.notes && <div className="update-modal-notes">{latestVersion.notes}</div>}

        {updateStatus.status === 'idle' && jobActive && (
          <p className="update-modal-blocked">A program is currently running - stop it before updating.</p>
        )}

        {updateStatus.status === 'idle' && outdatedPlugins.length > 0 && (
          <div className="update-modal-plugin-list">
            <p className="hint">Also update installed plugins?</p>
            {outdatedPlugins.map((plugin) => (
              <label key={plugin.id}>
                <input type="checkbox" checked={selected.has(plugin.id)} onChange={() => togglePlugin(plugin.id)} disabled={updating} />
                {plugin.name} → v{plugin.version}
              </label>
            ))}
          </div>
        )}

        {updateStatus.status === 'idle' && (
          <label className="update-modal-backup-toggle">
            <input
              type="checkbox"
              checked={backupFirst}
              onChange={(e) => setBackupFirst(e.target.checked)}
              disabled={updating}
            />
            Back up all settings first (recommended) - you'll be asked where to save it
          </label>
        )}

        {localError && <p className="update-modal-error">{localError}</p>}

        {starting && updateStatus.status === 'idle' && (
          <div className="update-modal-progress">
            <Loader2 size={16} />
            <span>Downloading update…</span>
          </div>
        )}
        {updateStatus.status === 'running' && (
          <div className="update-modal-progress">
            <Loader2 size={16} />
            <span>{updateStatus.step}</span>
          </div>
        )}
        {updateStatus.status === 'complete' && (
          <p className="update-modal-success">
            <CheckCircle2 size={16} /> Update complete - reloading…
          </p>
        )}
        {updateStatus.status === 'failed' && (
          <p className="update-modal-error">
            <XCircle size={16} /> {updateStatus.error}
          </p>
        )}

        {updating && <p className="hint">Don't close this tab - the app will reload on its own once it's ready.</p>}

        {!updating && (updateStatus.status === 'idle' || updateStatus.status === 'failed') && (
          <div className="row">
            <button className="primary" disabled={jobActive} onClick={startUpdate}>
              {updateStatus.status === 'failed'
                ? 'Try again'
                : backupFirst
                  ? 'Back up & update (requires a short restart)'
                  : 'Update now (requires a short restart)'}
            </button>
            <button onClick={onClose}>{updateStatus.status === 'failed' ? 'Close' : 'Not now'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
