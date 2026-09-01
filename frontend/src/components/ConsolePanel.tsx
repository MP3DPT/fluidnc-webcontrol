import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { LogEntry } from '../types';

interface Props {
  log: LogEntry[];
  disabled: boolean;
  autoFeedEnabled: boolean;
  defaultFeed: number;
  /** Owned by the parent (not this panel) - the Console tab bar's Auto-scroll switch lives outside this component. */
  autoScroll: boolean;
  /** Owned by the parent too, alongside autoScroll - toggled from the same tab bar. Swaps the log to a much taller height for easier debugging. */
  expanded: boolean;
  send: (message: Record<string, unknown>) => void;
}

// Matches a feed-move word (G1/G2/G3, with or without a leading zero, with
// or without a space before whatever follows) without also matching inside
// a longer G-word like G10 or G12 - the (?!\d) rules out a following digit.
const FEED_MOVE = /G0*[123](?!\d)/i;
const HAS_FEED_WORD = /F[-+]?[\d.]/i;

export function ConsolePanel({ log, disabled, autoFeedEnabled, defaultFeed, autoScroll, expanded, send }: Props) {
  const [command, setCommand] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  // Re-runs on every new log line, and also the moment the checkbox is
  // turned back on - so re-enabling it snaps straight back to the bottom
  // instead of waiting for the next line to arrive.
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log, autoScroll]);

  const submit = () => {
    const trimmed = command.trim();
    if (!trimmed) return;

    // A bare "G1 Z0" with no F word of its own gets rejected by FluidNC as
    // "undefined feed rate" the first time it's ever used in a session -
    // append the user's configured default instead of making them retype it.
    const line =
      autoFeedEnabled && FEED_MOVE.test(trimmed) && !HAS_FEED_WORD.test(trimmed)
        ? `${trimmed} F${defaultFeed}`
        : trimmed;

    send({ type: 'gcode', line });
    setCommand('');
  };

  return (
    <div className="console">
      <div className={expanded ? 'log expanded' : 'log'} ref={logRef}>
        {log.map((entry) => (
          <div key={entry.id} className={`log-line log-${entry.kind}`}>
            {entry.text}
          </div>
        ))}
      </div>
      <div className="row">
        <input
          type="text"
          value={command}
          placeholder="Send raw G-code / $ command…"
          disabled={disabled}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button disabled={disabled} onClick={submit}>
          <CornerDownLeft size={15} />
          Send
        </button>
      </div>
    </div>
  );
}
