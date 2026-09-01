import { MapPin } from 'lucide-react';
import { CornerBracket } from './CornerBracket';

type Side = 'home' | 'far';

interface Props {
  disabled: boolean;
  /** Whether Park's real prerequisites (soft limits enabled, max travel configured - see connection.ts's park()) are actually met, not just whether the connection is open. */
  parkReady: boolean;
  /** The corner Settings -> Job Completion currently has saved - what the big Park button targets, and also what a finished job auto-parks to when that's the configured action. */
  defaultParkX: Side;
  defaultParkY: Side;
  send: (message: Record<string, unknown>) => void;
}

/**
 * Lives right next to Jog Control (see JogPanel) rather than a generic
 * Actions button - the real motivation (see Settings -> Job Completion's
 * own comment) is clearing the spindle out of the way to place material,
 * the same moment someone's reaching for the jog buttons anyway.
 *
 * The four corner buttons park to that specific corner immediately,
 * independent of whatever's saved in Settings - "any corner, right now".
 * The single Park button on the right instead targets the Settings ->
 * Job Completion default, so it always matches what a finished job would
 * auto-park to.
 */
export function ParkCluster({ disabled, parkReady, defaultParkX, defaultParkY, send }: Props) {
  const parkTo = (x: Side, y: Side) => send({ type: 'park', parkX: x, parkY: y });
  const parkDisabled = disabled || !parkReady;
  const title = disabled
    ? 'Connect first'
    : parkReady
      ? undefined
      : 'Needs soft limits enabled and max travel configured - see Settings → Job Completion';

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
            <CornerBracket corner="top-left" />
          </button>
          <button
            className="park-corner-btn"
            disabled={parkDisabled}
            title={title ?? 'Park: far X, far Y'}
            onClick={() => parkTo('far', 'far')}
          >
            <CornerBracket corner="top-right" />
          </button>
          <button
            className="park-corner-btn"
            disabled={parkDisabled}
            title={title ?? 'Park: home X, home Y (machine 0,0)'}
            onClick={() => parkTo('home', 'home')}
          >
            <CornerBracket corner="bottom-left" />
          </button>
          <button
            className="park-corner-btn"
            disabled={parkDisabled}
            title={title ?? 'Park: far X, home Y'}
            onClick={() => parkTo('far', 'home')}
          >
            <CornerBracket corner="bottom-right" />
          </button>
        </div>
        <button
          className="park-btn"
          disabled={parkDisabled}
          title={title ?? 'Rapids to the corner set in Settings → Job Completion'}
          onClick={() => parkTo(defaultParkX, defaultParkY)}
        >
          <MapPin size={16} />
          Park
        </button>
      </div>
    </div>
  );
}
