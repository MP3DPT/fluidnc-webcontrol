import { useState } from 'react';
import { Cpu, Power, RotateCw, Settings, PowerOff } from 'lucide-react';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';
import { machineStateTone } from '../lib/machineState';
import type { StatusReport } from '../types';

interface Props {
  wsReady: boolean;
  connectionOpen: boolean;
  status: StatusReport | null;
  programRunning: boolean;
  onOpenSettings: () => void;
  send: (message: Record<string, unknown>) => void;
}

export function Header({ wsReady, connectionOpen, status, programRunning, onOpenSettings, send }: Props) {
  const [powerOpen, setPowerOpen] = useState(false);

  // The one badge that's always visible regardless of scroll position -
  // the app's single Level-1 "is it safe, is it working" signal. Falls
  // back through backend -> board -> actual run state, worst-case first.
  const machineTone = !wsReady ? 'danger' : !connectionOpen ? 'neutral' : machineStateTone(status?.state);
  const machineLabel = !wsReady ? 'OFFLINE' : !connectionOpen ? 'DISCONNECTED' : (status?.state ?? 'IDLE').toUpperCase();
  const shouldPulse = wsReady && connectionOpen && (status?.state === 'Run' || status?.state === 'Alarm');

  const confirmPower = (action: 'systemReboot' | 'systemShutdown', label: string) => {
    const warning = programRunning ? ' A program is currently running on the machine!' : '';
    if (window.confirm(`${label} the Raspberry Pi now?${warning}`)) {
      send({ type: action });
    }
    setPowerOpen(false);
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <span className="app-logo">
          <Cpu size={20} strokeWidth={2} />
        </span>
        <h1>fluidnc-webcontrol</h1>
        <span className="tagline">free &amp; open source</span>
      </div>

      <div className="header-right">
        <Badge tone={machineTone} pulse={shouldPulse} className="machine-badge">
          MACHINE: {machineLabel}
        </Badge>

        <IconButton onClick={onOpenSettings} aria-label="Settings">
          <Settings size={17} />
        </IconButton>

        <IconButton onClick={() => setPowerOpen((v) => !v)} aria-label="Power options">
          <Power size={17} />
        </IconButton>
        {powerOpen && (
          <div className="dropdown-panel right">
            <div className="row">
              <button onClick={() => confirmPower('systemReboot', 'Reboot')}>
                <RotateCw size={15} />
                Reboot Pi
              </button>
              <button className="danger" onClick={() => confirmPower('systemShutdown', 'Shut down')}>
                <PowerOff size={15} />
                Shut Down Pi
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
