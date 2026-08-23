import type { MachineState } from '../types';
import type { BadgeTone } from '../components/ui/Badge';

/** Single source of truth for state -> colour, so the header badge and the Machine Status card never disagree. */
export function machineStateTone(state: MachineState | undefined): BadgeTone {
  switch (state) {
    case 'Run':
    case 'Jog':
      return 'success';
    case 'Hold':
      return 'warning';
    case 'Alarm':
    case 'Door':
      return 'danger';
    case 'Home':
    case 'Check':
      return 'info';
    case 'Idle':
    case 'Sleep':
    default:
      return 'neutral';
  }
}
