import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import type { PluginInfo } from '../types';
import { PluginCard } from './PluginCard';

interface Props {
  plugins: PluginInfo[];
  send: (message: Record<string, unknown>) => void;
}

/** Install/list/uninstall - plugin management, not the per-plugin dashboard widgets (see PluginPanels). */
export function PluginsManagerPanel({ plugins, send }: Props) {
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const installPlugin = async (file: File) => {
    setInstalling(true);
    setInstallError(null);
    try {
      const body = await file.arrayBuffer();
      const res = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Install failed');
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
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

  return (
    <div className="drawer-panel">
      <p className="hint">
        Extend fluidnc-webcontrol with plugins. Anyone can build one and share it as a .zip - install it below.
        Plugins run with full access to the app, the same as any Node package you'd install yourself, so only
        install plugins you trust.
      </p>

      <div className="row">
        <button className="primary" disabled={installing} onClick={() => fileInputRef.current?.click()}>
          <Upload size={15} />
          {installing ? 'Installing…' : 'Install Plugin'}
        </button>
      </div>
      {installError && (
        <p className="hint" style={{ color: 'var(--danger)' }}>
          {installError}
        </p>
      )}

      {plugins.length === 0 && <p className="hint">No plugins installed yet.</p>}

      {plugins.map((plugin) => (
        <PluginCard key={plugin.manifest.id} plugin={plugin} send={send} onUninstall={uninstallPlugin} />
      ))}

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) installPlugin(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
