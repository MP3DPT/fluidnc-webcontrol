import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { Router, type Express } from 'express';
import type { FluidNCConnection } from '../serial/connection.js';
import type { ProgramRunner } from '../program/runner.js';
import type { SettingsStore } from '../settings/store.js';
import type { FluidNCPluginModule, PluginContext, PluginManifest, SettingsSchema } from './types.js';

// Outside the deployable project tree (which gets overwritten on every
// redeploy) so installed plugins survive redeploys as well as reboots -
// same reasoning as settings.json living here.
const PLUGINS_DIR = join(homedir(), '.fluidnc-webcontrol', 'plugins');

// systemd (and other service managers) run this process with a minimal PATH
// that doesn't include npm's directory, even though it includes node's -
// resolving npm next to the running node binary (true for nvm installs and
// most Node distributions) avoids depending on the service's PATH at all.
const NODE_BIN_DIR = dirname(process.execPath);
const NPM_BINARY = join(NODE_BIN_DIR, process.platform === 'win32' ? 'npm.cmd' : 'npm');
const NPM_COMMAND = existsSync(NPM_BINARY) ? `"${NPM_BINARY}"` : 'npm';

function installDependencies(dir: string, label: string): void {
  if (!existsSync(join(dir, 'package.json'))) return;
  try {
    execSync(`${NPM_COMMAND} install --omit=dev --no-audit --no-fund`, {
      cwd: dir,
      stdio: ['ignore', 'ignore', 'pipe'],
      // npm's own script has a "#!/usr/bin/env node" shebang, so PATH needs
      // node's directory too, not just npm's - matters under service
      // managers like systemd whose PATH has neither.
      env: { ...process.env, PATH: `${NODE_BIN_DIR}${delimiter}${process.env.PATH ?? ''}` },
    });
  } catch (err) {
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String((err as { stderr: Buffer }).stderr) : '';
    console.error(`${label}: npm install failed`, stderr.trim() || (err instanceof Error ? err.message : err));
  }
}

interface LoadedPlugin {
  manifest: PluginManifest;
  schema: SettingsSchema | null;
  beforeRunHooks: (() => Promise<void>)[];
  actions: Map<string, (params?: unknown) => Promise<unknown>>;
  router: Router;
  cleanup?: () => void | Promise<void>;
}

/**
 * Discovers, activates, installs, and uninstalls plugins from disk. Each
 * plugin is a folder under PLUGINS_DIR with a plugin.json manifest and an
 * entry module implementing FluidNCPluginModule - dynamically imported at
 * runtime, same as any third party's plugin would be.
 *
 * "Enabled" is deliberately NOT gating whether a plugin is loaded/active -
 * every installed plugin's hooks are always registered, and the plugin's
 * own logic checks its "enabled" setting each time it does anything (the
 * bundled smart-plug-control plugin already works this way). This avoids
 * needing real dynamic activate/deactivate machinery just to flip a
 * checkbox; only install/uninstall need to touch what's actually loaded.
 */
export class PluginLoader {
  private plugins = new Map<string, LoadedPlugin>();

  constructor(
    private connection: FluidNCConnection,
    private runner: ProgramRunner,
    private settingsStore: SettingsStore,
    private broadcastFn: (type: string, data: unknown) => void,
    private httpApp: Express,
  ) {}

  /**
   * Copies any bundled plugin (shipped with the app, e.g. Smart Plug
   * Control) into PLUGINS_DIR the first time it's missing, installing its
   * own dependencies the same way a third-party plugin's install would.
   * Only runs once per plugin id - if a user uninstalls it, it stays gone
   * rather than reappearing on the next restart.
   */
  ensureBundled(bundledDir: string): void {
    if (!existsSync(bundledDir)) return;
    for (const entry of readdirSync(bundledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dest = join(PLUGINS_DIR, entry.name);
      if (existsSync(dest)) {
        // Self-heal a previous copy whose npm install failed (e.g. npm
        // wasn't resolvable yet) rather than leaving it permanently broken -
        // but don't touch it if dependencies are already there.
        if (existsSync(join(dest, 'package.json')) && !existsSync(join(dest, 'node_modules'))) {
          installDependencies(dest, `Bundled plugin '${entry.name}'`);
        }
        continue;
      }
      cpSync(join(bundledDir, entry.name), dest, { recursive: true });
      installDependencies(dest, `Bundled plugin '${entry.name}'`);
    }
  }

  async loadAll(): Promise<void> {
    mkdirSync(PLUGINS_DIR, { recursive: true });
    const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const entry of entries) {
      await this.loadOne(entry.name).catch((err) => {
        console.error(`Failed to load plugin '${entry.name}':`, err instanceof Error ? err.message : err);
      });
    }
  }

