# fluidnc-webcontrol

A free, open-source (MIT), community-driven web control UI for [FluidNC](https://github.com/bdring/FluidNC)-based CNC controllers.

**Status: working MVP.** Connect, jog, home, probe (with plate-thickness correction), load and stream G-code with a live 3D toolpath preview, pause/resume/stop — validated against real FluidNC hardware. Extensible through a plugin system: browse and one-click install from a public index right in the app, or drop in your own `.zip`. Fan control, push notifications, smart-plug automation, a webcam preview, and touch-plate Z-probing all ship as plugins today. Still no native spindle/laser control (M3/M4/M5) in the core app.

This project is an independent community effort and is not affiliated with or endorsed by the FluidNC project, Bart Dring, or any controller manufacturer.

| Main screen | File Manager | Plugins |
|---|---|---|
| ![Main screen](docs/screenshots/main-screen.png) | ![File Manager](docs/screenshots/file-manager.png) | ![Plugins](docs/screenshots/plugins.png) |

## Demo

![Demo: connect, browse the sidebar, load a job, and run it on real FluidNC hardware](docs/screenshots/demo.gif)

Connecting to a real PiBot V4.96 PRO, a tour of the sidebar (Files, Plugins, Settings, About), loading a G-code file, and streaming it start to finish — live toolpath, live coordinates, live machine state, all against actual hardware. The "Job Complete" toast at the end is a UI mockup of what a push notification looks like, not a live-tested send — the Notifications plugin needs a provider (ntfy.sh, Discord, or Telegram) configured for that to fire for real.

## Why this exists

Existing FluidNC senders fall into two camps:
- FluidNC's own bundled WebUI, which is functional but dated and has no toolpath preview.
- Popular modern senders (gSender, etc.) that are built for plain GRBL/grblHAL and only unofficially, partially support FluidNC — with real, documented bugs around settings sync, homing, and soft limits.

The goal here is a UI that is **FluidNC-native from the start** — built against FluidNC's actual protocol and state machine, not retrofitted from GRBL assumptions — with a modern look, a real toolpath preview, and an addon system so the community can extend it, in the spirit of OctoPrint's plugin ecosystem.

## Architecture

```
┌─────────────┐   USB serial    ┌──────────────┐   WebSocket    ┌──────────────┐
│  PiBot /     │◄───────────────►│  Backend      │◄──────────────►│  Any browser │
│  FluidNC     │   115200 baud   │  (Node.js,    │   ws://.../ws  │  on the LAN  │
│  board       │                 │  on a Pi)     │                │  (phone,     │
└─────────────┘                 └──────────────┘                │  tablet, PC) │
                                                                  └──────────────┘
```

The backend owns the serial connection and speaks FluidNC's line protocol directly (see `backend/src/serial/`). It never runs on the end user's own computer — only on the Raspberry Pi (or any small Linux box) wired to the controller — so nothing about the end user's machine is touched. Any browser on the network can connect to it, same deployment model as CNCjs.

- `backend/` — Node.js + TypeScript. Owns the serial port, parses status reports, exposes a WebSocket API.
- `frontend/` — React + TypeScript (Vite). The UI, talks to the backend over WebSocket.

### Streaming safety

The command queue in `backend/src/serial/connection.ts` sends one line and waits for FluidNC's `ok`/`error` before sending the next. This is the conservative version of the Grbl streaming protocol — slower than character-counting streaming, but it cannot overrun the controller's planner buffer, which is the class of bug that has affected other senders paired with FluidNC. Optimizing this later (character-counting protocol) is a good first contribution once the basics are proven solid.

## Plugins

Anything FluidNC can't know about your specific shop — a cooling fan, a phone notification, a smart plug wired to the spindle, a webcam — lives in a plugin instead of the core app. A plugin is just a folder with a `plugin.json` manifest and an entry module, loaded from `~/.fluidnc-webcontrol/plugins` at runtime (see `backend/src/plugins/loader.ts`); installing one is a normal in-app action, no rebuild or restart needed.

Open the **Plugins** tab in the sidebar to:
- **Browse** what's available — the app fetches [`plugins.json`](plugins.json) from this repo and lists anything you don't already have installed, one click to install. This needs the Pi to have internet access, since it's reaching out to GitHub.
- **Install from a `.zip`** manually, for a plugin you built yourself, got somewhere else, or grabbed on another device — this works with no internet at all, which matters since running the CNC itself (jogging, streaming G-code) never needs internet either, only a local network between the Pi and your browser. If Browse can't reach the index, the app tells you so and points at this instead.

Shipped today:

| Plugin | What it does | Setup |
|---|---|---|
| Fan SHIM Control | Temperature-based fan control for the Pimoroni Fan SHIM | [Needs `gpiod`](plugins/fan-shim-control/README.md) |
| Notifications | Pushes alarms, job-completion, and connection-loss events to ntfy.sh, Discord, or Telegram | [Needs a provider account](plugins/notifications/README.md) |
| Smart Plug Control | Turns the spindle's smart plug on before a job (with a spin-up delay) and off after, regardless of how the job ended | [Needs a one-time Tuya key extraction](plugins/smart-plug-control/README.md) |
| Webcam Preview | Live preview for one or more USB or IP webcams on the main screen | [Needs `ffmpeg` + `v4l-utils`](plugins/webcam-preview/README.md) |
| Z-Probe \| Touch Plate | Touch-plate Z probing with plate-thickness correction | None — just enter your plate's dimensions |

Writing your own: a plugin gets a `PluginContext` — the serial connection, the program runner, its own settings store, `registerBeforeRun`/`registerAction` hooks, and its own Express router under `/api/plugins/<id>`. Any folder under [`plugins/`](plugins) is a working example; `backend/src/plugins/types.ts` has the exact interface.

## Running it on a Raspberry Pi

### Pre-flashed SD card image (fastest)

Skip the install entirely: download the pre-flashed image from the [v0.2.0 release](https://github.com/MP3DPT/fluidnc-webcontrol/releases/tag/v0.2.0) ([`fluidnc-webcontrol.img.xz`](https://github.com/MP3DPT/fluidnc-webcontrol/releases/download/v0.2.0/fluidnc-webcontrol.img.xz), ~767MB) and flash it with [Raspberry Pi Imager](https://www.raspberrypi.com/software/) using "Use custom" to select the `.img.xz` directly - it decompresses automatically, no OS customization step needed, SSH is already enabled.

- **Default login: `pi` / `raspberry` - change this password immediately after your first login** (`passwd`), same as you would for any device shipped with a known default.
- After first boot, open `http://<pi-ip-address>:8000` from any browser on the network - no install step required.

See [docs/building-the-image.md](docs/building-the-image.md) if you want to build this image yourself instead of trusting the published one.

### Quick install (on your own Pi OS install)

```bash
git clone https://github.com/MP3DPT/fluidnc-webcontrol.git
cd fluidnc-webcontrol
sudo ./scripts/install.sh
```

This is the whole setup: Node.js via nvm, the `dialout` group for serial access, dependencies + build, a scoped sudoers entry for the header's Reboot/Shutdown buttons (see [`scripts/install.sh`](scripts/install.sh) for exactly what it does - it only ever grants `/sbin/shutdown`, nothing else), and a systemd service so it starts automatically on boot and restarts on crash. Run it yourself with `sudo` - deliberately not something automated on your behalf, since it touches sudoers and systemd.

Then connect the PiBot via USB and open `http://<pi-ip-address>:8000` from any browser on the network.

Want to try it out before running a real job? [`samples/gcode_test.gcode`](samples/gcode_test.gcode) is a small, safe test cut - good for a first Run, or for checking a plugin fires correctly.

### Manual install

If you'd rather not run the installer (or want it as a one-off foreground process instead of a systemd service):

1. **Install Node.js 20 LTS** via [nvm](https://github.com/nvm-sh/nvm) or your distro's package manager.
2. **Add your user to the `dialout` group** (needed to access `/dev/ttyUSB0` without root):
   ```bash
   sudo usermod -a -G dialout $USER
   ```
   Log out and back in for this to take effect.
3. **Install dependencies and run:**
   ```bash
   npm install
   npm start
   ```
   This builds the frontend, builds the backend, and starts the server on port 8000 (won't survive a reboot or restart itself on crash - that's what the systemd service from the installer gives you).
4. **(Optional) Allow the header's Reboot/Shutdown buttons** by adding a scoped sudoers entry yourself:
   ```bash
   echo "$USER ALL=(ALL) NOPASSWD: /sbin/shutdown" | sudo tee /etc/sudoers.d/fluidnc-webcontrol
   sudo chmod 440 /etc/sudoers.d/fluidnc-webcontrol
   ```

For active development (auto-reload), run the backend and frontend dev servers in two terminals instead:
```bash
npm run dev:backend    # backend on :8000
npm run dev:frontend   # frontend on :5173, proxies /ws and /api to :8000
```

## Roadmap (rough)

- [x] Serial connection + status/pin reporting
- [x] Jog (including diagonal multi-axis) / home / unlock / soft reset
- [x] Z-probe with plate-thickness correction + retract, `[PRB:...]` result parsing
- [x] G-code file upload + streaming with pause/resume/stop and progress
- [x] Toolpath preview (full 3D, orbit/pan/zoom, live executed/pending coloring)
- [x] Settings persisted on the Pi (survives reloads and reboots, synced across browsers)
- [x] Reboot/shutdown from the UI (requires a one-time sudoers step, see setup above)
- [x] Addon/plugin API (backend hooks + frontend panel registration) - see [Plugins](#plugins)
- [x] Browsable plugin index with one-click install straight from a GitHub repo
- [ ] Native spindle/laser control (M3/M4/M5 + speed) - no G-code spindle control yet; Smart Plug Control covers on/off via a smart plug in the meantime
- [ ] Feed/spindle override sliders during a running job
- [ ] Alarm recovery UX (currently just a status badge, no guided recovery)
- [ ] WiFi/telnet transport (not just USB)

## Contributing

This is genuinely intended as a community project — issues, PRs, and design opinions are all welcome. If you're picking this up: the serial protocol layer (`backend/src/serial/`) is the part that most needs real-hardware testing across different FluidNC configs, since that's exactly where prior tools have had bugs.

## License

MIT — see [LICENSE](LICENSE). Do whatever you want with it, including forking, selling support for it, or building something better.
