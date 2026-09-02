import { useEffect, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowDownRight,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  LocateFixed,
  Move,
} from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { CoordinateDisplay } from './ui/CoordinateDisplay';
import { Divider } from './ui/Divider';
import { ParkCluster } from './ParkCluster';
import type { MachineState, Position, Settings } from '../types';

const DEFAULT_STEP_SIZES = [0.1, 1, 10, 50];
const FEED_INCREMENT = 10;

// CNCjs convention: arrows for X/Y, Page Up/Down for Z.
const KEY_JOG_MAP: Record<string, { X?: number; Y?: number; Z?: number }> = {
  ArrowUp: { Y: 1 },
  ArrowDown: { Y: -1 },
  ArrowLeft: { X: -1 },
  ArrowRight: { X: 1 },
  PageUp: { Z: 1 },
  PageDown: { Z: -1 },
};

interface Props {
  disabled: boolean;
  /** Whether Park's real prerequisites (soft limits enabled, max travel configured - see connection.ts's park()) are actually met, not just whether the connection is open. */
  parkReady: boolean;
  machineState: MachineState | null;
  workPosition: Position | null;
  settings: Settings | null;
  send: (message: Record<string, unknown>) => void;
}

export function JogPanel({ disabled, parkReady, machineState, workPosition, settings, send }: Props) {
  const stepSizes = settings?.general.jogStepSizes ?? DEFAULT_STEP_SIZES;
  const [step, setStep] = useState(1);
  const [feedrate, setFeedrate] = useState(1000);

  // The configured step list can change at any time (Settings panel, or a
  // different browser tab editing it) - if the currently-selected step is
  // no longer one of the options, the <select> would silently show nothing
  // selected while `step` still held a stale, no-longer-visible value.
  useEffect(() => {
    if (!stepSizes.includes(step)) setStep(stepSizes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepSizes]);

  const jog = (deltas: { X?: number; Y?: number; Z?: number }) => send({ type: 'jog', deltas, feedrate });
  const gcode = (line: string) => send({ type: 'gcode', line });
  const zero = (axis: 'X' | 'Y' | 'Z') => gcode(`G10 L20 P1 ${axis}0`);

  // Keyboard jogging, matching CNCjs - only while connected, and never
  // while focus is in a text field/select (which need arrow keys for their
  // own normal behavior, e.g. incrementing a number input).
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const unit = KEY_JOG_MAP[e.key];
      if (!unit) return;

      e.preventDefault();
      const deltas: { X?: number; Y?: number; Z?: number } = {};
      if (unit.X) deltas.X = unit.X * step;
      if (unit.Y) deltas.Y = unit.Y * step;
      if (unit.Z) deltas.Z = unit.Z * step;
      jog(deltas);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // "ok" for a $J= line means accepted, not finished - holding a key
      // sends jog commands faster than they physically execute, so on
      // release we must explicitly flush FluidNC's own jog buffer or it
      // keeps moving for a few seconds on its own.
      if (!KEY_JOG_MAP[e.key]) return;
      send({ type: 'jogCancel' });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, step, feedrate]);

  return (
    <Card>
      <CardHeader>
        <Move size={14} />
        Jog Control
      </CardHeader>
      <CardContent>
        <div>
          <span className="jog-axis-tag" style={{ textAlign: 'left', marginBottom: '0.4rem' }}>
            Work position
          </span>
          <CoordinateDisplay
            axes={[
              { label: 'X', value: workPosition?.x ?? null },
              { label: 'Y', value: workPosition?.y ?? null },
              { label: 'Z', value: workPosition?.z ?? null },
            ]}
          />
        </div>

        <Divider />

        <div className="row jog-rate-row">
          <label className="field-step">
            Step
            <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
              {stepSizes.map((s) => (
                <option key={s} value={s}>
                  {s} mm
                </option>
              ))}
            </select>
          </label>
          <label className="field-feed">
            Feed
            <span className="feed-input">
              <input
                type="number"
                value={feedrate}
                min={1}
                onChange={(e) => setFeedrate(Math.max(1, Number(e.target.value)))}
              />
              <span className="feed-suffix">
                <span className="feed-unit">mm/min</span>
                <span className="feed-spin">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Increase feed"
                    onClick={() => setFeedrate((f) => f + FEED_INCREMENT)}
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Decrease feed"
                    onClick={() => setFeedrate((f) => Math.max(1, f - FEED_INCREMENT))}
                  >
                    <ChevronDown size={12} />
                  </button>
                </span>
              </span>
            </span>
          </label>
        </div>

        <div className="jog-control">
          <div className="jog-cluster">
            <div>
              <span className="jog-axis-tag">X / Y</span>
              <div className="jog-compass">
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ X: -step, Y: step })} aria-label="Jog X- Y+">
                  <ArrowUpLeft size={19} />
                </button>
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ Y: step })} aria-label="Jog Y+">
                  <ArrowUp size={21} />
                </button>
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ X: step, Y: step })} aria-label="Jog X+ Y+">
                  <ArrowUpRight size={19} />
                </button>

                <button className="jog-btn" disabled={disabled} onClick={() => jog({ X: -step })} aria-label="Jog X-">
                  X-
                </button>
                <button
                  className="jog-btn jog-hub"
                  disabled={disabled}
                  title="Rapid to work X0 Y0"
                  onClick={() => gcode('G90 G0 X0 Y0')}
                >
                  0,0
                </button>
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ X: step })} aria-label="Jog X+">
                  X+
                </button>

                <button className="jog-btn" disabled={disabled} onClick={() => jog({ X: -step, Y: -step })} aria-label="Jog X- Y-">
                  <ArrowDownLeft size={19} />
                </button>
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ Y: -step })} aria-label="Jog Y-">
                  <ArrowDown size={21} />
                </button>
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ X: step, Y: -step })} aria-label="Jog X+ Y-">
                  <ArrowDownRight size={19} />
                </button>
              </div>
            </div>

            <div>
              <span className="jog-axis-tag">Z</span>
              <div className="jog-z-strip">
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ Z: step })} aria-label="Jog Z+">
                  <ArrowUp size={21} />
                </button>
                <button className="jog-btn jog-hub" disabled title="Vertical axis">
                  Z
                </button>
                <button className="jog-btn" disabled={disabled} onClick={() => jog({ Z: -step })} aria-label="Jog Z-">
                  <ArrowDown size={21} />
                </button>
              </div>
            </div>
          </div>

          <Divider />

          <ParkCluster
            disabled={disabled}
            parkReady={parkReady}
            machineState={machineState}
            defaultParkX={settings?.general.parkX ?? 'home'}
            defaultParkY={settings?.general.parkY ?? 'home'}
            send={send}
          />

          <div className="jog-zero-row">
            <button className="tertiary" disabled={disabled} onClick={() => zero('X')}>
              <LocateFixed size={15} />
              Zero X
            </button>
            <button className="tertiary" disabled={disabled} onClick={() => zero('Y')}>
              <LocateFixed size={15} />
              Zero Y
            </button>
            <button className="tertiary" disabled={disabled} onClick={() => zero('Z')}>
              <LocateFixed size={15} />
              Zero Z
            </button>
          </div>
        </div>

        <p className="hint">0,0 rapids to X/Y zero. Arrows jog X/Y, PgUp/PgDn jog Z.</p>
      </CardContent>
    </Card>
  );
}
