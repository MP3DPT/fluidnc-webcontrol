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
  /** Oldest first, newest last - what's actually been typed and sent from this input, persisted on the backend (see ConsoleHistoryStore) so it survives a page reload and a Pi reboot, and is shared across whatever browser/device connects. */
  history: string[];
  send: (message: Record<string, unknown>) => void;
}

// Matches a feed-move word (G1/G2/G3, with or without a leading zero, with
// or without a space before whatever follows) without also matching inside
// a longer G-word like G10 or G12 - the (?!\d) rules out a following digit.
const FEED_MOVE = /G0*[123](?!\d)/i;
const HAS_FEED_WORD = /F[-+]?[\d.]/i;

export function ConsolePanel({ log, disabled, autoFeedEnabled, defaultFeed, autoScroll, expanded, history, send }: Props) {
  const [command, setCommand] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  // null = editing a fresh line (the "draft"), not browsing history. A
  // number is how far back into `history` (counting from its newest end)
  // Up/Down has currently navigated to - same shape a shell's own history
  // browsing uses. `draftRef` holds whatever was being typed before the
  // first Up press, so Down can hand it back once you've paged past the
  // most recent entry again, instead of just leaving the field empty.
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef('');

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
    // The exact text typed, not the auto-feed-expanded version - history
    // should read back the same thing that was actually typed.
    send({ type: 'consoleHistoryAdd', line: trimmed });
    setCommand('');
    setHistoryIndex(null);
    draftRef.current = '';
  };

  const recallHistory = (direction: 'older' | 'newer') => {
    if (history.length === 0) return;
    if (direction === 'older') {
      if (historyIndex === null) {
        draftRef.current = command;
        const nextIndex = history.length - 1;
        setHistoryIndex(nextIndex);
        setCommand(history[nextIndex]);
      } else if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setCommand(history[nextIndex]);
      }
    } else {
      if (historyIndex === null) return;
      if (historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        setCommand(history[nextIndex]);
      } else {
        setHistoryIndex(null);
        setCommand(draftRef.current);
      }
    }
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
          placeholder="Send raw G-code / $ command… (↑↓ for history)"
          disabled={disabled}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            else if (e.key === 'ArrowUp') {
              e.preventDefault();
              recallHistory('older');
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              recallHistory('newer');
            }
          }}
        />
        <button disabled={disabled} onClick={submit}>
          <CornerDownLeft size={15} />
          Send
        </button>
      </div>
    </div>
  );
}
