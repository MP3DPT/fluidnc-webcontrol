import { OctagonX } from 'lucide-react';

interface Props {
  /**
   * Whether the e-stop should be live rather than muted/disabled. Tied to
   * the connection being open, not to whether a *file* is streaming - jogging,
   * homing, and manual G-code from the Console can all cause real motion too,
   * and the e-stop needs to be available for all of them, not just streaming.
   */
  active: boolean;
  send: (message: Record<string, unknown>) => void;
}

export function EmergencyStopButton({ active, send }: Props) {
  return (
    <button
      className="estop-button"
      disabled={!active}
      onClick={() => {
        // Real-time soft reset halts step generation immediately (not
        // queued behind pending motion), then stop the streaming loop so
        // it doesn't try to send more lines to a machine that's now in
        // Alarm. No confirm dialog on purpose - a confirmation step is
        // exactly wrong for an e-stop.
        send({ type: 'reset' });
        send({ type: 'stopProgram' });
      }}
    >
      <span className="estop-title">
        <OctagonX size={20} strokeWidth={2.5} />
        Emergency Stop
      </span>
      <span className="estop-subtitle">Halt motion immediately - no confirmation</span>
    </button>
  );
}
