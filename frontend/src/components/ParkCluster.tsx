import { MapPin } from 'lucide-react';
import { CornerBracket } from './CornerBracket';
import type { MachineState } from '../types';

type Side = 'home' | 'far';

interface Props {
  disabled: boolean;
  /** Whether Park's real prerequisites (soft limits enabled, max travel configured - see connection.ts's park()) are actually met, not just whether the connection is open. */
  parkReady: boolean;
  /** Current controller state, or null before any status report has arrived. Park is a G53 machine-coordinate move - it needs a real machine position, which only exists once $H has actually run (an un-homed machine that requires homing sits in Alarm until then, same as after any other alarm/fault). */
  machineState: MachineState | null;
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
export function ParkCluster({ disabled, parkReady, machineState, defaultParkX, defaultParkY, send }: Props) {
  // Left clickable (not disabled) rather than gated purely by state, since
  // "why won't this button do anything" is worse UX than a click that
  // explains itself - same reasoning ProgramPanel's Run uses a confirm()
  // for its own "already finished" case instead of just disabling Run.
  const parkTo = (x: Side, y: Side) => {
    if (machineState !== 'Idle') {
      window.alert(
        machineState === 'Run' || machineState === 'Jog' || machineState === 'Hold'
          ? "The machine is currently moving - wait for it to finish before parking."
          : 'Home the machine first (the Home button) - Park moves to a machine-coordinate corner, which only exists once homing has run.',
      );
      return;
    }
    send({ type: 'park', parkX: x, parkY: y });
  };
  const parkDisabled = disabled || !parkReady;
  const title = disabled
    ? 'Connect first'
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
