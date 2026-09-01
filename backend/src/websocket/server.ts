import type { Server as HttpServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { FluidNCConnection } from '../serial/connection.js';
import { ProgramRunner } from '../program/runner.js';
import { SettingsStore, type Settings } from '../settings/store.js';
import { rebootSystem, restartService, shutdownSystem } from '../system/power.js';
import { PluginLoader } from '../plugins/loader.js';
import type { LogStore } from '../logging/logStore.js';
import { applyUpdate } from '../update/updater.js';

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
  | { type: 'gcode'; line: string }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'restoreSettings'; settings: unknown }
  | { type: 'updatePluginSettings'; pluginId: string; settings: Record<string, unknown> }
  | { type: 'pluginAction'; pluginId: string; actionId: string; params?: unknown; requestId?: string }
  | { type: 'listPlugins' }
  | { type: 'loadProgram'; name: string; gcode: string }
  | { type: 'runProgram' }
  | { type: 'pauseProgram' }
  | { type: 'resumeProgram' }
  | { type: 'stopProgram' }
  | { type: 'clearProgram' }
  | { type: 'systemReboot' }
  | { type: 'systemShutdown' }
  | { type: 'getFirmwareSettings' }
  // parkX/parkY let a caller park to a specific corner on demand (the
  // main-screen corner buttons) without touching the saved Settings ->
  // Job Completion default - omitting them (the "Park" button proper)
  // falls back to that default, same as the post-job auto-park above.
  | { type: 'park'; parkX?: 'home' | 'far'; parkY?: 'home' | 'far' };

function broadcast(wss: WebSocketServer, message: unknown) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

