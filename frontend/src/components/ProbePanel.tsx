import { useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import type { ProbeResult, ProbeSettings } from '../types';

interface Props {
  disabled: boolean;
  lastResult: ProbeResult | null;
  settings: ProbeSettings | null;
  send: (message: Record<string, unknown>) => void;
}

const FALLBACK: ProbeSettings = { maxTravel: -25, feedrate: 100, plateThickness: 0, retractDistance: 5 };

export function ProbePanel({ disabled, lastResult, settings, send }: Props) {
  const [distance, setDistance] = useState(FALLBACK.maxTravel);
  const [feedrate, setFeedrate] = useState(FALLBACK.feedrate);
  const [plateThickness, setPlateThickness] = useState(FALLBACK.plateThickness);
  const [retractDistance, setRetractDistance] = useState(FALLBACK.retractDistance);
  const initialized = useRef(false);

  // Settings arrive asynchronously (loaded from disk on the Pi) - apply
  // them once when they first show up, so this browser reflects whatever
  // was last saved, even after a page reload or a Pi reboot.
  useEffect(() => {
    if (settings && !initialized.current) {
      initialized.current = true;
      setDistance(settings.maxTravel);
      setFeedrate(settings.feedrate);
      setPlateThickness(settings.plateThickness);
      setRetractDistance(settings.retractDistance);
    }
  }, [settings]);

  const persist = (patch: Partial<ProbeSettings>) => {
    send({ type: 'updateSettings', settings: { probe: patch } });
  };

  return (
    <Card>
      <CardHeader>
        <Crosshair size={14} />
        Z-Probe
      </CardHeader>
      <CardContent>
        <div className="row">
          <label>
            Max travel
            <span className="field-row">
              <input
                type="number"
                value={distance}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDistance(v);
                  persist({ maxTravel: v });
                }}
              />
              <span>mm</span>
            </span>
          </label>
          <label>
            Feed
            <span className="field-row">
              <input
                type="number"
                value={feedrate}
                min={1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setFeedrate(v);
                  persist({ feedrate: v });
                }}
              />
              <span>mm/min</span>
            </span>
          </label>
        </div>
        <div className="row">
          <label>
            Probe thickness
            <span className="field-row">
              <input
                type="number"
                step="0.01"
                value={plateThickness}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPlateThickness(v);
                  persist({ plateThickness: v });
                }}
              />
              <span>mm</span>
            </span>
          </label>
          <label>
            Retract distance
            <span className="field-row">
              <input
                type="number"
                value={retractDistance}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setRetractDistance(v);
                  persist({ retractDistance: v });
                }}
              />
              <span>mm</span>
            </span>
          </label>
        </div>
        <p className="hint">
          Zeros {plateThickness}mm below contact, retracts {retractDistance}mm clear.
        </p>
        <button
          className="primary"
          disabled={disabled}
          onClick={() =>
            send({ type: 'probeAndZero', axis: 'Z', distance, feedrate, plateThickness, retractDistance })
          }
        >
          <Crosshair size={15} />
          Probe &amp; Zero Z
        </button>
        {lastResult && (
          <p className={`hint ${lastResult.success ? '' : 'error-text'}`}>
            {lastResult.success
              ? `Contact at Z=${lastResult.position.z.toFixed(3)} (machine) — work Z zeroed to plate thickness`
              : 'No contact — probe did not trigger within travel distance'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
