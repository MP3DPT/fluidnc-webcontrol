import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry, PluginInfo, PortInfo, Position, ProbeResult, ProgramStatus, Settings, StatusReport } from '../types';
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
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

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

      socket.onopen = () => setWsReady(true);
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
          case 'pluginActionResult': {
            const { result } = msg.data as { pluginId: string; actionId: string; result: unknown };
            const message = (result as { message?: string } | undefined)?.message;
            if (message) appendLog('feedback', message);
            break;
          }
          case 'firmwareSettings': {
            const raw = msg.data as Record<string, number>;
            if (raw['$110'] !== undefined && raw['$111'] !== undefined && raw['$112'] !== undefined) {
              setMachineRates({ x: raw['$110'], y: raw['$111'], z: raw['$112'] });
            }
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
    plugins,
    send,
  };
}
