import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { PluginInfo } from '../types';
import { isNewerVersion } from '../version';
import { PluginCard } from './PluginCard';

interface Props {
  plugins: PluginInfo[];
  send: (message: Record<string, unknown>) => void;
}

interface AvailablePlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  download: string;
}

// The community index - anyone can browse/install what's listed here without
// leaving the app. Points at MP3DPT's own repo for now (see the About page's
// "Roadmap & contributing" note); not an open marketplace anyone can submit
// to, since a plugin runs with full access to the app once installed.
const PLUGIN_INDEX_URL = 'https://raw.githubusercontent.com/MP3DPT/fluidnc-webcontrol/master/plugins.json';

/** Install/list/uninstall - plugin management, not the per-plugin dashboard widgets (see PluginPanels). */
export function PluginsManagerPanel({ plugins, send }: Props) {
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [available, setAvailable] = useState<AvailablePlugin[]>([]);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [installingId, setInstallingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(PLUGIN_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Index fetch failed (${res.status})`);
        return res.json();
      })
      .then((data) => setAvailable(data.plugins ?? []))
      .catch((err) => setBrowseError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBrowseLoading(false));
  }, []);

  const installZip = async (body: ArrayBuffer) => {
    const res = await fetch('/api/plugins/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body,
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error ?? 'Install failed');
  };

  const installFromFile = async (file: File) => {
    setInstalling(true);
    setInstallError(null);
    try {
      await installZip(await file.arrayBuffer());
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  const installFromIndex = async (entry: AvailablePlugin) => {
    setInstallingId(entry.id);
    setInstallError(null);
    try {
      const res = await fetch(entry.download);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      await installZip(await res.arrayBuffer());
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingId(null);
    }
  };

  const uninstallPlugin = async (id: string) => {
    if (!confirm(`Uninstall "${id}"? Its settings will be deleted too.`)) return;
    try {
      const res = await fetch(`/api/plugins/${id}/uninstall`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Uninstall failed');
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    }
  };

  const installedIds = new Set(plugins.map((p) => p.manifest.id));
  const browsable = available.filter((entry) => !installedIds.has(entry.id));
  // id -> the index's entry, but only for an installed plugin whose index
  // version is actually newer - reusing installFromIndex to apply it is
  // safe because loader.ts's install() already replaces an existing
  // directory wholesale, same as a fresh install.
  const updatesById = new Map<string, AvailablePlugin>();
  for (const plugin of plugins) {
    const entry = available.find((e) => e.id === plugin.manifest.id);
    if (entry && isNewerVersion(entry.version, plugin.manifest.version)) {
      updatesById.set(plugin.manifest.id, entry);
    }
  }

  return (
    <div className="drawer-panel">
      <p className="hint">
        Extend fluidnc-webcontrol with plugins. Browse what's available below, or install your own - anyone can
        build one and share it as a .zip. Plugins run with full access to the app, the same as any Node package
        you'd install yourself, so only install plugins you trust.
      </p>

      <div className="row">
        <button className="primary" disabled={installing} onClick={() => fileInputRef.current?.click()}>
          <Upload size={15} />
          {installing ? 'Installing…' : 'Install from .zip'}
        </button>
      </div>
      {installError && (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          {installError}
        </p>
      )}

      {plugins.length === 0 && <p className="hint">No plugins installed yet.</p>}

      {plugins.map((plugin) => {
        const update = updatesById.get(plugin.manifest.id);
        return (
          <PluginCard
            key={plugin.manifest.id}
            plugin={plugin}
            send={send}
            onUninstall={uninstallPlugin}
            latestVersion={update?.version}
            updating={installingId === plugin.manifest.id}
            onUpdate={update ? () => installFromIndex(update) : undefined}
          />
        );
      })}

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) installFromFile(file);
          e.target.value = '';
        }}
      />

      <div className="settings-section">
        <h4>Browse</h4>
        {browseLoading && <p className="hint">Loading available plugins…</p>}
        {browseError && (
          <p className="hint" style={{ color: 'var(--danger)' }}>
            Couldn't reach the plugin index ({browseError}) - this Pi is probably offline, or can't reach GitHub.
            Download a plugin's .zip on another device that has internet, copy it over, and use{' '}
            <strong>Install from .zip</strong> above instead.
          </p>
        )}
        {!browseLoading && !browseError && browsable.length === 0 && (
          <p className="hint">Nothing new to install - you already have everything in the index.</p>
        )}

        {browsable.map((entry) => (
          <div className="plugin-card" key={entry.id}>
            <div className="plugin-card-title-row">
              <strong>{entry.name}</strong>
              <div className="plugin-card-actions">
                <button disabled={installingId === entry.id} onClick={() => installFromIndex(entry)}>
                  <Download size={14} />
                  {installingId === entry.id ? 'Installing…' : 'Install'}
                </button>
              </div>
            </div>
            <p className="plugin-meta">
              Version {entry.version} · Author: {entry.author} · ID: {entry.id}
            </p>
            <p className="hint" style={{ margin: '0.2rem 0 0' }}>
              {entry.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
