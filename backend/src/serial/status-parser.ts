import type { MachineState, PinState, Position, StatusReport } from './types.js';

function parsePosition(value: string): Position {
  const [x, y, z, a, b, c] = value.split(',').map(Number);
  const pos: Position = { x, y, z };
  if (!Number.isNaN(a)) pos.a = a;
  if (!Number.isNaN(b)) pos.b = b;
  if (!Number.isNaN(c)) pos.c = c;
  return pos;
}

function parsePins(value: string): PinState {
  return {
    x: value.includes('X'),
    y: value.includes('Y'),
    z: value.includes('Z'),
    probe: value.includes('P'),
    door: value.includes('D'),
    hold: value.includes('H'),
    softReset: value.includes('R'),
    cycleStart: value.includes('S'),
  };
}

/**
 * Parses a FluidNC/Grbl real-time status report, e.g.:
 * <Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:XYZP|Ov:100,100,100|WCO:0.000,0.000,0.000>
 */
export function parseStatusReport(line: string): StatusReport | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) return null;

  const inner = trimmed.slice(1, -1);
  const fields = inner.split('|');
  const state = (fields.shift() as MachineState) ?? 'Unknown';

  const report: StatusReport = { state, raw: trimmed };

  for (const field of fields) {
    const sepIndex = field.indexOf(':');
    if (sepIndex === -1) continue;
    const key = field.slice(0, sepIndex);
    const value = field.slice(sepIndex + 1);

    switch (key) {
      case 'MPos':
        report.mpos = parsePosition(value);
        break;
      case 'WPos':
        report.wpos = parsePosition(value);
        break;
      case 'WCO':
        report.wco = parsePosition(value);
        break;
      case 'FS': {
        const [feed, speed] = value.split(',').map(Number);
        report.feed = feed;
        report.speed = speed;
        break;
      }
      case 'Pn':
        report.pins = parsePins(value);
        break;
      case 'Ov': {
        const [feed, rapid, spindle] = value.split(',').map(Number);
        report.overrides = { feed, rapid, spindle };
        break;
      }
      default:
        // Bf (buffer), Ln (line number), A (accessory state), etc. are
        // intentionally ignored for now - add here as the UI needs them.
        break;
    }
  }

  return report;
}

/**
 * Parses a probe result feedback line, e.g.:
 * [PRB:0.000,0.000,-12.345:1]
 * The trailing 0/1 flag is whether the probe was actually triggered.
 */
export function parseProbeResult(line: string): { position: Position; success: boolean } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('[PRB:') || !trimmed.endsWith(']')) return null;

  const inner = trimmed.slice(5, -1); // strip "[PRB:" and "]"
  const [coords, successFlag] = inner.split(':');
  return {
    position: parsePosition(coords),
    success: successFlag === '1',
  };
}

export function parseAlarm(line: string): number | null {
  const match = line.trim().match(/^ALARM:(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function parseError(line: string): number | null {
  const match = line.trim().match(/^error:(\d+)$/);
  return match ? Number(match[1]) : null;
}
