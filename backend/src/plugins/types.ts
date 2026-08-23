import type { Router } from 'express';
import type { FluidNCConnection } from '../serial/connection.js';
import type { ProgramRunner } from '../program/runner.js';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Relative path to the entry module, e.g. "index.js". */
  entry: string;
  /**
   * True if this plugin renders a live panel on the main screen (below
   * Actions), not just Settings fields. The plugin itself must register a
   * GET /panel route (via PluginContext.app) returning a self-contained
   * HTML page - the frontend just iframes whatever that route returns.
   */
  panel?: boolean;
  /** Which dashboard column the panel renders in - defaults to 'left' (below Actions), matching every panel plugin before this field existed. */
  panelColumn?: 'left' | 'right';
}

export type SchemaFieldType = 'text' | 'password' | 'number' | 'checkbox' | 'select' | 'hint';

export interface SchemaField {
  /** Omitted for 'hint' fields, which are just displayed text. */
  key?: string;
  type: SchemaFieldType;
  label?: string;
  /** For 'hint' fields: the text to display. */
  text?: string;
  unit?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Only rendered when the named field currently equals the given value. */
  showIf?: Record<string, unknown>;
  default?: unknown;
}

export interface PluginAction {
  id: string;
  label: string;
  danger?: boolean;
  /** Only enabled when the named field currently equals the given value. */
  enabledIf?: Record<string, unknown>;
}

export interface SettingsSchema {
  fields: SchemaField[];
  actions?: PluginAction[];
}

export interface PluginSettingsHandle {
  /** Flat bag including "enabled" alongside whatever fields the plugin's schema declares. */
  get(): Record<string, unknown>;
  update(partial: Record<string, unknown>): void;
}

/**
 * What a plugin actually gets. Deliberately direct access to `connection`
 * and `runner` rather than a heavily wrapped/restricted API - a real
 * plugin system for Node code is a full-trust model (same as OctoPrint
 * plugins or npm packages); pretending otherwise with a thin permission
 * layer wouldn't provide real security, just a false sense of it.
 */
export interface PluginContext {
  connection: FluidNCConnection;
  runner: ProgramRunner;
  settings: PluginSettingsHandle;
  /** Broadcasts a message to every connected browser (shows up in the Console log for known types). */
  broadcast(type: string, data: unknown): void;
  /** Registers a hook that's awaited before every job run starts (e.g. "turn on the spindle and wait"). */
  registerBeforeRun(hook: () => Promise<void>): void;
  /** Registers a named action the UI can invoke (e.g. "test-on" behind a Settings button). */
  registerAction(id: string, handler: (params?: unknown) => Promise<unknown>): void;
  /**
   * A full Express Router, scoped and mounted at /api/plugins/<id> - use it
   * for anything a simple action/hook can't do (streaming responses, custom
   * content types, a manifest-declared `panel` page). Same full-trust model
   * as `connection`/`runner`: real routing power, not a restricted wrapper.
   */
  app: Router;
}

export interface FluidNCPluginModule {
  activate(ctx: PluginContext): void | Promise<void> | (() => void | Promise<void>);
}
