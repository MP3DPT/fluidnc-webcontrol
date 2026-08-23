import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const RECONCILE_INTERVAL_MS = 5000;
const STREAM_FPS = 10;
const STALL_TIMEOUT_MS = 8000;
const BOUNDARY = 'frame';
const SLOTS = [1, 2, 3, 4];
const DEFAULT_RESOLUTION = '1280x720';
const DEFAULT_FOCUS_VALUE = 30;

function readSlots(config) {
  return SLOTS.map((slot) => ({
    slot,
    enabled: Boolean(config[`camera${slot}Enabled`]),
    name: config[`camera${slot}Name`] || `Camera ${slot}`,
    source: config[`camera${slot}Source`] || 'usb',
    device: config[`camera${slot}Device`] || '',
    url: config[`camera${slot}Url`] || '',
    resolution: config[`camera${slot}Resolution`] || DEFAULT_RESOLUTION,
    autoFocus: config[`camera${slot}AutoFocus`] ?? true,
    focusValue: Number(config[`camera${slot}FocusValue`] ?? DEFAULT_FOCUS_VALUE),
  })).filter((c) => c.enabled);
}

/**
 * Applies focus controls via v4l2-ctl, which works fine on a device that's
 * already streaming (control ioctls aren't exclusive the way opening the
 * device for capture is) - confirmed on the StreamCam. Autofocus off and the
 * manual focus value must be two SEPARATE calls: some UVC drivers reject a
 * focus_absolute write in the same batch that also disables
 * focus_automatic_continuous, since they evaluate "is this control active"
 * before applying the rest of that same batch.
 */
function applyFocus(device, autoFocus, focusValue) {
  const setAuto = spawnSync('v4l2-ctl', ['-d', device, `--set-ctrl=focus_automatic_continuous=${autoFocus ? 1 : 0}`]);
  if (setAuto.status !== 0) {
    console.error(`Webcam Preview: failed to set autofocus for ${device} - ${setAuto.stderr?.toString().trim()}`);
    return;
  }
  if (!autoFocus) {
    const setValue = spawnSync('v4l2-ctl', ['-d', device, `--set-ctrl=focus_absolute=${focusValue}`]);
    if (setValue.status !== 0) {
      console.error(`Webcam Preview: failed to set focus value for ${device} - ${setValue.stderr?.toString().trim()}`);
    }
  }
}

/**
 * Holds one long-lived ffmpeg process per USB camera, repackaging its
 * native MJPEG frames into a multipart/x-mixed-replace HTTP stream (works
 * directly in a plain <img> tag - no browser plugins or WebRTC needed).
 * One process per camera, fanned out to every connected viewer, since a
 * v4l2 device only allows one reader at a time.
 */
class CameraStream {
  constructor(device, resolution) {
    this.device = device;
    this.resolution = resolution;
    this.viewers = new Set();
    this.ffmpeg = null;
    this.lastDataAt = 0;
    this.start();
  }

  start() {
    const ffmpeg = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-f', 'v4l2',
      '-input_format', 'mjpeg',
      '-video_size', this.resolution,
      '-framerate', String(STREAM_FPS),
      '-i', this.device,
      '-f', 'mpjpeg',
      '-boundary_tag', BOUNDARY,
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    this.lastDataAt = Date.now(); // grace period until the first real frame arrives
    ffmpeg.stdout.on('data', (chunk) => {
      this.lastDataAt = Date.now();
      for (const res of this.viewers) res.write(chunk);
    });
    ffmpeg.stderr.on('data', () => {}); // ffmpeg logs verbosely to stderr on success too - not worth surfacing
    ffmpeg.on('error', (err) => {
      console.error(`Webcam Preview: ffmpeg failed to start for ${this.device} - ${err.message}`);
    });
    ffmpeg.on('exit', (code, signal) => {
      if (this.ffmpeg === ffmpeg) {
        console.error(`Webcam Preview: ffmpeg for ${this.device} exited (code=${code}, signal=${signal})`);
        this.ffmpeg = null;
      }
    });
    this.ffmpeg = ffmpeg;
  }

  isAlive() {
    if (this.ffmpeg === null || this.ffmpeg.exitCode !== null || this.ffmpeg.signalCode !== null) return false;
    // A process can stay alive while completely stuck - confirmed on this
    // hardware via strace: ffmpeg spinning on VIDIOC_DQBUF/EAGAIN forever
    // at ~100% CPU without ever exiting, after the camera's capture
    // pipeline stalled (e.g. from control changes made while it was
    // streaming). A healthy stream produces frames continuously regardless
    // of viewer count, so no data for this long means it's wedged, not idle.
    if (Date.now() - this.lastDataAt > STALL_TIMEOUT_MS) return false;
    return true;
  }

  /** Self-heal, same reasoning as the Fan SHIM plugin's held gpioset process. */
  ensure() {
    if (this.isAlive()) return;
    if (this.ffmpeg) {
      // Still technically running (the stuck-but-alive case) - it won't
      // exit on its own, so force it down before starting a replacement,
      // otherwise the new process fails immediately with "device busy".
      console.error(`Webcam Preview: ffmpeg for ${this.device} appears stuck (no frames for ${STALL_TIMEOUT_MS}ms) - forcing restart`);
      this.ffmpeg.removeAllListeners('exit');
      this.ffmpeg.kill('SIGKILL');
      this.ffmpeg = null;
    }
    this.start();
  }

