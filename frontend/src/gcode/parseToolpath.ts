export interface Segment {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  rapid: boolean;
  /** Active feedrate (mm/min) for this move - irrelevant for rapids, which use the machine's max rate instead. */
  feedrate: number;
  /**
   * Index into the same non-blank, comment-stripped line list the backend's
   * ProgramRunner streams from (see backend/src/program/runner.ts toLines) -
   * lets the UI shade "already sent" vs "pending" segments against
   * programStatus.sent. The two line-filtering implementations must stay in
   * sync for this to line up; a shared package would remove that risk.
   */
  lineIndex: number;
}

interface ModalState {
  x: number;
  y: number;
  z: number;
  absolute: boolean; // G90 (true) vs G91 (false)
  inches: boolean; // G20 (true) vs G21 (false)
  motion: 0 | 1 | 2 | 3; // last seen G0/G1/G2/G3
  feed: number; // mm/min, modal - stays in effect until a new F word appears
}

const WORD_RE = /([A-Za-z])\s*(-?\d*\.?\d+)/g;

function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').split(';')[0].trim();
}

function parseWords(line: string): Record<string, number> {
  const words: Record<string, number> = {};
  let match: RegExpExecArray | null;
  WORD_RE.lastIndex = 0;
  while ((match = WORD_RE.exec(line))) {
    words[match[1].toUpperCase()] = Number(match[2]);
  }
  return words;
}

/** Tessellates a G2/G3 arc (I/J center format, with R-format fallback) into line segments. */
function arcSegments(
  start: { x: number; y: number },
  end: { x: number; y: number },
  words: Record<string, number>,
  clockwise: boolean,
): { x: number; y: number }[] {
  let cx: number;
  let cy: number;

  if (words.I !== undefined || words.J !== undefined) {
    cx = start.x + (words.I ?? 0);
    cy = start.y + (words.J ?? 0);
  } else if (words.R !== undefined) {
    const r = words.R;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const h = Math.sqrt(Math.max(r * r - (dist * dist) / 4, 0));
    // Perpendicular direction; sign choice follows the conventional R-arc rule.
    const perp = { x: -dy / (dist || 1), y: dx / (dist || 1) };
    const sign = (r >= 0) === clockwise ? -1 : 1;
    cx = mid.x + perp.x * h * sign;
    cy = mid.y + perp.y * h * sign;
  } else {
    // No center info - can't resolve an arc, fall back to a straight line.
    return [end];
  }

  const radius = Math.hypot(start.x - cx, start.y - cy);
  let startAngle = Math.atan2(start.y - cy, start.x - cx);
  let endAngle = Math.atan2(end.y - cy, end.x - cx);

  const fullCircle = Math.hypot(start.x - end.x, start.y - end.y) < 1e-6;
  if (clockwise) {
    if (endAngle >= startAngle) endAngle -= 2 * Math.PI;
    if (fullCircle) endAngle = startAngle - 2 * Math.PI;
  } else {
    if (endAngle <= startAngle) endAngle += 2 * Math.PI;
    if (fullCircle) endAngle = startAngle + 2 * Math.PI;
  }

  const sweep = Math.abs(endAngle - startAngle);
  const steps = Math.max(4, Math.ceil((sweep * 180) / Math.PI / 8)); // ~8deg per segment
  const points: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / steps);
    points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  return points;
}

/**
 * Parses G-code text into flat line segments for a top-down toolpath
 * preview. Handles G0/G1 straight moves and G2/G3 arcs (I/J or R form),
 * G90/G91 absolute/incremental, and G20/G21 unit conversion (normalizes
 * everything to millimeters). Unsupported words are ignored rather than
 * rejected, since the goal is a visual preview, not a validating parser.
 */
export function parseToolpath(gcodeText: string): Segment[] {
  const state: ModalState = { x: 0, y: 0, z: 0, absolute: true, inches: false, motion: 0, feed: 0 };
  const segments: Segment[] = [];

  const lines = gcodeText.split(/\r?\n/).map(stripComments).filter(Boolean);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const words = parseWords(line);
    if (words.G === 90) state.absolute = true;
    if (words.G === 91) state.absolute = false;
    if (words.G === 20) state.inches = true;
    if (words.G === 21) state.inches = false;
    if (words.G === 0 || words.G === 1 || words.G === 2 || words.G === 3) {
      state.motion = words.G as 0 | 1 | 2 | 3;
    }

    const scale = state.inches ? 25.4 : 1;
    // F is modal and may appear on a line with no X/Y/Z - track it even
    // when this particular line doesn't itself produce a segment.
    if (words.F !== undefined) state.feed = words.F * scale;

    const hasTarget = words.X !== undefined || words.Y !== undefined || words.Z !== undefined;
    if (!hasTarget) continue;

    const target = { x: state.x, y: state.y, z: state.z };
    if (words.X !== undefined) target.x = state.absolute ? words.X * scale : state.x + words.X * scale;
    if (words.Y !== undefined) target.y = state.absolute ? words.Y * scale : state.y + words.Y * scale;
    if (words.Z !== undefined) target.z = state.absolute ? words.Z * scale : state.z + words.Z * scale;

    const rapid = state.motion === 0;

    if (state.motion === 2 || state.motion === 3) {
      const scaledWords = { ...words };
      if (scaledWords.I !== undefined) scaledWords.I *= scale;
      if (scaledWords.J !== undefined) scaledWords.J *= scale;
      if (scaledWords.R !== undefined) scaledWords.R *= scale;
      const points = arcSegments(state, target, scaledWords, state.motion === 2);
      let prev = { x: state.x, y: state.y };
      for (const pt of points) {
        segments.push({
          x1: prev.x,
          y1: prev.y,
          z1: state.z,
          x2: pt.x,
          y2: pt.y,
          z2: target.z,
          rapid: false,
          feedrate: state.feed,
          lineIndex,
        });
        prev = pt;
      }
    } else {
      segments.push({
        x1: state.x,
        y1: state.y,
        z1: state.z,
        x2: target.x,
        y2: target.y,
        z2: target.z,
        rapid,
        feedrate: state.feed,
        lineIndex,
      });
    }

    state.x = target.x;
    state.y = target.y;
    state.z = target.z;
  }

  return segments;
}
