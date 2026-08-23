# fluidnc-webcontrol

A free, open-source (MIT), community-driven web control UI for [FluidNC](https://github.com/bdring/FluidNC)-based CNC controllers.

**Status: working MVP.** Connect, jog, home, probe (with plate-thickness correction), load and stream G-code with a live 3D toolpath preview, pause/resume/stop — validated against real FluidNC hardware. Not yet spindle-aware (no M3/M4/M5 control) and no plugin system yet.

This project is an independent community effort and is not affiliated with or endorsed by the FluidNC project, Bart Dring, or any controller manufacturer.

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

## Running it on a Raspberry Pi

### Quick install (recommended)

```bash
git clone <your-fork-url> fluidnc-webcontrol
cd fluidnc-webcontrol
sudo ./scripts/install.sh
```

This is the whole setup: Node.js via nvm, the `dialout` group for serial access, dependencies + build, a scoped sudoers entry for the header's Reboot/Shutdown buttons (see [`scripts/install.sh`](scripts/install.sh) for exactly what it does - it only ever grants `/sbin/shutdown`, nothing else), and a systemd service so it starts automatically on boot and restarts on crash. Run it yourself with `sudo` - deliberately not something automated on your behalf, since it touches sudoers and systemd.

Then connect the PiBot via USB and open `http://<pi-ip-address>:8000` from any browser on the network.

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
- [ ] Spindle/laser control (M3/M4/M5 + speed) - currently no way to turn the spindle on at all
- [ ] Feed/spindle override sliders during a running job
- [ ] Alarm recovery UX (currently just a status badge, no guided recovery)
- [ ] Addon/plugin API (backend hooks + frontend panel registration)
- [ ] WiFi/telnet transport (not just USB)

## Contributing

This is genuinely intended as a community project — issues, PRs, and design opinions are all welcome. If you're picking this up: the serial protocol layer (`backend/src/serial/`) is the part that most needs real-hardware testing across different FluidNC configs, since that's exactly where prior tools have had bugs.

## License

MIT — see [LICENSE](LICENSE). Do whatever you want with it, including forking, selling support for it, or building something better.