  addViewer(res) {
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'close',
    });
    this.viewers.add(res);
    res.on('close', () => this.viewers.delete(res));
  }

  stop() {
    if (this.ffmpeg) {
      this.ffmpeg.removeAllListeners('exit');
      // SIGTERM (kill()'s default) is unreliable here - confirmed on this
      // hardware that ffmpeg doesn't respond to it promptly while piping
      // MJPEG to stdout, leaving a zombie process that holds the v4l2
      // device open and makes every subsequent respawn fail with "Device
      // or resource busy". SIGKILL is instant and there's nothing this
      // process needs to flush/finalize, so there's no downside to it.
      this.ffmpeg.kill('SIGKILL');
    }
    this.ffmpeg = null;
    for (const res of this.viewers) res.end();
    this.viewers.clear();
  }
}

function proxyIpCamera(url, res) {
  let upstreamReq;
  try {
    const client = url.startsWith('https:') ? https : http;
    upstreamReq = client.get(url, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    });
  } catch (err) {
    res.status(502).end(`Invalid camera URL: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  upstreamReq.on('error', (err) => {
    if (!res.headersSent) res.status(502).end(`Failed to reach camera: ${err.message}`);
    else res.end();
  });
  res.on('close', () => upstreamReq.destroy());
}

function renderPanelHtml(cameras) {
  const tiles = cameras
    .map(
      (c) => `
      <figure>
        <img src="stream/${c.slot}" alt="${escapeHtml(c.name)}" loading="lazy" ondblclick="toggleFullscreen(this)" title="Double-click for fullscreen" />
        <figcaption>${escapeHtml(c.name)}</figcaption>
        <button class="open-btn" onclick="window.open('stream/${c.slot}', '_blank')" title="Open in a new tab">&#x2197;</button>
      </figure>`,
    )
    .join('\n');

  const body = cameras.length
    ? `<div class="grid">${tiles}</div>`
    : `<p class="empty">No cameras enabled - configure them in Settings &rarr; Webcam Preview.</p>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="refresh" content="60" />
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body { margin: 0; padding: 0.5rem; background: #111; font-family: system-ui, sans-serif; color: #ddd; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.5rem; height: 100%; }
  figure { margin: 0; position: relative; height: 100%; }
  img { width: 100%; height: 100%; display: block; border-radius: 0.3rem; background: #000; object-fit: cover; cursor: zoom-in; }
  img:fullscreen { object-fit: contain; background: #000; }
  figcaption {
    position: absolute; left: 0.35rem; bottom: 0.3rem; pointer-events: none;
    font-size: 0.7rem; color: #fff; background: rgba(0, 0, 0, 0.55);
    padding: 0.1rem 0.4rem; border-radius: 0.2rem;
  }
  .open-btn {
    position: absolute; right: 0.35rem; top: 0.3rem;
    font-size: 0.8rem; line-height: 1; color: #fff; background: rgba(0, 0, 0, 0.55);
    border: none; border-radius: 0.2rem; padding: 0.2rem 0.35rem; cursor: pointer;
  }
  .open-btn:hover { background: rgba(0, 0, 0, 0.8); }
  .empty { font-size: 0.85rem; color: #888; text-align: center; }
</style>
<script>
  function toggleFullscreen(img) {
    if (document.fullscreenElement === img) document.exitFullscreen();
    else img.requestFullscreen().catch(() => {});
  }
</script>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function activate(ctx) {
  const streams = new Map(); // slot -> CameraStream, usb cameras only
  const appliedFocus = new Map(); // slot -> last-applied "device|autoFocus|focusValue", to avoid re-issuing v4l2-ctl every tick

  const reconcile = () => {
    const cameras = readSlots(ctx.settings.get());
    const wantedUsb = new Map(cameras.filter((c) => c.source === 'usb').map((c) => [c.slot, c]));

    for (const [slot, stream] of streams) {
      const wanted = wantedUsb.get(slot);
      if (!wanted || wanted.device !== stream.device || wanted.resolution !== stream.resolution) {
        stream.stop();
        streams.delete(slot);
        appliedFocus.delete(slot);
      }
    }
    for (const [slot, camera] of wantedUsb) {
      if (!streams.has(slot)) {
        streams.set(slot, new CameraStream(camera.device, camera.resolution));
      } else {
        streams.get(slot).ensure();
      }

      const focusKey = `${camera.device}|${camera.autoFocus}|${camera.focusValue}`;
      if (appliedFocus.get(slot) !== focusKey) {
        applyFocus(camera.device, camera.autoFocus, camera.focusValue);
        appliedFocus.set(slot, focusKey);
      }
    }
  };
  reconcile();
  const timer = setInterval(reconcile, RECONCILE_INTERVAL_MS);

  ctx.app.get('/panel', (_req, res) => {
    const cameras = readSlots(ctx.settings.get());
    res.set('Content-Type', 'text/html');
    res.send(renderPanelHtml(cameras));
  });

  ctx.app.get('/stream/:slot', (req, res) => {
    const slot = Number(req.params.slot);
    const cameras = readSlots(ctx.settings.get());
    const camera = cameras.find((c) => c.slot === slot);
    if (!camera) {
      res.status(404).end('Camera not configured');
      return;
    }
    if (camera.source === 'usb') {
      const stream = streams.get(slot);
      if (!stream) {
        res.status(503).end('Camera stream not ready yet');
        return;
      }
      stream.addViewer(res);
    } else {
      if (!camera.url) {
        res.status(400).end('Camera URL not set');
        return;
      }
      proxyIpCamera(camera.url, res);
    }
  });

  ctx.registerAction('list-usb-cameras', async () => {
    const entries = readdirSync('/dev').filter((f) => /^video\d+$/.test(f));
    if (entries.length === 0) return { message: 'Webcam Preview: no /dev/video* devices found' };
    return { message: `Webcam Preview: found ${entries.map((e) => `/dev/${e}`).join(', ')}` };
  });

  return () => {
    clearInterval(timer);
    for (const stream of streams.values()) stream.stop();
    streams.clear();
    appliedFocus.clear();
  };
}

export default { activate };
