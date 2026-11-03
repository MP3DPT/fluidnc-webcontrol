import { useEffect, useState } from 'react';
import type { ProgramState } from '../types';

/** Clock-style duration: 9:02, or 1:04:30 once it passes an hour. */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The backend's elapsed time as of the moment the browser received it. Only a duration crosses the wire, never a timestamp, so a wrong clock on either side can't skew the timer. */
export interface JobClock {
  elapsedMs: number;
  receivedAt: number;
}

export function useJobElapsedSeconds(state: ProgramState, clock: JobClock): number {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (state !== 'running') return;
    setNow(performance.now());
    const id = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(id);
  }, [state, clock]);

  // Only a running job keeps counting on this side; paused/ended jobs are
  // frozen at the value the backend reported.
  const extra = state === 'running' ? Math.max(0, now - clock.receivedAt) : 0;
  return (clock.elapsedMs + extra) / 1000;
}
