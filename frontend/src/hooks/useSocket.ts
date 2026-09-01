import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BackendLogEntry,
  LogEntry,
  PluginInfo,
  PortInfo,
  Position,
  ProbeResult,
  ProgramStatus,
  Settings,
  StatusReport,
  UpdateStatus,
} from '../types';
import type { MachineRates } from '../gcode/estimateTime';

const RECONNECT_DELAY_MS = 2000;
let logIdCounter = 0;

export function useSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [status, setStatus] = useState<StatusReport | null>(null);
  const [workPosition, setWorkPosition] = useState<Position | null>(null);
  const lastWcoRef = useRef<Position | null>(null);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lastProbeResult, setLastProbeResult] = useState<ProbeResult | null>(null);
  const [programStatus, setProgramStatus] = useState<ProgramStatus>({ state: 'idle', sent: 0, total: 0 });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [machineRates, setMachineRates] = useState<MachineRates | null>(null);
  // The full raw $$ dump (every "$N" key, e.g. $20 soft limits, $23 homing
  // direction, $130/$131 max travel) - kept alongside the narrower
  // machineRates extraction above rather than replacing it, since existing
  // code already depends on that shape. Used by the Job Completion settings
  // section to show whether Park's prerequisites are actually met.
  const [fluidncSettings, setFluidncSettings] = useState<Record<string, number> | null>(null);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [backendLog, setBackendLog] = useState<BackendLogEntry[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: 'idle' });
  // Set only by a live 'complete' broadcast (see the message handler below) -
  // by construction that only ever happens while already connected, so
  // seeing it set on a later reconnect's onopen reliably means "this
  // reconnect is the one after the update's own restart", not an unrelated
  // network blip. A blind timer would risk reloading too early (or, on a
  // slow Pi, leaving a stale page up too long); waiting for a real
  // reconnect means the backend is provably back up and responsive first.
  const awaitingReloadRef = useRef(false);
  const pendingPluginActions = useRef(new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>());

  const appendLog = useCallback((kind: LogEntry['kind'], text: string) => {
    setLog((prev) => [...prev.slice(-199), { id: logIdCounter++, kind, text }]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket;

    const connectSocket = () => {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsReady(true);
        if (awaitingReloadRef.current) {
          // The backend just came back up after the update's own restart -
          // this tab is still running the *old* JS bundle in memory (a
          // WebSocket reconnect alone never swaps that out), so a real page
          // reload is the only way to actually show the new version.
          window.location.reload();
        }
      };
      socket.onclose = () => {
        setWsReady(false);
        if (!cancelled) setTimeout(connectSocket, RECONNECT_DELAY_MS);
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'status': {
            const report = msg.data as StatusReport;
            setStatus(report);
            // WCO isn't included on every status report (Grbl/FluidNC only
            // send it periodically to save bandwidth) - remember the last
            // one seen so work position can still be derived in between.
            if (report.wco) lastWcoRef.current = report.wco;
            if (report.wpos) {
              setWorkPosition(report.wpos);
            } else if (report.mpos && lastWcoRef.current) {
              const wco = lastWcoRef.current;
              setWorkPosition({ x: report.mpos.x - wco.x, y: report.mpos.y - wco.y, z: report.mpos.z - wco.z });
            }
            break;
          }
          case 'ports':
            setPorts(msg.data as PortInfo[]);
            break;
          case 'connectionState':
            setConnectionOpen(Boolean(msg.data.isOpen));
            break;
          case 'connectionOpen':
            setConnectionOpen(true);
            appendLog('info', 'Serial port connected');
            break;
          case 'connectionClosed':
            setConnectionOpen(false);
            setStatus(null);
            setWorkPosition(null);
            lastWcoRef.current = null;
            appendLog('info', 'Serial port disconnected');
            break;
          case 'welcome':
            appendLog('welcome', msg.data as string);
            break;
          case 'feedback':
            appendLog('feedback', msg.data as string);
            break;
          case 'alarm':
            appendLog('alarm', `ALARM:${msg.data}`);
            break;
          case 'probeResult':
            setLastProbeResult(msg.data as ProbeResult);
            break;
          case 'programStatus':
            setProgramStatus(msg.data as ProgramStatus);
            break;
          case 'programLoaded':
            setProgramStatus((prev) => ({ ...prev, state: 'idle', sent: 0, total: msg.data.total }));
            appendLog('info', `Loaded ${msg.data.name} (${msg.data.total} lines)`);
            break;
          case 'programProgress':
            setProgramStatus((prev) => ({ ...prev, sent: msg.data.sent, total: msg.data.total }));
            break;
          case 'programError':
            appendLog('error', `Program error: ${msg.data}`);
            break;
          case 'settings':
            setSettings(msg.data as Settings);
            break;
          case 'plugins':
            setPlugins(msg.data as PluginInfo[]);
            break;
          case 'backendLogs':
            setBackendLog(msg.data as BackendLogEntry[]);
            break;
          case 'updateStatus': {
            const data = msg.data as UpdateStatus;
            setUpdateStatus(data);
            if (data.status === 'complete') awaitingReloadRef.current = true;
            break;
          }
          case 'backendLogLine':
            // Capped client-side too, matching the backend's own ring
            // buffer limit - otherwise a browser tab left open for days
            // would grow this array unboundedly between reloads.
            setBackendLog((prev) => [...prev.slice(-299), msg.data as BackendLogEntry]);
            break;
          case 'pluginActionResult': {
            const { result, requestId } = msg.data as { pluginId: string; actionId: string; result: unknown; requestId?: string };
            if (requestId && pendingPluginActions.current.has(requestId)) {
              pendingPluginActions.current.get(requestId)!.resolve(result);
              pendingPluginActions.current.delete(requestId);
            }
            const message = (result as { message?: string } | undefined)?.message;
            if (message) appendLog('feedback', message);
            break;
          }
          case 'pluginActionError': {
            const { error, requestId } = msg.data as { pluginId: string; actionId: string; error: string; requestId?: string };
            if (requestId && pendingPluginActions.current.has(requestId)) {
              pendingPluginActions.current.get(requestId)!.reject(new Error(error));
              pendingPluginActions.current.delete(requestId);
            } else {
              appendLog('error', error);
            }
            break;
          }
          case 'firmwareSettings': {
            const raw = msg.data as Record<string, number>;
            if (raw['$110'] !== undefined && raw['$111'] !== undefined && raw['$112'] !== undefined) {
              setMachineRates({ x: raw['$110'], y: raw['$111'], z: raw['$112'] });
            }
            setFluidncSettings(raw);
            break;
          }
          case 'commandError':
          case 'error':
          case 'portError':
            appendLog('error', msg.data as string);
            break;
          default:
            break;
        }
      };
    };

    connectSocket();
    return () => {
      cancelled = true;
      wsRef.current?.close();
    };
  }, [appendLog]);

  const send = useCallback((message: Record<string, unknown>) => {
    wsRef.current?.send(JSON.stringify(message));
  }, []);

  /** Same plugin-action call the Settings modal's test buttons use, but returns a Promise correlated by requestId - lets an on-dashboard plugin panel (see PluginPanels.tsx) await its own result instead of only getting a fire-and-forget log line. */
  const invokePluginAction = useCallback((pluginId: string, actionId: string, params?: unknown): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      pendingPluginActions.current.set(requestId, { resolve, reject });
      send({ type: 'pluginAction', pluginId, actionId, params, requestId });
    });
  }, [send]);

  // Re-fetch the machine's real rate settings every time a connection opens
  // (including reconnects), so time estimates use current values without
  // the rest of the app needing to remember to ask.
  useEffect(() => {
    if (connectionOpen) send({ type: 'getFirmwareSettings' });
  }, [connectionOpen, send]);

  return {
    wsReady,
    connectionOpen,
    status,
    workPosition,
    ports,
    log,
    lastProbeResult,
    programStatus,
    settings,
    machineRates,
    fluidncSettings,
    plugins,
    backendLog,
    updateStatus,
    send,
    invokePluginAction,
  };
}
