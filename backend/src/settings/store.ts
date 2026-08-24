import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR } from '../dataDir.js';

export interface GeneralSettings {
  /** When a Console line is a feed move (G1/G2/G3) with no F word of its own, append consoleDefaultFeed instead of letting FluidNC reject it as "undefined feed rate". */
  consoleAutoFeedEnabled: boolean;
  consoleDefaultFeed: number;
  /** The Jog panel's Step dropdown options, in mm - user-configurable since the right increments vary a lot by job (0.01mm engraving vs. 100mm rapid repositioning). Always non-empty; kept sorted ascending. */
  jogStepSizes: number[];
}

/** Each plugin's own flat settings bag - always has at least "enabled". */
export type PluginSettings = Record<string, unknown> & { enabled: boolean };

export interface Settings {
  general: GeneralSettings;
  plugins: Record<string, PluginSettings>;
}

const DEFAULT_SETTINGS: Settings = {
  general: { consoleAutoFeedEnabled: true, consoleDefaultFeed: 300, jogStepSizes: [0.1, 1, 10, 50] },
  plugins: {},
};

/** Z-Probe used to be a core feature with its settings living right on Settings.probe - now it's the zprobe-touchplate plugin's own bag, like any other plugin. */
const ZPROBE_PLUGIN_ID = 'zprobe-touchplate';

// Stored outside the deployable project tree (which gets overwritten on
// every deploy) so settings survive redeploys as well as reboots.
const SETTINGS_PATH = join(DATA_DIR, 'settings.json');

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
    const { settings, migrated } = this.load();
    this.settings = settings;
    // Write the migration back immediately rather than waiting for some
    // unrelated future settings change to happen to persist it - otherwise
    // the on-disk file keeps showing the stale pre-migration shape
    // indefinitely (harmless to runtime behavior, since load() re-derives
    // the same result every restart, but confusing to anyone reading the
    // file directly).
    if (migrated) this.persist();
  }

  private load(): { settings: Settings; migrated: boolean } {
    try {
      const raw = readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      const plugins = { ...(parsed.plugins ?? {}) };
      let migrated = false;

      // Pre-plugin Z-Probe: its settings lived at the top-level `probe` key.
      // Migrate them into the new plugin's own bag once, so an existing
      // user's already-configured (and already-enabled) values survive the
      // switch instead of silently resetting to defaults.
      if (parsed.probe && !plugins[ZPROBE_PLUGIN_ID]) {
        plugins[ZPROBE_PLUGIN_ID] = { enabled: true, ...parsed.probe };
        migrated = true;
      }

      return {
        settings: {
          general: { ...DEFAULT_SETTINGS.general, ...parsed.general },
          plugins,
        },
        migrated,
      };
    } catch {
      return { settings: structuredClone(DEFAULT_SETTINGS), migrated: false };
    }
  }

  get(): Settings {
    return this.settings;
  }

  update(partial: Partial<Pick<Settings, 'general'>>): Settings {
    this.settings = {
      ...this.settings,
      general: { ...this.settings.general, ...partial.general },
    };
    this.persist();
    this.emit('change', this.settings);
    return this.settings;
  }

  /**
   * Wholesale replace from an exported backup (see AppSettingsPanel's
   * Backup & Restore) - unlike update(), this is a full replace of
   * `plugins` too, not a merge with whatever's currently configured, since
   * "restore" means becoming exactly what the backup says. Safe to restore
   * onto a device with a plugin not yet installed: ensurePluginEntry() only
   * initializes an entry if one doesn't already exist, so a restored
   * plugin's config just sits here untouched until that plugin is actually
   * installed and picks it up.
   */
  restore(incoming: unknown): Settings {
    if (typeof incoming !== 'object' || incoming === null) {
      throw new Error('Backup file is not a valid settings object');
    }
    const { general, plugins } = incoming as Partial<Settings>;
    if (general !== undefined && (typeof general !== 'object' || general === null)) {
      throw new Error('Backup file\'s "general" section is malformed');
    }
    if (plugins !== undefined && (typeof plugins !== 'object' || plugins === null)) {
      throw new Error('Backup file\'s "plugins" section is malformed');
    }

    this.settings = {
      general: { ...DEFAULT_SETTINGS.general, ...general },
      plugins: (plugins as Settings['plugins']) ?? {},
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
