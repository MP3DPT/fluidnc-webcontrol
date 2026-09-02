import { useEffect, useRef, useState } from 'react';
import { Download, TriangleAlert, Upload } from 'lucide-react';
import type { Settings } from '../types';
import { Switch } from './ui/Switch';
import { downloadJson, timestampForFilename } from '../download';
import { CornerPicker } from './CornerPicker';

interface Props {
  settings: Settings | null;
  send: (message: Record<string, unknown>) => void;
  connectionOpen: boolean;
  /** The full raw $$ dump - null until connected and it's actually been fetched. Used to check Park's real prerequisites ($20 soft limits, $130/$131 max travel) rather than just assuming they're set. */
  fluidncSettings: Record<string, number> | null;
}

const FALLBACK_GENERAL: Settings['general'] = {
  consoleAutoFeedEnabled: true,
  consoleDefaultFeed: 300,
  jogStepSizes: [0.1, 1, 10, 50],
  spoilboardWidth: 0,
  spoilboardHeight: 0,
  parkX: 'home',
  parkY: 'home',
};

/** Parses "0.1, 1, 10, 50" into [0.1, 1, 10, 50] - drops anything non-numeric or <= 0, dedupes, sorts ascending. Returns null if nothing valid survives (caller should reject rather than persist an empty Step dropdown). */
function parseStepSizes(text: string): number[] | null {
  const values = text
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return null;
  return [...new Set(values)].sort((a, b) => a - b);
}

