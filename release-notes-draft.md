# fluidnc-webcontrol v0.4.0 — Raspberry Pi SD card image

A ready-to-flash Raspberry Pi OS image with fluidnc-webcontrol pre-installed and running as a system service — no manual install needed. Plug in your PiBot (or any FluidNC controller) over USB, flash this image, and you're up in a few minutes.

## Flashing instructions

1. Download `fluidnc-webcontrol.img.xz` below.
2. Open [Raspberry Pi Imager](https://www.raspberrypi.com/software/), choose **"Use custom"**, and select the downloaded file directly (it decompresses automatically — no need to extract it yourself, and no OS customization step needed).
3. Flash, then boot the Pi with the controller connected over USB (or over WiFi — see below).
4. Open `http://<pi-ip-address>:8000` from any browser on the network.

**Default login: `pi` / `raspberry`.** SSH in and run `passwd` to change it right after your first boot — same as you'd do for any device that ships with a known default. This is a deliberate, documented tradeoff (same one OctoPrint's own OctoPi image makes) rather than depending on Raspberry Pi Imager's OS customization, which has known reliability issues on current Raspberry Pi OS releases.

Need WiFi instead of wired ethernet? SSH in over the wired connection first (or attach a monitor/keyboard) and run `sudo raspi-config` → System Options → Wireless LAN.

## What's new since v0.3.0

- **Toolpath grid now adapts to the job** — no more fixed 400mm plane a bigger part just runs off the edge of. It expands automatically to fit whatever's loaded, with 20% breathing room around it.
- **Machine (0,0) anchored at a corner of the grid**, not its center — matches where a machine's actual home position sits, especially for the common all-positive-work-coordinates case.
- **Bold, numbered X/Y axis rulers** — solid colored lines through the origin with legible tick labels at a regular interval, so it's obvious at a glance exactly where a point sits relative to (0,0), not just "somewhere on the grid".
- **Configurable working area** (Settings → Working Area) — set your spoilboard's actual size in mm and the grid switches to that fixed size instead of auto-fitting; loading a job that doesn't fit shows an on-screen warning naming which side(s) it exceeds. Optional — leave at 0 to keep the auto-fit behavior.
- **Prominent job progress overlay** on the Toolpath view — a big, easy-to-spot percentage and time-remaining readout while a job is running or paused, instead of only the small text next to the Run/Pause/Stop buttons.

## What's included

- fluidnc-webcontrol running under a dedicated system service account (`fluidnc-webcontrol`), independent of whatever username you set — no manual setup, systemd service enabled and started automatically
- All 5 bundled plugins pre-installed (disabled by default): Fan SHIM Control, Notifications, Smart Plug Control, Webcam Preview, Z-Probe | Touch Plate — enable and configure whichever apply to your setup from the Plugins tab
- Node.js installed system-wide, no per-user runtime management needed

## Verified before release

- All of the above verified in a local dev/browser environment against real and synthetic test files (small parts, an oversized 800×600mm test part, working-area limits both under and over)
- **Not yet re-verified against real PiBot hardware or re-captured as an image** - this section gets filled in with the real hardware/image checklist (same as every prior release) once this build is actually deployed and tested on the Pi

## Requirements

- Raspberry Pi 4 recommended (tested on this board). Pi 3 and Pi Zero 2 W are architecturally compatible (same 64-bit-capable chip family) and expected to work but are untested by us - see the README's Hardware section for details. **The original Raspberry Pi Zero W will not work at all** - this image is 64-bit, and that board's chip has no 64-bit support, so it won't boot regardless of performance.
- A FluidNC-based controller (tested on PiBot V4.96 PRO) connected over USB serial
- **Your controller must already be running FluidNC firmware with a working `config.yaml` for your machine before this will do anything useful.** This app is a web control interface for an existing, already-configured FluidNC setup — it does not flash firmware or write machine configuration for you. See [FluidNC's own documentation](http://wiki.fluidnc.com/en/home) if you haven't set that up yet.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
