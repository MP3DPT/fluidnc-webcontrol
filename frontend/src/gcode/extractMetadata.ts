import { parseToolpath, type Segment } from './parseToolpath';
import { estimateTiming } from './estimateTime';

export interface ToolInfo {
  number: number;
  /** mm - only known when a matching tool-description comment was found; G-code itself has no diameter field. */
  diameter: number | null;
  description: string | null;
}

export interface GcodeMetadata {
  units: 'mm' | 'in' | null;
  tools: ToolInfo[];
  feedRateRange: [number, number] | null;
  spindleSpeeds: number[];
  dimensions: { x: number; y: number; z: number } | null;
  /** Raw text of leading comment lines (CAM post-processors often put tool/material notes here) - shown verbatim since there's no standard format to parse. */
  headerComments: string[];
  lineCount: number;
  /**
   * Rough estimate using the file's own F feedrates and a generic rapid
   * rate (the real per-machine $110-$112 rates aren't known at save time,
   * only once connected) - same ballpark caveat as the Program tab's own
   * estimate before a machine's real rates are read.
   */
  estimatedSeconds: number;
}

const WORD_RE = /([A-Za-z])\s*(-?\d*\.?\d+)/g;
const MAX_HEADER_COMMENTS = 12;

// Fusion 360's post-processor writes tool comments like:
// "T1 D=2 CR=0 - ZMIN=-3 - flat end mill" - a documented, common convention
// for that one CAM package, not a universal G-code feature. Other CAM
// software formats this differently (or omits it), so this is a best-effort
// match, not a guarantee - the tool number itself (from T-words) is what's
// always reliable.
const FUSION_TOOL_COMMENT_RE = /^T(\d+)\s+D=([\d.]+)(?:\s*CR=[\d.]+)?(?:\s*-\s*ZMIN=-?[\d.]+)?(?:\s*-\s*(.+))?$/i;

function stripComments(line: string): string {
  return line.replace(/\(.*?\)/g, '').split(';')[0].trim();
}

/** Returns the comment text if the whole line is a comment, null if it's a command (marks the end of the header block). */
function wholeLineComment(trimmed: string): string | null {
  const paren = trimmed.match(/^\((.*)\)$/);
  if (paren) return paren[1].trim();
  if (trimmed.startsWith(';')) return trimmed.slice(1).trim();
  return null;
}

/** Scans every parenthesized comment in the file (not just the header - multi-tool jobs describe later tools further down) for the Fusion-style tool descriptor. */
function extractToolDescriptions(gcodeText: string): Map<number, { diameter: number; description: string | null }> {
  const map = new Map<number, { diameter: number; description: string | null }>();
  const commentRe = /\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = commentRe.exec(gcodeText))) {
    const match = m[1].trim().match(FUSION_TOOL_COMMENT_RE);
    if (!match) continue;
    const num = Number(match[1]);
    if (!map.has(num)) {
      map.set(num, { diameter: Number(match[2]), description: match[3]?.trim() || null });
    }
  }
  return map;
}

/**
 * Pulls whatever a G-code file happens to say about itself - there's no
 * universal standard, so this combines what's reliably computable from the
 * commands themselves (feed/spindle/tool number/size) with a best-effort
 * capture of comments, which is where CAM software puts human-readable
 * tool/material notes (including, for Fusion 360 specifically, the tool
 * diameter itself - G-code has no dedicated field for that).
 */
export function extractMetadata(gcodeText: string): GcodeMetadata {
  const rawLines = gcodeText.split(/\r?\n/);

  const headerComments: string[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const comment = wholeLineComment(trimmed);
    if (comment === null) break;
    if (comment) headerComments.push(comment);
    if (headerComments.length >= MAX_HEADER_COMMENTS) break;
  }

  const toolNumbers = new Set<number>();
  const spindleSpeeds = new Set<number>();
  let units: 'mm' | 'in' | null = null;
  let lineCount = 0;

  for (const raw of rawLines) {
    const line = stripComments(raw);
    if (!line) continue;
    lineCount++;

    const words: Record<string, number> = {};
    let m: RegExpExecArray | null;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(line))) words[m[1].toUpperCase()] = Number(m[2]);

    if (words.G === 20) units = 'in';
    if (words.G === 21) units = 'mm';
    if (words.T !== undefined) toolNumbers.add(words.T);
    if (words.S !== undefined && words.S > 0) spindleSpeeds.add(words.S);
  }

  const toolDescriptions = extractToolDescriptions(gcodeText);
  const tools: ToolInfo[] = [...toolNumbers]
    .sort((a, b) => a - b)
    .map((number) => {
      const desc = toolDescriptions.get(number);
      return { number, diameter: desc?.diameter ?? null, description: desc?.description ?? null };
    });

  const segments = parseToolpath(gcodeText);

  return {
    units,
    tools,
    feedRateRange: feedRange(segments),
    spindleSpeeds: [...spindleSpeeds].sort((a, b) => a - b),
    dimensions: boundingBoxSize(segments),
    headerComments,
    lineCount,
    estimatedSeconds: estimateTiming(segments, null).totalSeconds,
  };
}

function boundingBoxSize(segments: Segment[]): { x: number; y: number; z: number } | null {
  if (segments.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.x1, s.x2);
    maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxY = Math.max(maxY, s.y1, s.y2);
    minZ = Math.min(minZ, s.z1, s.z2);
    maxZ = Math.max(maxZ, s.z1, s.z2);
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}

function feedRange(segments: Segment[]): [number, number] | null {
  const feeds = segments.filter((s) => !s.rapid && s.feedrate > 0).map((s) => s.feedrate);
  if (feeds.length === 0) return null;
  return [Math.min(...feeds), Math.max(...feeds)];
}

function formatTool(t: ToolInfo): string {
  if (t.diameter == null) return `T${t.number}`;
  return `T${t.number} ⌀${t.diameter}mm${t.description ? ` ${t.description}` : ''}`;
}

/** One compact line for the Program tab - just tool/feed/spindle/size, skipping whatever the file didn't have. Null if there's nothing to show at all. */
export function formatMetadataSummary(m: GcodeMetadata): string | null {
  const parts: string[] = [];

  if (m.tools.length > 0) {
    parts.push(`Tool${m.tools.length > 1 ? 's' : ''} ${m.tools.map(formatTool).join(', ')}`);
  }
  if (m.feedRateRange) {
    const [lo, hi] = m.feedRateRange;
    parts.push(`Feed ${lo === hi ? lo : `${lo}–${hi}`} mm/min`);
  }
  if (m.spindleSpeeds.length > 0) {
    const lo = m.spindleSpeeds[0];
    const hi = m.spindleSpeeds[m.spindleSpeeds.length - 1];
    parts.push(`Spindle ${lo === hi ? lo : `${lo}–${hi}`} RPM`);
  }
  if (m.dimensions) {
    const { x, y, z } = m.dimensions;
    parts.push(`Size ${x.toFixed(1)}×${y.toFixed(1)}×${z.toFixed(1)} mm`);
  }

  return parts.length > 0 ? parts.join(' · ') : null;
}
