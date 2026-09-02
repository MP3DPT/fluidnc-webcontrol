import { MapPin } from 'lucide-react';
import { CornerBracket } from './CornerBracket';
import type { MachineState } from '../types';

type Side = 'home' | 'far';

interface Props {
  disabled: boolean;
  /** Whether Park's real prerequisites (soft limits enabled, max travel configured - see connection.ts's park()) are actually met, not just whether the connection is open. */
  parkReady: boolean;
  /** Current controller state, or null before any status report has arrived - used only to catch "currently moving", not homing (see isHomed below). */
  machineState: MachineState | null;
  /**
   * Whether $H has actually completed successfully this connection - the
   * backend's own authoritative flag (see connection.ts's `homed` field),
   * NOT inferred from machineState. That distinction is load-bearing: a
   * real crash happened because a freshly power-cycled, never-homed
   * controller reported Idle rather than some locked Alarm state, so a
   * "machineState !== 'Idle'" guard let Park through with nothing
   * trustworthy backing its soft-limit check. The backend now refuses to
   * run park() at all without this too - this prop is what lets the
   * buttons disable themselves proactively instead of only failing after
   * a click.
   */
  isHomed: boolean;
  /** The corner Settings -> Park Corner currently has saved - what the wide Park button targets. */
  defaultParkX: Side;
  defaultParkY: Side;
  send: (message: Record<string, unknown>) => void;
}

/**
 * Lives right next to Jog Control (see JogPanel) rather than a generic
 * Actions button - the real motivation (see Settings -> Park Corner's own
 * comment) is clearing the spindle out of the way to place material, the
 * same moment someone's reaching for the jog buttons anyway. Deliberately
 * NOT tied to any automatic "on job complete" behavior (there used to be
 * one - removed, see backend/src/settings/store.ts) - purely on-demand.
 *
 * The four corner buttons park to that specific corner immediately,
 * independent of whatever's saved in Settings - "any corner, right now".
 * The wide Park button below instead targets the Settings -> Park Corner
 * preference, for whichever corner is used most often.
 */
export function ParkCluster({ disabled, parkReady, machineState, isHomed, defaultParkX, defaultParkY, send }: Props) {
  // "Currently moving" stays a click-time alert (matching ProgramPanel's
  // Run confirm() for its own "already finished" case) rather than a
  // disabled state, since it's transient and self-resolving. "Not homed"
  // is folded into parkDisabled below instead, proactively - a real crash
  // happened with the softer click-and-explain approach for that one (see
  // isHomed's own comment), so it's disabled outright now, not just
  // discouraged.
  const parkTo = (x: Side, y: Side) => {
    if (machineState === 'Run' || machineState === 'Jog' || machineState === 'Hold') {
      window.alert('The machine is currently moving - wait for it to finish before parking.');
      return;
    }
    send({ type: 'park', parkX: x, parkY: y });
  };
  const parkDisabled = disabled || !parkReady || !isHomed;
  const title = disabled
    ? 'Connect first'
    : !isHomed
      ? 'Home the machine first (the Home button) - Park needs a known machine position to compute a safe target.'
      : parkReady
        ? undefined
        : 'Needs soft limits enabled and max travel configured - see Settings → Park Corner';

  return (
    <div>
      <span className="jog-axis-tag">Park</span>
      <div className="park-cluster">
        <div className="park-grid">
          <button
            className="park-corner-btn"
            disabled={parkDisabled}
            title={title ?? 'Park: home X, far Y'}
            onClick={() => parkTo('home', 'far')}
          >
            <CornerBracket corner="top-left" size={15} />
          </button>
          <button
            className="park-corner-btn"
            disabled={parkDisabled}
            title={title ?? 'Park: far X, far Y'}
            onClick={() => parkTo('far', 'far')}
          >
            <CornerBracket corner="top-right" size={15} />
          </button>
          <button
            className="park-corner-btn"
            disabled={parkDisabled}
            title={title ?? 'Park: home X, home Y (machine 0,0)'}
            onClick={() => parkTo('home', 'home')}
          >
            <CornerBracket corner="bottom-left" size={15} />
          </button>
          <button
            className="park-corner-btn"
            disabled={parkDisabled}
            title={title ?? 'Park: far X, home Y'}
            onClick={() => parkTo('far', 'home')}
          >
            <CornerBracket corner="bottom-right" size={15} />
          </button>
        </div>
        <button
          className="park-btn"
          disabled={parkDisabled}
          title={title ?? 'Rapids to the corner set in Settings → Park Corner'}
          onClick={() => parkTo(defaultParkX, defaultParkY)}
        >
          <MapPin size={11} />
          Park
        </button>
      </div>
    </div>
  );
}
