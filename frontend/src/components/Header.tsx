import { useEffect, useState } from 'react';
import { Maximize, Minimize, Power, RotateCw, PowerOff } from 'lucide-react';
import { Badge } from './ui/Badge';
import { IconButton } from './ui/IconButton';
import { machineStateTone } from '../lib/machineState';
import type { StatusReport } from '../types';

interface Props {
  wsReady: boolean;
  connectionOpen: boolean;
  status: StatusReport | null;
  programRunning: boolean;
  send: (message: Record<string, unknown>) => void;
}

export function Header({ wsReady, connectionOpen, status, programRunning, send }: Props) {
  const [powerOpen, setPowerOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // A dedicated machine controller running on its own screen has no
  // business showing browser chrome - this is the one-click way there,
  // tracked so the icon reflects reality even if fullscreen is left via
  // Esc/F11 instead of the button itself.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };

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
          <img src="/logo.png" alt="" />
        </span>
        <div className="header-titles">
          <h1>fluidnc-webcontrol</h1>
          <span className="tagline">free &amp; open source</span>
        </div>
      </div>

      <div className="header-right">
        <Badge tone={machineTone} pulse={shouldPulse} className="machine-badge">
          MACHINE: {machineLabel}
        </Badge>

        <div className="header-actions">
          <IconButton onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
            {isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          </IconButton>

          <IconButton onClick={() => setPowerOpen((v) => !v)} aria-label="Power options">
            <Power size={17} />
          </IconButton>
        </div>
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
