export type MachineState =
  | 'Idle'
  | 'Run'
  | 'Hold'
  | 'Jog'
  | 'Alarm'
  | 'Door'
  | 'Check'
  | 'Home'
  | 'Sleep'
  | 'Unknown';

export interface Position {
  x: number;
  y: number;
  z: number;
  a?: number;
  b?: number;
  c?: number;
}

export interface PinState {
  x: boolean;
  y: boolean;
  z: boolean;
  probe: boolean;
  door: boolean;
  hold: boolean;
  softReset: boolean;
  cycleStart: boolean;
}

export interface StatusReport {
  state: MachineState;
  mpos?: Position;
  wpos?: Position;
  wco?: Position;
  feed?: number;
  speed?: number;
  overrides?: { feed: number; rapid: number; spindle: number };
  pins?: PinState;
  raw: string;
}

export interface ProbeResult {
  position: Position;
  success: boolean;
  raw: string;
}

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}