  private async loadOne(id: string): Promise<void> {
    // Safe to call again for an id that's already loaded (e.g. installing
    // a new version over an existing plugin) - tear down the old instance
    // first so its router/hooks don't linger stacked alongside the new one.
    const existing = this.plugins.get(id);
    if (existing) {
      if (existing.cleanup) await existing.cleanup();
      this.unmountRouter(existing.router);
      this.plugins.delete(id);
    }

    const dir = join(PLUGINS_DIR, id);
    const manifestPath = join(dir, 'plugin.json');
    if (!existsSync(manifestPath)) return;
    const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    let schema: SettingsSchema | null = null;
    const schemaPath = join(dir, 'settingsSchema.json');
    if (existsSync(schemaPath)) {
      schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    }

    const router = Router();
    this.httpApp.use(`/api/plugins/${manifest.id}`, router);
    const loaded: LoadedPlugin = { manifest, schema, beforeRunHooks: [], actions: new Map(), router };

    const ctx: PluginContext = {
      connection: this.connection,
      runner: this.runner,
      settings: {
        get: () => this.settingsStore.get().plugins[manifest.id] ?? { enabled: false },
        update: (partial) => this.settingsStore.updatePluginConfig(manifest.id, partial),
      },
      broadcast: (type, data) => this.broadcastFn(type, data),
      registerBeforeRun: (hook) => loaded.beforeRunHooks.push(hook),
      registerAction: (actionId, handler) => loaded.actions.set(actionId, handler),
      app: router,
    };

    const entryPath = join(dir, manifest.entry);
    const imported = await import(pathToFileURL(entryPath).href);
    const mod: FluidNCPluginModule = imported.default ?? imported;
    const result = await mod.activate(ctx);
    if (typeof result === 'function') loaded.cleanup = result;

    this.settingsStore.ensurePluginEntry(manifest.id);
    this.plugins.set(manifest.id, loaded);
  }

  list() {
    return [...this.plugins.values()].map((p) => ({
      manifest: p.manifest,
      schema: p.schema,
      config: this.settingsStore.get().plugins[p.manifest.id] ?? { enabled: false },
    }));
  }

  async runBeforeRunHooks(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      for (const hook of plugin.beforeRunHooks) {
        await hook();
      }
    }
  }

  async invokeAction(pluginId: string, actionId: string, params?: unknown): Promise<unknown> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Unknown plugin: ${pluginId}`);
    const handler = plugin.actions.get(actionId);
    if (!handler) throw new Error(`Unknown action '${actionId}' for plugin '${pluginId}'`);
    return handler(params);
  }

  /**
   * Extracts an uploaded .zip into PLUGINS_DIR/<id> and activates it
   * immediately - no restart needed for install, unlike most other backend
   * changes in this project (which are source-code edits, not user actions
   * meant to work at runtime).
   */
  async install(zipBuffer: Buffer): Promise<PluginManifest> {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const manifestEntry = entries.find((e) => e.entryName.replace(/\\/g, '/').endsWith('plugin.json'));
    if (!manifestEntry) throw new Error('plugin.json not found in the uploaded zip');

    const manifest: PluginManifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
    if (!manifest.id || !manifest.entry) {
      throw new Error('plugin.json is missing required fields (id, entry)');
    }
    if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      throw new Error('plugin id must be lowercase letters, numbers, and hyphens only');
    }

    // Zip tools often wrap contents in a single top-level folder (e.g.
    // "my-plugin/plugin.json" instead of "plugin.json") - strip whatever
    // prefix precedes plugin.json from every entry, rather than assuming
    // either layout.
    const manifestEntryName = manifestEntry.entryName.replace(/\\/g, '/');
    const prefix = manifestEntryName.slice(0, manifestEntryName.length - 'plugin.json'.length);

    const destDir = join(PLUGINS_DIR, manifest.id);
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = entry.entryName.replace(/\\/g, '/');
      if (!name.startsWith(prefix)) continue; // skip unrelated junk outside the plugin folder (e.g. __MACOSX)
      const relative = name.slice(prefix.length);
      if (!relative) continue;
      const destPath = join(destDir, relative);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, entry.getData());
    }

    // Best-effort - a plugin with its own dependencies needs them
    // installed locally (Node resolves a plugin's own node_modules before
    // walking up), but a plugin with no package.json just skips this.
    installDependencies(destDir, `Plugin '${manifest.id}'`);

    await this.loadOne(manifest.id);
    return manifest;
  }

  /**
   * Express 4 has no public API to unmount a router - this is the standard
   * (if unsupported) trick: drop the stack layer whose handle is our
   * router. Needed so uninstalling (or reinstalling) a plugin doesn't leave
   * its old routes still answering requests alongside a newer instance.
   */
  private unmountRouter(router: Router): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const appRouter = (this.httpApp as any)._router;
    if (!appRouter?.stack) return;
    appRouter.stack = appRouter.stack.filter((layer: { handle: unknown }) => layer.handle !== router);
  }

  async uninstall(id: string): Promise<void> {
    const plugin = this.plugins.get(id);
    if (plugin?.cleanup) await plugin.cleanup();
    if (plugin) this.unmountRouter(plugin.router);
    this.plugins.delete(id);
    this.settingsStore.removePlugin(id);
    rmSync(join(PLUGINS_DIR, id), { recursive: true, force: true });
  }
}

export { PLUGINS_DIR };
