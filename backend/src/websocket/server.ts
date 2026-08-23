import type { Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { FluidNCConnection } from '../serial/connection.js';
import { ProgramRunner } from '../program/runner.js';
import { SettingsStore, type Settings } from '../settings/store.js';
import { rebootSystem, shutdownSystem } from '../system/power.js';
import { PluginLoader } from '../plugins/loader.js';

// backend/src/websocket/server.ts -> backend/plugins-bundled
const BUNDLED_PLUGINS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../plugins-bundled');

type ClientMessage =
  | { type: 'listPorts' }
  | { type: 'connect'; path: string; baud?: number }
  | { type: 'disconnect' }
  | { type: 'jog'; deltas: { X?: number; Y?: number; Z?: number }; feedrate: number }
  | { type: 'jogCancel' }
  | { type: 'home' }
  | { type: 'unlock' }
  | { type: 'reset' }
  | { type: 'feedHold' }
  | { type: 'cycleStart' }
  | { type: 'probe'; axis: 'X' | 'Y' | 'Z'; distance: number; feedrate: number }
  | {
      type: 'probeAndZero';
      axis: 'X' | 'Y' | 'Z';
      distance: number;
      feedrate: number;
      plateThickness: number;
      retractDistance: number;
    }
  | { type: 'gcode'; line: string }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'updatePluginSettings'; pluginId: string; settings: Record<string, unknown> }
  | { type: 'pluginAction'; pluginId: string; actionId: string; params?: unknown }
  | { type: 'listPlugins' }
  | { type: 'loadProgram'; name: string; gcode: string }
  | { type: 'runProgram' }
  | { type: 'pauseProgram' }
  | { type: 'resumeProgram' }
  | { type: 'stopProgram' }
  | { type: 'clearProgram' }
  | { type: 'systemReboot' }
  | { type: 'systemShutdown' }
  | { type: 'getFirmwareSettings' };

function broadcast(wss: WebSocketServer, message: unknown) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

export async function attachWebSocketServer(httpServer: HttpServer, connection: FluidNCConnection, httpApp: Express) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const runner = new ProgramRunner(connection);
  const settingsStore = new SettingsStore();
  let startingJob = false;

  const broadcastFn = (type: string, data: unknown) => broadcast(wss, { type, data });
  const pluginLoader = new PluginLoader(connection, runner, settingsStore, broadcastFn, httpApp);
  pluginLoader.ensureBundled(BUNDLED_PLUGINS_DIR);
  await pluginLoader.loadAll();

  // Relay every connection-level event straight to all connected browsers.
  // The frontend is the source of truth for how to render these; the
  // backend just forwards facts.
  const forward = (type: string) => (data: unknown) => broadcast(wss, { type, data });
  connection.on('status', forward('status'));
  connection.on('alarm', forward('alarm'));
  connection.on('feedback', forward('feedback'));
  connection.on('probeResult', forward('probeResult'));
  connection.on('welcome', forward('welcome'));
  connection.on('open', forward('connectionOpen'));
  connection.on('close', forward('connectionClosed'));
  connection.on('portError', (err: Error) => broadcast(wss, { type: 'portError', data: err.message }));

  runner.on('loaded', forward('programLoaded'));
  runner.on('programProgress', forward('programProgress'));
  runner.on('programStatus', forward('programStatus'));
  runner.on('programError', forward('programError'));

  // Broadcast (not just reply-to-sender) so every open browser stays in
  // sync when settings change from any one of them.
  settingsStore.on('change', forward('settings'));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connectionState', data: { isOpen: connection.isOpen } }));
    ws.send(JSON.stringify({ type: 'programStatus', data: runner.getState() }));
    ws.send(JSON.stringify({ type: 'settings', data: settingsStore.get() }));
    ws.send(JSON.stringify({ type: 'plugins', data: pluginLoader.list() }));

    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', data: 'Invalid JSON message' }));
        return;
      }

      try {
        switch (msg.type) {
          case 'listPorts': {
            const ports = await FluidNCConnection.listPorts();
            ws.send(JSON.stringify({ type: 'ports', data: ports }));
            break;
          }
          case 'connect':
            await connection.connect(msg.path, msg.baud);
            break;
          case 'disconnect':
            await connection.disconnect();
            break;
          case 'jog':
            await connection.jog(msg.deltas, msg.feedrate);
            break;
          case 'jogCancel':
            connection.cancelJog();
            break;
          case 'home':
            await connection.home();
            break;
          case 'unlock':
            await connection.unlock();
            break;
          case 'reset':
            connection.softReset();
            break;
          case 'feedHold':
            connection.feedHold();
            break;
          case 'cycleStart':
            connection.cycleStart();
            break;
          case 'probe':
            await connection.probe(msg.axis, msg.distance, msg.feedrate);
            break;
          case 'probeAndZero':
            await connection.probeAndZero(
              msg.axis,
              msg.distance,
              msg.feedrate,
              msg.plateThickness,
              msg.retractDistance,
            );
            break;
          case 'gcode':
            await connection.sendLine(msg.line);
            break;
          case 'updateSettings':
            settingsStore.update(msg.settings);
            break;
          case 'updatePluginSettings':
            settingsStore.updatePluginConfig(msg.pluginId, msg.settings);
            broadcast(wss, { type: 'plugins', data: pluginLoader.list() });
            break;
          case 'pluginAction': {
            const result = await pluginLoader.invokeAction(msg.pluginId, msg.actionId, msg.params);
            ws.send(JSON.stringify({ type: 'pluginActionResult', data: { pluginId: msg.pluginId, actionId: msg.actionId, result } }));
            break;
          }
          case 'listPlugins':
            ws.send(JSON.stringify({ type: 'plugins', data: pluginLoader.list() }));
            break;
          case 'loadProgram':
            runner.load(msg.gcode, msg.name);
            break;
          case 'runProgram': {
            if (startingJob) break;
            startingJob = true;
            pluginLoader
              .runBeforeRunHooks()
              .then(() => runner.run())
              .catch((err) => {
                ws.send(JSON.stringify({ type: 'programError', data: err instanceof Error ? err.message : String(err) }));
              })
              .finally(() => {
                startingJob = false;
              });
            break;
          }
          case 'pauseProgram':
            runner.pause();
            break;
          case 'resumeProgram':
            runner.resume();
            break;
          case 'stopProgram':
            runner.stop();
            break;
          case 'clearProgram':
            runner.load('', 'No file loaded');
            break;
          case 'systemReboot':
            await rebootSystem();
            break;
          case 'systemShutdown':
            await shutdownSystem();
            break;
          case 'getFirmwareSettings': {
            const settings = await connection.getSettings();
            ws.send(JSON.stringify({ type: 'firmwareSettings', data: settings }));
            break;
          }
          default:
            ws.send(JSON.stringify({ type: 'error', data: `Unknown message type: ${(msg as { type: string }).type}` }));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error handling '${msg.type}':`, message);
        ws.send(JSON.stringify({ type: 'commandError', data: message }));
      }
    });
  });

  return { wss, pluginLoader, broadcastPlugins: () => broadcast(wss, { type: 'plugins', data: pluginLoader.list() }) };
}
