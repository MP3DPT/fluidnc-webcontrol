import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ProbeSettings {
  maxTravel: number;
  feedrate: number;
  plateThickness: number;
  retractDistance: number;
}

export interface GeneralSettings {
  /** When a Console line is a feed move (G1/G2/G3) with no F word of its own, append consoleDefaultFeed instead of letting FluidNC reject it as "undefined feed rate". */
  consoleAutoFeedEnabled: boolean;
  consoleDefaultFeed: number;
}

/** Each plugin's own flat settings bag - always has at least "enabled". */
export type PluginSettings = Record<string, unknown> & { enabled: boolean };

export interface Settings {
  general: GeneralSettings;
  probe: ProbeSettings;
  plugins: Record<string, PluginSettings>;
}

const DEFAULT_SETTINGS: Settings = {
  general: { consoleAutoFeedEnabled: true, consoleDefaultFeed: 300 },
  probe: { maxTravel: -25, feedrate: 100, plateThickness: 0, retractDistance: 5 },
  plugins: {},
};

// Stored outside the deployable project tree (which gets overwritten on
// every deploy) so settings survive redeploys as well as reboots.
const SETTINGS_PATH = join(homedir(), '.fluidnc-webcontrol', 'settings.json');

/**
 * Persists user settings (probe thickness, feed rates, and every
 * installed plugin's own config) to disk on the Pi itself, not the
 * browser - so they're the same regardless of which device/browser
 * connects, and survive both page reloads and Pi reboots.
 */
export class SettingsStore extends EventEmitter {
  private settings: Settings;

  constructor() {
    super();
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const raw = readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        general: { ...DEFAULT_SETTINGS.general, ...parsed.general },
        probe: { ...DEFAULT_SETTINGS.probe, ...parsed.probe },
        plugins: { ...(parsed.plugins ?? {}) },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  get(): Settings {
    return this.settings;
  }

  update(partial: Partial<Pick<Settings, 'probe' | 'general'>>): Settings {
    this.settings = {
      ...this.settings,
      probe: { ...this.settings.probe, ...partial.probe },
      general: { ...this.settings.general, ...partial.general },
    };
    this.persist();
    this.emit('change', this.settings);
    return this.settings;
  }

  /** Called once when a plugin is (re)loaded, so it has a settings entry even before anyone configures it. */
  ensurePluginEntry(pluginId: string): void {
    if (this.settings.plugins[pluginId]) return;
    this.settings.plugins = { ...this.settings.plugins, [pluginId]: { enabled: false } };
    this.persist();
    this.emit('change', this.settings);
  }

  updatePluginConfig(pluginId: string, partial: Record<string, unknown>): void {
    const current = this.settings.plugins[pluginId] ?? { enabled: false };
    this.settings.plugins = { ...this.settings.plugins, [pluginId]: { ...current, ...partial } };
    this.persist();
    this.emit('change', this.settings);
  }

  removePlugin(pluginId: string): void {
    const { [pluginId]: _removed, ...rest } = this.settings.plugins;
    this.settings.plugins = rest;
    this.persist();
    this.emit('change', this.settings);
  }

  private persist() {
    mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(this.settings, null, 2));
  }
}
