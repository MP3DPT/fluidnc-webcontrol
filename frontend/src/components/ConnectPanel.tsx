import { useEffect, useState } from 'react';
import { Cable, RefreshCw } from 'lucide-react';
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

  return (
    <Card>
      <CardHeader>
        <Cable size={14} />
        Connection
      </CardHeader>
      <CardContent>
        <div className="row">
          <select
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
          <button onClick={() => send({ type: 'listPorts' })}>
            <RefreshCw size={14} />
            Refresh
          </button>
          {connectionOpen ? (
            <button className="danger" onClick={() => send({ type: 'disconnect' })}>
              Disconnect
            </button>
          ) : (
            <button
              className="primary"
              disabled={!selectedPath}
              onClick={() => send({ type: 'connect', path: selectedPath, baud: 115200 })}
            >
              Connect
            </button>
          )}
        </div>
        <p className="hint">
          <span className={`status-dot ${statusClass}`} style={{ marginRight: '0.4rem' }} />
          Backend: {wsReady ? 'connected' : 'reconnecting…'} · Serial: {connectionOpen ? 'open' : 'closed'}
        </p>
      </CardContent>
    </Card>
  );
}
