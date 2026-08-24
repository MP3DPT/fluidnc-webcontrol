# fluidnc-webcontrol v0.3.0 — Raspberry Pi SD card image

A ready-to-flash Raspberry Pi OS image with fluidnc-webcontrol pre-installed and running as a system service — no manual install needed. Plug in your PiBot (or any FluidNC controller) over USB, flash this image, and you're up in a few minutes.

## Flashing instructions

1. Download `fluidnc-webcontrol.img.xz` below.
2. Open [Raspberry Pi Imager](https://www.raspberrypi.com/software/), choose **"Use custom"**, and select the downloaded file directly (it decompresses automatically — no need to extract it yourself, and no OS customization step needed).
3. Flash, then boot the Pi with the controller connected over USB (or over WiFi — see below).
4. Open `http://<pi-ip-address>:8000` from any browser on the network.

**Default login: `pi` / `raspberry`.** SSH in and run `passwd` to change it right after your first boot — same as you'd do for any device that ships with a known default. This is a deliberate, documented tradeoff (same one OctoPrint's own OctoPi image makes) rather than depending on Raspberry Pi Imager's OS customization, which has known reliability issues on current Raspberry Pi OS releases.

Need WiFi instead of wired ethernet? SSH in over the wired connection first (or attach a monitor/keyboard) and run `sudo raspi-config` → System Options → Wireless LAN.

## What's new since v0.2.0

- **Two safety fixes**: loading a new G-code file while one was still streaming could desync the backend's send loop from what was actually loaded, silently sending the wrong lines to the machine; Emergency Stop was only active while a *file* was streaming, not during jogging, homing, or manual Console commands. Both fixed and confirmed on real hardware.
- **Configurable jog step sizes** (Settings → Jog) — no longer a fixed 0.1/1/10/50mm list.
- **Logs panel** (new sidebar icon) — backend/plugin errors and warnings, viewable without SSH, with a one-click **Export diagnostics** for bug reports (automatically redacts plugin credentials).
- **Settings & plugin config backup/restore** (Settings → Backup & Restore) — export everything before reinstalling on a new device, or just to have a copy.
- **In-app update notifications** for both the app itself and installed plugins — a small indicator when a newer version is available. Plugin updates are one click; an app update still means SSH + rerunning the install script, the same deliberate "not automated on your behalf" reasoning the install scripts have always had.
- **GitHub link** on the About page.

## What's included

- fluidnc-webcontrol running under a dedicated system service account (`fluidnc-webcontrol`), independent of whatever username you set — no manual setup, systemd service enabled and started automatically
- All 5 bundled plugins pre-installed (disabled by default): Fan SHIM Control, Notifications, Smart Plug Control, Webcam Preview, Z-Probe | Touch Plate — enable and configure whichever apply to your setup from the Plugins tab
- Node.js installed system-wide, no per-user runtime management needed

## Verified before release

- Fresh install tested end-to-end against a real PiBot V4.96 PRO controller: connect, home, load a job, run an air cut to completion
- Settings backup exported from a working setup and restored cleanly onto this image
- Image sanitization is now scripted (`scripts/sanitize-image.sh`) rather than a manual checklist, and independently verified after capture: no SSH host keys, no machine-id, no leftover credentials, `pi`/`raspberry` login working, checksum matches a full re-download

## Requirements

- Raspberry Pi 4 recommended (tested on this board). Pi 3 and Pi Zero 2 W are architecturally compatible (same 64-bit-capable chip family) and expected to work but are untested by us - see the README's Hardware section for details. **The original Raspberry Pi Zero W will not work at all** - this image is 64-bit, and that board's chip has no 64-bit support, so it won't boot regardless of performance.
- A FluidNC-based controller (tested on PiBot V4.96 PRO) connected over USB serial
- **Your controller must already be running FluidNC firmware with a working `config.yaml` for your machine before this will do anything useful.** This app is a web control interface for an existing, already-configured FluidNC setup — it does not flash firmware or write machine configuration for you. See [FluidNC's own documentation](https://github.com/bdring/FluidNC/wiki) if you haven't set that up yet.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
