import { Activity } from 'lucide-react';
import { Card, CardHeader, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { CoordinateDisplay } from './ui/CoordinateDisplay';
import { machineStateTone } from '../lib/machineState';
import type { StatusReport } from '../types';

interface Props {
  status: StatusReport | null;
}

export function StatusPanel({ status }: Props) {
  const mpos = status?.mpos;
  const pins = status?.pins;
  const state = status?.state;

  return (
    <Card>
      <CardHeader>
        <Activity size={14} />
        Machine Status
      </CardHeader>
      <CardContent>
        <div className="state-display">
          <Badge
            tone={state ? machineStateTone(state) : 'neutral'}
            pulse={state === 'Run' || state === 'Alarm'}
          >
            <span className="state-display-label">{state?.toUpperCase() ?? 'NOT CONNECTED'}</span>
          </Badge>
        </div>

        <CoordinateDisplay
          size="sm"
          axes={[
            { label: 'X', value: mpos?.x ?? null },
            { label: 'Y', value: mpos?.y ?? null },
            { label: 'Z', value: mpos?.z ?? null },
          ]}
        />
        <p className="hint">Machine coordinates</p>

        <div className="pins">
          <span className={`pin ${pins?.x ? 'active' : ''}`}>X-lim</span>
          <span className={`pin ${pins?.y ? 'active' : ''}`}>Y-lim</span>
          <span className={`pin ${pins?.z ? 'active' : ''}`}>Z-lim</span>
          <span className={`pin ${pins?.probe ? 'active' : ''}`}>Probe</span>
          <span className={`pin ${pins?.door ? 'active' : ''}`}>Door</span>
        </div>
      </CardContent>
    </Card>
  );
}
