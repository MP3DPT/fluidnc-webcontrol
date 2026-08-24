# fluidnc-webcontrol v0.2.0 — Raspberry Pi SD card image

A ready-to-flash Raspberry Pi OS image with fluidnc-webcontrol pre-installed and running as a system service — no manual install needed. Plug in your PiBot (or any FluidNC controller) over USB, flash this image, and you're up in a few minutes.

## Flashing instructions

1. Download `fluidnc-webcontrol.img.xz` below.
2. Open [Raspberry Pi Imager](https://www.raspberrypi.com/software/), choose **"Use custom"**, and select the downloaded file directly (it decompresses automatically — no need to extract it yourself, and no OS customization step needed).
3. Flash, then boot the Pi with the controller connected over USB (or over WiFi — see below).
4. Open `http://<pi-ip-address>:8000` from any browser on the network.

**Default login: `pi` / `raspberry`.** SSH in and run `passwd` to change it right after your first boot — same as you'd do for any device that ships with a known default. This is a deliberate, documented tradeoff (same one OctoPrint's own OctoPi image makes) rather than depending on Raspberry Pi Imager's OS customization, which has known reliability issues on current Raspberry Pi OS releases.

Need WiFi instead of wired ethernet? SSH in over the wired connection first (or attach a monitor/keyboard) and run `sudo raspi-config` → System Options → Wireless LAN.

## What's included

- fluidnc-webcontrol running under a dedicated system service account (`fluidnc-webcontrol`), independent of whatever username you set — no manual setup, systemd service enabled and started automatically
- All 5 bundled plugins pre-installed (disabled by default): Fan SHIM Control, Notifications, Smart Plug Control, Webcam Preview, Z-Probe | Touch Plate — enable and configure whichever apply to your setup from the Plugins tab
- Node.js installed system-wide, no per-user runtime management needed

## Verified before release

- Fresh install tested end-to-end against a real PiBot V4.96 PRO controller: connect, home, load a job, run to completion
- Two plugin bugs found and fixed during testing (both previously touched hardware even while disabled): Fan SHIM Control and Webcam Preview now correctly stay inactive until you enable them
- A crash bug in Smart Plug Control fixed — a lost connection to the smart plug no longer takes down the whole app, just that one action
- Plugin browse/install-from-index feature confirmed working against the live public index

## Requirements

- Raspberry Pi 4 or newer recommended (Pi 3 expected to work, untested; see README for Pi Zero W notes)
- A FluidNC-based controller (tested on PiBot V4.96 PRO) connected over USB serial
- **Your controller must already be running FluidNC firmware with a working `config.yaml` for your machine before this will do anything useful.** This app is a web control interface for an existing, already-configured FluidNC setup — it does not flash firmware or write machine configuration for you. See [FluidNC's own documentation](https://github.com/bdring/FluidNC/wiki) if you haven't set that up yet.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
