import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { FluidNCConnection } from './serial/connection.js';
import { attachWebSocketServer } from './websocket/server.js';
import { FileLibraryStore } from './files/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8000);
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

async function main() {
  const app = express();
  app.use(express.static(FRONTEND_DIST));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  const connection = new FluidNCConnection();
  connection.on('raw', (line: string) => console.log('<<', line));
  connection.on('portError', (err: Error) => console.error('Serial port error:', err.message));

  const server = app.listen(PORT, () => {
    console.log(`fluidnc-webcontrol listening on http://0.0.0.0:${PORT}`);
  });

  const { pluginLoader, broadcastPlugins } = await attachWebSocketServer(server, connection, app);

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
