import { Home, RotateCcw, Unlock as UnlockIcon, Zap } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { EmergencyStopButton } from './EmergencyStopButton';

interface Props {
  disabled: boolean;
  /** Whether the e-stop should be active (the connection is open) rather than muted/disabled. */
  estopActive: boolean;
  send: (message: Record<string, unknown>) => void;
}

export function ActionsPanel({ disabled, estopActive, send }: Props) {
  return (
    <Card>
      <CardHeader>
        <Zap size={14} />
        Actions
      </CardHeader>
      <CardContent className="button-stack">
        <div className="actions-grid">
          <button disabled={disabled} title="$H" onClick={() => send({ type: 'home' })}>
            <Home size={15} />
            Home
          </button>
          <button disabled={disabled} title="$X" onClick={() => send({ type: 'unlock' })}>
            <UnlockIcon size={15} />
            Unlock
          </button>
          <button className="danger full-width" disabled={disabled} onClick={() => send({ type: 'reset' })}>
            <RotateCcw size={15} />
            Soft Reset
          </button>
        </div>

        <EmergencyStopButton active={estopActive} send={send} />
      </CardContent>
    </Card>
  );
}