export async function attachWebSocketServer(
  httpServer: HttpServer,
  connection: FluidNCConnection,
  httpApp: Express,
  logStore: LogStore,
) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const runner = new ProgramRunner(connection);
  const settingsStore = new SettingsStore();
  let startingJob = false;

  // Tracked here (not just in the frontend) so it survives a reconnect or a
  // page reload mid-update - see App.tsx's auto-reload logic, which relies
  // on asking the backend "did the update actually finish", not just "did
  // the WebSocket come back", to tell a real completion apart from an
  // unrelated network blip during the build.
  type UpdateStatus =
    | { status: 'idle' }
    | { status: 'running'; step: string }
    | { status: 'complete' }
    | { status: 'failed'; error: string };
  let updateStatus: UpdateStatus = { status: 'idle' };
  const setUpdateStatus = (next: UpdateStatus) => {
    updateStatus = next;
    broadcast(wss, { type: 'updateStatus', data: updateStatus });
  };

  /** The frontend just POSTs which tag to update to (see index.ts's
   * /api/system/update route) - the download itself happens here, not
   * client-side, since GitHub's archive-zip endpoint doesn't send CORS
   * headers for cross-origin browser fetches (see updater.ts's
   * fetchUpdateZip for the full story). Refuses to start while a job is
   * running/paused (symmetric to applyLoadedFile's own refusal to load a
   * new file mid-run) since the update ends in a service restart that would
   * otherwise yank the connection out from under a streaming job with no
   * controlled stop. Never throws - every outcome, including a refusal to
   * even start, goes out as an updateStatus broadcast, since the HTTP
   * request that kicks this off responds immediately and doesn't wait
   * around for the result (see index.ts). */
  async function startAppUpdate(tag: string): Promise<void> {
    if (updateStatus.status === 'running') {
      setUpdateStatus({ status: 'failed', error: 'An update is already in progress' });
      return;
    }
    const jobState = runner.getState().state;
    if (jobState === 'running' || jobState === 'paused') {
      setUpdateStatus({ status: 'failed', error: 'A program is currently running - stop it before updating' });
      return;
    }

    setUpdateStatus({ status: 'running', step: 'Starting…' });
    try {
      await applyUpdate(tag, (step) => setUpdateStatus({ status: 'running', step }));
      setUpdateStatus({ status: 'complete' });
      // Give the 'complete' broadcast above a moment to actually reach
      // clients before the restart below tears this process down - without
      // this, connected browsers could see the WebSocket just drop with no
      // final status, indistinguishable from a failure.
      setTimeout(() => {
        restartService().catch((err) => {
          console.error('Failed to restart after update:', err);
        });
      }, 500);
    } catch (err) {
      setUpdateStatus({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }

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
  // Anything the controller sends back that isn't status/feedback/ok/error -
  // most notably $-setting readbacks like "$23=3" from typing "$23" or "$$"
  // in the Console. Previously silently dropped here (connection.ts still
  // emitted it, nothing forwarded it), so Console showed nothing at all for
  // those - confirmed the hard way asking for a $23 value to fix Park's
  // corner-direction math.
  connection.on('message', forward('message'));
  connection.on('probeResult', forward('probeResult'));
  connection.on('welcome', forward('welcome'));
  connection.on('open', forward('connectionOpen'));
  connection.on('close', forward('connectionClosed'));
  connection.on('portError', (err: Error) => broadcast(wss, { type: 'portError', data: err.message }));

  runner.on('loaded', forward('programLoaded'));
  runner.on('programProgress', forward('programProgress'));
  runner.on('programStatus', forward('programStatus'));
  runner.on('programError', forward('programError'));

  // There used to be an automatic "what happens when a job finishes"
  // action here (Settings -> jobCompletionAction: stay/origin/park),
  // removed once the on-demand Park buttons (see ParkCluster) existed as
  // a manual alternative - confirmed on real hardware that it could
  // visibly fight a G-code file's own end-of-program move (many CAM
  // posts already emit their own "return to 0,0" right before M30, so
  // the machine would go there, then immediately get yanked to a park
  // corner). The machine now just does whatever the file itself does at
  // the end; parking is purely something the user reaches for afterward.

  // Broadcast (not just reply-to-sender) so every open browser stays in
  // sync when settings change from any one of them.
  settingsStore.on('change', forward('settings'));

  logStore.on('line', forward('backendLogLine'));

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'connectionState', data: { isOpen: connection.isOpen } }));
    ws.send(JSON.stringify({ type: 'programStatus', data: runner.getState() }));
    ws.send(JSON.stringify({ type: 'settings', data: settingsStore.get() }));
    ws.send(JSON.stringify({ type: 'plugins', data: pluginLoader.list() }));
    ws.send(JSON.stringify({ type: 'backendLogs', data: logStore.list() }));
    ws.send(JSON.stringify({ type: 'updateStatus', data: updateStatus }));

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
          case 'park': {
            const defaults = settingsStore.get().general;
            await connection.park(msg.parkX ?? defaults.parkX, msg.parkY ?? defaults.parkY);
            break;
          }
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
          case 'gcode':
            await connection.sendLine(msg.line);
            break;
          case 'updateSettings':
            settingsStore.update(msg.settings);
            break;
          case 'restoreSettings':
            settingsStore.restore(msg.settings);
            // settingsStore's own 'change' broadcast only carries the raw
            // settings object - PluginCard/PluginsManagerPanel read plugin
            // config from the separate `plugins` list instead, which
            // doesn't refresh on its own until the next install/uninstall
            // or reload. Broadcast it too so a restore shows up immediately.
            broadcast(wss, { type: 'plugins', data: pluginLoader.list() });
            break;
          case 'updatePluginSettings':
            settingsStore.updatePluginConfig(msg.pluginId, msg.settings);
            broadcast(wss, { type: 'plugins', data: pluginLoader.list() });
            break;
          case 'pluginAction': {
            // Own try/catch (rather than relying on the outer one) so a
            // failure is correlated back via requestId - the outer catch's
            // generic commandError has no way to tell a live on-dashboard
            // panel which of its in-flight requests just failed.
            try {
              const result = await pluginLoader.invokeAction(msg.pluginId, msg.actionId, msg.params);
              ws.send(
                JSON.stringify({
                  type: 'pluginActionResult',
                  data: { pluginId: msg.pluginId, actionId: msg.actionId, requestId: msg.requestId, result },
                }),
              );
            } catch (err) {
              ws.send(
                JSON.stringify({
                  type: 'pluginActionError',
                  data: {
                    pluginId: msg.pluginId,
                    actionId: msg.actionId,
                    requestId: msg.requestId,
                    error: err instanceof Error ? err.message : String(err),
                  },
                }),
              );
            }
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
            if (updateStatus.status === 'running') {
              ws.send(JSON.stringify({ type: 'programError', data: 'An update is in progress - try again once it finishes.' }));
              break;
            }
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

  return {
    wss,
    pluginLoader,
    broadcastPlugins: () => broadcast(wss, { type: 'plugins', data: pluginLoader.list() }),
    startAppUpdate,
  };
}
