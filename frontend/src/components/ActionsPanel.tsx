import { Home, RotateCcw, Unlock as UnlockIcon, Zap } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { EmergencyStopButton } from './EmergencyStopButton';

interface Props {
  disabled: boolean;
  /** Whether the e-stop should be active (the connection is open) rather than muted/disabled. */
  estopActive: boolean;
  /**
   * Connected, but $H hasn't completed successfully yet this session -
   * pulses the Home button to draw the eye to it. There's no reliable way
   * to ask the controller itself "were you already homed before this app
   * connected?" (see connection.ts's `homed` field), so every fresh
   * connection is treated as needing a home, even if the machine was
   * actually homed earlier and just never lost power - a false "please
   * home" nudge is a much smaller cost than the alternative, confirmed by
   * a real crash when Park trusted an un-homed controller's position.
   */
  needsHoming: boolean;
  send: (message: Record<string, unknown>) => void;
}

// Park used to live here - moved next to Jog Control (see ParkCluster,
// rendered from JogPanel) since that's where someone actually reaches for
// it: clearing the spindle out of the way while placing material, right
// alongside the jog buttons they'd otherwise use for the same job.
export function ActionsPanel({ disabled, estopActive, needsHoming, send }: Props) {
  return (
    <Card>
      <CardHeader>
        <Zap size={14} />
        Actions
      </CardHeader>
      <CardContent className="button-stack">
        <div className="actions-grid">
          <button
            className={needsHoming ? 'attention-pulse' : undefined}
            disabled={disabled}
            title={needsHoming ? '$H - home the machine before using Park or trusting soft limits' : '$H'}
            onClick={() => send({ type: 'home' })}
          >
            <Home size={15} />
            Home
          </button>
          <button disabled={disabled} title="$X" onClick={() => send({ type: 'unlock' })}>
            <UnlockIcon size={15} />
            Unlock
          </button>
          <button className="warning full-width" disabled={disabled} onClick={() => send({ type: 'reset' })}>
            <RotateCcw size={15} />
            Soft Reset
          </button>
        </div>

        <EmergencyStopButton active={estopActive} send={send} />
      </CardContent>
    </Card>
  );
}
