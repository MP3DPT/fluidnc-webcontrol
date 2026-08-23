import type { Segment } from './parseToolpath';

export interface MachineRates {
  x: number; // mm/min, from FluidNC's $110
  y: number; // $111
  z: number; // $112
}

export interface TimingEstimate {
  totalSeconds: number;
  /** Cumulative seconds elapsed by the time each segment (same index as the input array) completes. */
  cumulativeSeconds: number[];
  /** Distinct Z depths seen on cutting moves - the CNC analog of a 3D printer's "layers". */
  passCount: number;
}

// Used only until the machine's real $110-$112 rates are known (or if never
// connected) - a rough fallback so an estimate is still shown, not the
// number actually driving the math once real rates are available.
const FALLBACK_RAPID_RATE = 3000; // mm/min
const FALLBACK_FEED_RATE = 1000; // mm/min, used only if a cut move somehow never had F set

const Z_LEVEL_PRECISION = 3; // decimal places - groups near-identical depths into one pass

/**
 * Estimates job duration directly from the G-code and the machine's real
 * configured rates - no physical calibration cut needed. Cutting moves use
 * their explicit F feedrate (already in the file); rapids use the
 * machine's actual max rate per axis, read live via $$ ($110/$111/$112).
 *
 * This is the simple version: distance / rate per move, summed. It does
 * not model acceleration/deceleration at direction changes, so it will
 * under-estimate files with lots of short segments (tight detail work) -
 * a trapezoidal velocity-profile version would be more accurate but is a
 * meaningfully bigger lift, and is a reasonable follow-up rather than a
 * blocker for a first useful estimate.
 */
export function estimateTiming(segments: Segment[], rates: MachineRates | null): TimingEstimate {
  const cumulativeSeconds: number[] = [];
  const zLevels = new Set<number>();
  let totalMinutes = 0;

  for (const seg of segments) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const dz = seg.z2 - seg.z1;

    let minutes: number;
    if (seg.rapid) {
      // Grbl/FluidNC coordinated rapids move every axis at its own max
      // rate simultaneously, arriving together - duration is set by
      // whichever axis takes longest, not the combined vector distance.
      const rx = rates?.x ?? FALLBACK_RAPID_RATE;
      const ry = rates?.y ?? FALLBACK_RAPID_RATE;
      const rz = rates?.z ?? FALLBACK_RAPID_RATE;
      minutes = Math.max(
        rx > 0 ? Math.abs(dx) / rx : 0,
        ry > 0 ? Math.abs(dy) / ry : 0,
        rz > 0 ? Math.abs(dz) / rz : 0,
      );
    } else {
      const distance = Math.hypot(dx, dy, dz);
      const feed = seg.feedrate > 0 ? seg.feedrate : FALLBACK_FEED_RATE;
      minutes = distance / feed;
      zLevels.add(Number(seg.z2.toFixed(Z_LEVEL_PRECISION)));
    }

    totalMinutes += minutes;
    cumulativeSeconds.push(totalMinutes * 60);
  }

  return {
    totalSeconds: totalMinutes * 60,
    cumulativeSeconds,
    passCount: zLevels.size || (segments.length > 0 ? 1 : 0),
  };
}

/** Elapsed seconds covered by lines already sent (ProgramStatus.sent), for a live remaining-time countdown. */
export function elapsedSecondsAt(segments: Segment[], timing: TimingEstimate, sentLines: number): number {
  let elapsed = 0;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].lineIndex >= sentLines) break;
    elapsed = timing.cumulativeSeconds[i];
  }
  return elapsed;
}

/** Which pass (1-based) the given Z depth falls in, counting distinct cut Z-levels in file order. */
export function currentPassAt(segments: Segment[], sentLines: number): number {
  const seen = new Set<number>();
  let pass = 0;
  for (const seg of segments) {
    if (seg.lineIndex >= sentLines) break;
    if (seg.rapid) continue;
    const z = Number(seg.z2.toFixed(Z_LEVEL_PRECISION));
    if (!seen.has(z)) {
      seen.add(z);
      pass = seen.size;
    }
  }
  return pass;
}

export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
