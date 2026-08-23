import type { GcodeMetadata } from './gcode/extractMetadata';

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

export interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}

export interface ProbeResult {
  position: Position;
  success: boolean;
  raw: string;
}

export interface LogEntry {
  id: number;
  kind: 'welcome' | 'feedback' | 'alarm' | 'error' | 'info';
  text: string;
}

export type ProgramState = 'idle' | 'running' | 'paused' | 'complete' | 'stopped' | 'error';

export interface ProgramStatus {
  state: ProgramState;
  sent: number;
  total: number;
}

export interface ProbeSettings {
  maxTravel: number;
  feedrate: number;
  plateThickness: number;
  retractDistance: number;
}

export interface GeneralSettings {
  consoleAutoFeedEnabled: boolean;
  consoleDefaultFeed: number;
}

/** A plugin's own flat settings bag - always has at least "enabled". */
export type PluginConfig = Record<string, unknown> & { enabled: boolean };

export interface Settings {
  general: GeneralSettings;
  probe: ProbeSettings;
  plugins: Record<string, PluginConfig>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  entry: string;
  /** True if this plugin renders a live panel on the main screen (below Actions), served at /api/plugins/<id>/panel. */
  panel?: boolean;
}

export type SchemaFieldType = 'text' | 'password' | 'number' | 'checkbox' | 'select' | 'hint';

export interface SchemaField {
  key?: string;
  type: SchemaFieldType;
  label?: string;
  text?: string;
  unit?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  showIf?: Record<string, unknown>;
  default?: unknown;
}

export interface PluginActionDef {
  id: string;
  label: string;
  danger?: boolean;
  enabledIf?: Record<string, unknown>;
}

export interface SettingsSchema {
  fields: SchemaField[];
  actions?: PluginActionDef[];
}

export interface PluginInfo {
  manifest: PluginManifest;
  schema: SettingsSchema | null;
  config: PluginConfig;
}

export interface Folder {
  id: string;
  name: string;
}

export interface DiskUsage {
  freeBytes: number;
  totalBytes: number;
}

export interface FileEntry {
  id: string;
  name: string;
  size: number;
  savedAt: number;
  thumbnail: string | null;
  folderId: string | null;
  metadata: GcodeMetadata | null;
}
