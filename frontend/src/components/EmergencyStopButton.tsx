import { OctagonX } from 'lucide-react';

interface Props {
  /** True only while a program is actively running - the one time an e-stop mid-motion actually matters. */
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
