import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../types';
import { Switch } from './ui/Switch';

interface Props {
  settings: Settings | null;
  send: (message: Record<string, unknown>) => void;
}

const FALLBACK_GENERAL: Settings['general'] = { consoleAutoFeedEnabled: true, consoleDefaultFeed: 300 };

/** App-level configuration - this web UI's own behavior, not any one machine or plugin. */
export function AppSettingsPanel({ settings, send }: Props) {
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

  const persistGeneral = (patch: Partial<Settings['general']>) => {
    send({ type: 'updateSettings', settings: { general: patch } });
  };

  return (
    <div className="drawer-panel">
      <h3>App Configuration</h3>
      <p className="hint">
        General behavior for this web UI, separate from any one machine or plugin. More options will land here over
        time.
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
          A line sent on the Console tab like <code>G1 Z0</code> has no feed rate of its own - FluidNC rejects it
          with "undefined feed rate" the first time, until one has been set some other way. With this on, the
          default feed below is appended automatically to any G1/G2/G3 line that doesn't already specify its own F
          word.
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
    </div>
  );
}
