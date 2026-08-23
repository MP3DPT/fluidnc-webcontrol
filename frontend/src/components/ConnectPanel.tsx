import { useEffect, useState } from 'react';
import { Cable, CheckCircle2, CircleOff, Power, RefreshCw, XCircle } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import type { PortInfo } from '../types';

interface Props {
  ports: PortInfo[];
  connectionOpen: boolean;
  wsReady: boolean;
  send: (message: Record<string, unknown>) => void;
}

export function ConnectPanel({ ports, connectionOpen, wsReady, send }: Props) {
  const [selectedPath, setSelectedPath] = useState('');

  useEffect(() => {
    if (wsReady) send({ type: 'listPorts' });
  }, [wsReady, send]);

  useEffect(() => {
    if (!selectedPath && ports.length > 0) setSelectedPath(ports[0].path);
  }, [ports, selectedPath]);

  const statusClass = !wsReady ? 'offline' : connectionOpen ? 'online' : 'warn';
  const statusLabel = !wsReady ? 'Offline' : connectionOpen ? 'Connected' : 'Disconnected';
  const StatusIcon = !wsReady ? XCircle : connectionOpen ? CheckCircle2 : CircleOff;

  return (
    <Card>
      <CardHeader>
        <Cable size={14} />
        Connection
      </CardHeader>
      <CardContent>
        <div className="row">
          <select
            className="port-select"
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            disabled={connectionOpen}
          >
            {ports.length === 0 && <option value="">No ports found</option>}
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
              </option>
            ))}
          </select>
          <button className="btn-square" onClick={() => send({ type: 'listPorts' })} aria-label="Refresh ports">
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="connection-status-row">
          <span className={`connection-status ${statusClass}`}>
            <StatusIcon size={15} />
            {statusLabel}
          </span>
          {connectionOpen ? (
            <button className="danger" onClick={() => send({ type: 'disconnect' })}>
              <Power size={14} />
              Disconnect
            </button>
          ) : (
            <button
              className="primary"
              disabled={!selectedPath}
              onClick={() => send({ type: 'connect', path: selectedPath, baud: 115200 })}
            >
              <Power size={14} />
              Connect
            </button>
          )}
        </div>

        <p className="hint">
          Backend: {wsReady ? 'connected' : 'reconnecting…'} · Serial: {connectionOpen ? 'open' : 'closed'}
        </p>
      </CardContent>
    </Card>
  );
}
