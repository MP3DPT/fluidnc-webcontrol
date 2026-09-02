import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { FluidNCConnection } from './serial/connection.js';
import { attachWebSocketServer } from './websocket/server.js';
import { FileLibraryStore } from './files/store.js';
import { LogStore } from './logging/logStore.js';
import { ConsoleHistoryStore } from './console/historyStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8000);
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');
// Matches the frontend's own hardcoded version string (Sidebar/AboutPanel) -
// this project doesn't read package.json for it anywhere, so staying
// consistent with that rather than introducing a second source.
const APP_VERSION = '0.4.7';

async function main() {
  // Attached before anything else can log, so even an early startup error
  // (a fatal one included, see the catch at the bottom of this file) ends
  // up in the buffer the Logs panel reads from.
  const logStore = new LogStore();
  logStore.attachToConsole();
  const historyStore = new ConsoleHistoryStore();

  const app = express();
  app.use(express.static(FRONTEND_DIST));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // System-only facts for the Logs panel's "Export diagnostics" - nothing
  // machine/settings/plugin-specific lives here, that's assembled client-side
  // from state the frontend already has (and can redact plugin secrets from
  // using each plugin's own schema, which the backend doesn't need to repeat).
  app.get('/api/diagnostics', (_req, res) => {
    res.json({
      appVersion: APP_VERSION,
      node: process.version,
      platform: os.type(),
      release: os.release(),
      arch: os.arch(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  const connection = new FluidNCConnection();
  connection.on('raw', (line: string) => console.log('<<', line));
  connection.on('portError', (err: Error) => console.error('Serial port error:', err.message));

  const server = app.listen(PORT, () => {
    console.log(`fluidnc-webcontrol listening on http://0.0.0.0:${PORT}`);
  });

  const { pluginLoader, broadcastPlugins, startAppUpdate } = await attachWebSocketServer(
    server,
    connection,
    app,
    logStore,
    historyStore,
  );

  // Raw zip upload - deliberately not JSON, and capped well above any
  // reasonable plugin's size so a malformed upload fails fast instead of
  // hanging the request.
  app.post('/api/plugins/install', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
    try {
      const manifest = await pluginLoader.install(req.body as Buffer);
      broadcastPlugins();
      res.json({ ok: true, manifest });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Just the target tag - the actual zip download happens here on the
  // backend (see update/updater.ts's fetchUpdateZip for why: GitHub's
  // archive-zip endpoint doesn't send CORS headers, so a browser-side fetch
  // of it fails outright). Responds immediately (the real work -
  // download/install/build/restart - runs in the background and reports
  // progress over the WebSocket as 'updateStatus' broadcasts, not through
  // this request) since the whole thing can take minutes and this process
  // gets killed by its own restart at the end anyway, so there'd be no
  // response to send by the time it's actually done.
  app.post('/api/system/update', express.json(), (req, res) => {
    const { tag } = req.body as { tag?: string };
    if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      res.status(400).json({ ok: false, error: 'A valid "tag" (e.g. "v0.4.1") is required' });
      return;
    }
    res.json({ ok: true });
    void startAppUpdate(tag);
  });

  app.post('/api/plugins/:id/uninstall', async (req, res) => {
    try {
      await pluginLoader.uninstall(req.params.id);
      broadcastPlugins();
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  const fileLibrary = new FileLibraryStore();

  app.get('/api/files', (_req, res) => {
    res.json({
      ok: true,
      files: fileLibrary.list(),
      folders: fileLibrary.listFolders(),
      disk: fileLibrary.diskUsage(),
    });
  });

  // A large G-code file plus its data-URL thumbnail can add up - capped
  // well above any reasonable job file so a malformed upload fails fast
  // instead of hanging the request.
  app.post('/api/files', express.json({ limit: '25mb' }), (req, res) => {
    try {
      const { name, gcode, thumbnail, folderId, metadata } = req.body as {
        name?: string;
        gcode?: string;
        thumbnail?: string | null;
        folderId?: string | null;
        metadata?: unknown;
      };
      if (!name || typeof gcode !== 'string') throw new Error('name and gcode are required');
      const entry = fileLibrary.add(name, gcode, thumbnail ?? null, folderId ?? null, metadata ?? null);
      res.json({ ok: true, file: entry });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/files/:id', (req, res) => {
    try {
      const gcode = fileLibrary.getGcode(req.params.id);
      res.json({ ok: true, gcode });
    } catch (err) {
      res.status(404).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/files/delete', express.json(), (req, res) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids array is required');
      fileLibrary.removeMany(ids);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/files/move', express.json(), (req, res) => {
    try {
      const { ids, folderId } = req.body as { ids?: string[]; folderId?: string | null };
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids array is required');
      fileLibrary.moveFiles(ids, folderId ?? null);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/folders', express.json(), (req, res) => {
    try {
      const { name } = req.body as { name?: string };
      if (!name) throw new Error('name is required');
      const folder = fileLibrary.createFolder(name);
      res.json({ ok: true, folder });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/folders/:id/delete', (req, res) => {
    try {
      fileLibrary.deleteFolder(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
