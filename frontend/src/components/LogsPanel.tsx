import { useEffect, useRef, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import type { BackendLogEntry, PluginInfo, ProgramStatus, Settings, StatusReport } from '../types';
import { buildDiagnosticsBundle, downloadDiagnostics } from '../diagnostics';
import { Switch } from './ui/Switch';

interface Props {
  log: BackendLogEntry[];
  connectionOpen: boolean;
  status: StatusReport | null;
  programStatus: ProgramStatus;
  settings: Settings | null;
  plugins: PluginInfo[];
  /** Lifted to App.tsx, not local state here - see App.tsx's own comment on why (the Logs Drawer unmounts this component on close, which was silently forgetting a local "Clear"). */
  clearedAt: number;
  onClear: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

/**
 * Read-only view of backend/plugin errors and warnings (see
 * backend/src/logging/logStore.ts) - lets someone troubleshoot a plugin
 * failure or a startup problem without needing SSH + journalctl, which most
 * people running the pre-flashed image won't have set up.
 */
export function LogsPanel({ log, connectionOpen, status, programStatus, settings, plugins, clearedAt, onClear }: Props) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const bundle = await buildDiagnosticsBundle({ connectionOpen, status, programStatus, settings, plugins, backendLog: log });
      downloadDiagnostics(bundle);
    } finally {
      setExporting(false);
    }
  };
  // "Clear" only hides what's shown so far - the backend's own ring buffer
  // is the source of truth, and a fresh page load (or another open tab)
  // should still see full history, not a clear one browser tab triggered.
  const logRef = useRef<HTMLDivElement>(null);

  const visible = log.filter((entry) => entry.timestamp > clearedAt);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [visible.length, autoScroll]);

  return (
    <div className="drawer-panel">
      <h3>Logs</h3>
      <p className="hint">
        Backend and plugin errors/warnings - not machine G-code traffic, see the Console tab for that. Kept in memory
        on the Pi (last 300), so this history survives a page reload but not a service restart.
      </p>

      <div className="row logs-toolbar">
        <Switch checked={autoScroll} onChange={setAutoScroll} label="Auto-scroll" />
        <div className="row">
          <button className="tertiary" onClick={handleExport} disabled={exporting}>
            <Download size={14} />
            {exporting ? 'Exporting…' : 'Export diagnostics'}
          </button>
          <button className="tertiary" onClick={onClear} disabled={visible.length === 0}>
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </div>
      <p className="hint">
        Export bundles this log, general settings, plugin versions/enabled state, and machine/connection status into
        one file to share when asking for help. It never includes G-code file names/content, and any plugin field
        marked sensitive (API keys, tokens, webhook URLs) is redacted to just whether it's set, not its value.
      </p>

      <div className="log backend-log" ref={logRef}>
        {visible.length === 0 ? (
          <p className="hint">No errors or warnings yet.</p>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className={`log-line backend-log-${entry.level}`}>
              <span className="backend-log-time">{formatTime(entry.timestamp)}</span> {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
