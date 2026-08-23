import { OctagonX } from 'lucide-react';

interface Props {
  visible: boolean;
  send: (message: Record<string, unknown>) => void;
}

export function EmergencyStopButton({ visible, send }: Props) {
  if (!visible) return null;

  return (
    <div className="estop-wrap">
      <button
        className="estop-button"
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
        <OctagonX size={22} strokeWidth={2.5} />
        Emergency Stop
      </button>
      <p className="estop-hint">Halts motion immediately - no confirmation</p>
    </div>
  );
}