/** App-level configuration - this web UI's own behavior, not any one machine or plugin. */
export function AppSettingsPanel({ settings, send, connectionOpen, fluidncSettings }: Props) {
  const [consoleAutoFeedEnabled, setConsoleAutoFeedEnabled] = useState(FALLBACK_GENERAL.consoleAutoFeedEnabled);
  const [consoleDefaultFeed, setConsoleDefaultFeed] = useState(FALLBACK_GENERAL.consoleDefaultFeed);
  const [jogStepSizesText, setJogStepSizesText] = useState(FALLBACK_GENERAL.jogStepSizes.join(', '));
  const [jogStepSizesError, setJogStepSizesError] = useState(false);
  const [spoilboardWidth, setSpoilboardWidth] = useState(FALLBACK_GENERAL.spoilboardWidth);
  const [spoilboardHeight, setSpoilboardHeight] = useState(FALLBACK_GENERAL.spoilboardHeight);
  const [parkX, setParkX] = useState(FALLBACK_GENERAL.parkX);
  const [parkY, setParkY] = useState(FALLBACK_GENERAL.parkY);
  const [restoreMessage, setRestoreMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const generalInitialized = useRef(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  // Settings arrive asynchronously (loaded from disk on the Pi) - apply
  // them once when they first show up, so the fields reflect whatever was
  // last saved, even after a page reload or a Pi reboot.
  useEffect(() => {
    if (settings?.general && !generalInitialized.current) {
      generalInitialized.current = true;
      setConsoleAutoFeedEnabled(settings.general.consoleAutoFeedEnabled);
      setConsoleDefaultFeed(settings.general.consoleDefaultFeed);
      setJogStepSizesText(settings.general.jogStepSizes.join(', '));
      setSpoilboardWidth(settings.general.spoilboardWidth ?? FALLBACK_GENERAL.spoilboardWidth);
      setSpoilboardHeight(settings.general.spoilboardHeight ?? FALLBACK_GENERAL.spoilboardHeight);
      setParkX(settings.general.parkX ?? FALLBACK_GENERAL.parkX);
      setParkY(settings.general.parkY ?? FALLBACK_GENERAL.parkY);
    }
  }, [settings]);

  const persistGeneral = (patch: Partial<Settings['general']>) => {
    send({ type: 'updateSettings', settings: { general: patch } });
  };

  const commitJogStepSizes = () => {
    const parsed = parseStepSizes(jogStepSizesText);
    if (!parsed) {
      setJogStepSizesError(true);
      return;
    }
    setJogStepSizesError(false);
    setJogStepSizesText(parsed.join(', '));
    persistGeneral({ jogStepSizes: parsed });
  };

  // Deliberately the FULL, unredacted settings - the point of a backup is
  // being able to restore a working setup on a new device, which a
  // scrubbed Tuya key/webhook URL couldn't do. Not to be confused with the
  // Logs panel's "Export diagnostics", which redacts those on purpose for
  // sharing with someone else.
  const exportBackup = () => {
    if (!settings) return;
    downloadJson(`fluidnc-webcontrol-settings-backup-${timestampForFilename()}.json`, {
      exportedAt: new Date().toISOString(),
      general: settings.general,
      plugins: settings.plugins,
    });
  };

  const handleRestoreFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: { general?: Settings['general']; plugins?: Settings['plugins'] };
      try {
        parsed = JSON.parse(String(reader.result ?? ''));
      } catch {
        setRestoreMessage({ text: 'That file is not valid JSON.', isError: true });
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || (!parsed.general && !parsed.plugins)) {
        setRestoreMessage({ text: "That file doesn't look like a fluidnc-webcontrol settings backup.", isError: true });
        return;
      }
      if (
        !window.confirm(
          'This replaces ALL current settings and every plugin\'s configuration (including credentials) with ' +
            "this backup file. Anything configured since isn't kept. Continue?",
        )
      ) {
        return;
      }

      send({ type: 'restoreSettings', settings: { general: parsed.general ?? {}, plugins: parsed.plugins ?? {} } });

      // The settings broadcast this triggers updates JogPanel/PluginCard
      // automatically (they read straight from the settings/plugins props
      // every render) - but this panel's own fields only ever sync from
      // settings once (see the effect above, guarding against a live edit
      // being clobbered by its own echo), so a restore needs its own
      // explicit resync to actually show up here without a page reload.
      if (parsed.general) {
        setConsoleAutoFeedEnabled(parsed.general.consoleAutoFeedEnabled ?? FALLBACK_GENERAL.consoleAutoFeedEnabled);
        setConsoleDefaultFeed(parsed.general.consoleDefaultFeed ?? FALLBACK_GENERAL.consoleDefaultFeed);
        setJogStepSizesText((parsed.general.jogStepSizes ?? FALLBACK_GENERAL.jogStepSizes).join(', '));
        setSpoilboardWidth(parsed.general.spoilboardWidth ?? FALLBACK_GENERAL.spoilboardWidth);
        setSpoilboardHeight(parsed.general.spoilboardHeight ?? FALLBACK_GENERAL.spoilboardHeight);
        setParkX(parsed.general.parkX ?? FALLBACK_GENERAL.parkX);
        setParkY(parsed.general.parkY ?? FALLBACK_GENERAL.parkY);
      }
      setRestoreMessage({ text: 'Backup restored.', isError: false });
    };
    reader.readAsText(file);
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

      <div className="settings-section">
        <h4>Jog</h4>
        <label>
          Step sizes
          <input
            type="text"
            value={jogStepSizesText}
            onChange={(e) => {
              setJogStepSizesText(e.target.value);
              if (jogStepSizesError) setJogStepSizesError(false);
            }}
            onBlur={commitJogStepSizes}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
        <p className="hint">
          Comma-separated, in mm - these become the Step dropdown's options in Jog Control. Needs at least one valid
          positive number{jogStepSizesError && ' - nothing valid found, keeping the last saved list'}.
        </p>
      </div>

      <div className="settings-section">
        <h4>Working Area</h4>
        <p className="hint">
          Your spoilboard size in mm, measured from machine (0,0) - optional, just a heads-up. When set, loading a
          file whose toolpath doesn't fit gets a warning that the job is bigger than the working area. Leave at 0 to
          skip that check for an axis.
        </p>
        <label>
          Width (X)
          <span className="field-row">
            <input
              type="number"
              min={0}
              value={spoilboardWidth}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpoilboardWidth(v);
                persistGeneral({ spoilboardWidth: v });
              }}
            />
            <span>mm</span>
          </span>
        </label>
        <label>
          Height (Y)
          <span className="field-row">
            <input
              type="number"
              min={0}
              value={spoilboardHeight}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSpoilboardHeight(v);
                persistGeneral({ spoilboardHeight: v });
              }}
            />
            <span>mm</span>
          </span>
        </label>
      </div>

      <div className="settings-section">
        <h4>Park Corner</h4>
        <p className="hint">
          Which corner the on-demand Park button(s) next to Jog Control go to - not tied to any automatic behavior
          when a job finishes. The machine just does whatever the loaded G-code file itself does at the end (many
          CAM posts already return to 0,0 on their own); parking is purely something to reach for afterward if you
          want the spindle out of the way.
        </p>

        {!connectionOpen && (
          <p className="hint">Connect to the controller to check whether Park's prerequisites are met.</p>
        )}
        {connectionOpen && fluidncSettings === null && <p className="hint">Reading controller settings…</p>}
        {connectionOpen && fluidncSettings !== null && fluidncSettings['$20'] !== 1 && (
          <div className="inline-warning">
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <TriangleAlert size={14} />
              Soft limits ($20) aren't enabled on the controller - Park relies on them to refuse an
              out-of-range move instead of actually crashing into a limit switch.
            </p>
            <div className="row">
              <button
                onClick={() => {
                  send({ type: 'gcode', line: '$20=1' });
                  setTimeout(() => send({ type: 'getFirmwareSettings' }), 500);
                }}
              >
                Enable soft limits ($20=1)
              </button>
            </div>
          </div>
        )}
        {connectionOpen &&
          fluidncSettings !== null &&
          fluidncSettings['$20'] === 1 &&
          (!fluidncSettings['$130'] || !fluidncSettings['$131']) && (
            <p className="hint error-text">
              Max travel ($130/$131) isn't configured on the controller - set those in your FluidNC config
              before Park can compute a corner.
            </p>
          )}

        <label>Park corner</label>
        <CornerPicker x={parkX} y={parkY} onChange={(x, y) => {
          setParkX(x);
          setParkY(y);
          persistGeneral({ parkX: x, parkY: y });
        }} />
        <p className="hint">The dot marked "H" is machine home (0,0) - the other three are the far end of X and/or Y's configured travel.</p>
      </div>

      <div className="settings-section">
        <h4>Backup &amp; Restore</h4>
        <p className="hint">
          Export everything - general settings and every installed plugin's full configuration, credentials
          included - into one file. Handy before reinstalling on a new device, or just to have a copy.
        </p>
        <input
          ref={restoreFileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleRestoreFile(file);
            e.target.value = '';
          }}
        />
        <div className="row">
          <button onClick={exportBackup} disabled={!settings}>
            <Download size={14} />
            Export backup
          </button>
          <button onClick={() => restoreFileInputRef.current?.click()}>
            <Upload size={14} />
            Restore from backup
          </button>
        </div>
        {restoreMessage && <p className={restoreMessage.isError ? 'hint error-text' : 'hint'}>{restoreMessage.text}</p>}
      </div>
    </div>
  );
}
