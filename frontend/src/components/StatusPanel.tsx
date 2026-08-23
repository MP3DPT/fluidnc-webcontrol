import { Cog } from 'lucide-react';
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
        <Cog size={14} />
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

        <span className="jog-axis-tag" style={{ textAlign: 'left', marginBottom: '0.4rem' }}>
          Machine coordinates
        </span>
        <CoordinateDisplay
          size="boxed"
          axes={[
            { label: 'X', value: mpos?.x ?? null },
            { label: 'Y', value: mpos?.y ?? null },
            { label: 'Z', value: mpos?.z ?? null },
          ]}
        />

        <div className="pins">
          <span className={`pin ${pins?.x ? 'active' : ''}`}>X-lim</span>
          <span className={`pin ${pins?.y ? 'active' : ''}`}>Y-lim</span>
          <span className={`pin ${pins?.z ? 'active' : ''}`}>Z-lim</span>
          <span className={`pin ${pins?.probe ? 'active' : ''}`}>Probe</span>
        </div>
      </CardContent>
    </Card>
  );
}
