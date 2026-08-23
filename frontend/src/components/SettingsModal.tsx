import { useEffect, useRef, useState } from 'react';
import { Info, Puzzle, SlidersHorizontal, Upload, X } from 'lucide-react';
import type { PluginInfo, Settings } from '../types';
import { PluginCard } from './PluginCard';
import { Switch } from './ui/Switch';

interface Props {
  open: boolean;
  onClose: () => void;
  plugins: PluginInfo[];
  settings: Settings | null;
  send: (message: Record<string, unknown>) => void;
}

type Section = 'configuration' | 'plugins' | 'about';

const FALLBACK_GENERAL: Settings['general'] = { consoleAutoFeedEnabled: true, consoleDefaultFeed: 300 };

export function SettingsModal({ open, onClose, plugins, settings, send }: Props) {
  const [section, setSection] = useState<Section>('configuration');
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [consoleAutoFeedEnabled, setConsoleAutoFeedEnabled] = useState(FALLBACK_GENERAL.consoleAutoFeedEnabled);
  const [consoleDefaultFeed, setConsoleDefaultFeed] = useState(FALLBACK_GENERAL.consoleDefaultFeed);
  const generalInitialized = useRef(false);

  // Settings arrive asynchronously (loaded from disk on the Pi) - apply
  // them once when they first show up, so the fields reflect whatever was
  // last saved, even after a page reload or a Pi reboot.
  useEffect(() => {
    if (settings?.general && !generalInitialized.current) {
      generalInitialized.current = true;
      setConsoleAutoFeedEnabled(settings.general.consoleAutoFeedEnabled);
      setConsoleDefaultFeed(settings.general.consoleDefaultFeed);
    }
  }, [settings]);

  if (!open) return null;

  const persistGeneral = (patch: Partial<Settings['general']>) => {
    send({ type: 'updateSettings', settings: { general: patch } });
  };

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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-sidebar">
            <button className={section === 'configuration' ? 'active' : ''} onClick={() => setSection('configuration')}>
              <SlidersHorizontal size={15} />
              Configuration
            </button>
            <button className={section === 'plugins' ? 'active' : ''} onClick={() => setSection('plugins')}>
              <Puzzle size={15} />
              Plugins
            </button>
            <button className={section === 'about' ? 'active' : ''} onClick={() => setSection('about')}>
              <Info size={15} />
              About
            </button>
          </div>

          <div className="modal-content">
            {section === 'configuration' && (
              <>
                <h3>App Configuration</h3>
                <p className="hint">
                  General behavior for this web UI, separate from any one machine or plugin. More options will land
                  here over time.
                </p>

                <div className="settings-section">
                  <h4>Console</h4>
                  <Switch
                    checked={consoleAutoFeedEnabled}
                    onChange={(checked) => {
                      setConsoleAutoFeedEnabled(checked);
                      persistGeneral({ consoleAutoFeedEnabled: checked });
                    }}
                    label="Auto-fill feed rate for moves"
                  />
                  <p className="hint">
                    A line sent on the Console tab like <code>G1 Z0</code> has no feed rate of its own - FluidNC
                    rejects it with "undefined feed rate" the first time, until one has been set some other way.
                    With this on, the default feed below is appended automatically to any G1/G2/G3 line that doesn't
                    already specify its own F word.
                  </p>
                  <label>
                    Default feed rate
                    <span className="field-row">
                      <input
                        type="number"
                        min={1}
                        disabled={!consoleAutoFeedEnabled}
                        value={consoleDefaultFeed}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setConsoleDefaultFeed(v);
                          persistGeneral({ consoleDefaultFeed: v });
                        }}
                      />
                      <span>mm/min</span>
                    </span>
                  </label>
                </div>
              </>
            )}

            {section === 'plugins' && (
              <>
                <h3>Plugin Management</h3>
                <p className="hint">
                  Extend fluidnc-webcontrol with plugins. Anyone can build one and share it as a .zip - install it
                  below. Plugins run with full access to the app, the same as any Node package you'd install
                  yourself, so only install plugins you trust.
                </p>

                {plugins.length === 0 && <p className="hint">No plugins installed yet.</p>}

                {plugins.map((plugin) => (
                  <PluginCard key={plugin.manifest.id} plugin={plugin} send={send} onUninstall={uninstallPlugin} />
                ))}

                <div className="plugin-card">
                  <div className="plugin-card-header">
                    <div>
                      <strong>Install new plugin</strong>
                      <p className="hint" style={{ margin: '0.2rem 0 0' }}>
                        Choose a .zip containing the plugin's plugin.json, entry file, and any dependencies.
                      </p>
                    </div>
                    <div className="plugin-card-actions">
                      <button disabled={installing} onClick={() => fileInputRef.current?.click()}>
                        <Upload size={15} />
                        {installing ? 'Installing…' : 'Choose .zip'}
                      </button>
                    </div>
                  </div>
                  {installError && (
                    <p className="hint" style={{ color: 'var(--danger)' }}>
                      {installError}
                    </p>
                  )}
                </div>

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
              </>
            )}

            {section === 'about' && (
              <>
                <h3>fluidnc-webcontrol v0.1.0</h3>
                <p className="hint">
                  A free, open-source, community-built FluidNC control UI. More settings and plugin support coming.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
