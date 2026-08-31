# fluidnc-webcontrol v0.4.7

A ready-to-flash Raspberry Pi OS image with fluidnc-webcontrol pre-installed and running as a system service — no manual install needed. Plug in your PiBot (or any FluidNC controller) over USB, flash this image, and you're up in a few minutes. **This is now the default recommended image**, replacing v0.4.3 — same auto-updater as before, plus the fixes below baked in from the start instead of needing to be applied through it.

## Flashing instructions

1. Download `fluidnc-webcontrol.img.xz` below.
2. Open [Raspberry Pi Imager](https://www.raspberrypi.com/software/), choose **"Use custom"**, and select the downloaded file directly (it decompresses automatically — no need to extract it yourself, and no OS customization step needed).
3. Flash, then boot the Pi with the controller connected over USB (or over WiFi — see below).
4. Open `http://<pi-ip-address>:8000` from any browser on the network.

**Default login: `pi` / `raspberry`.** SSH in and run `passwd` to change it right after your first boot — same as you'd do for any device that ships with a known default. This is a deliberate, documented tradeoff (same one OctoPrint's own OctoPi image makes) rather than depending on Raspberry Pi Imager's OS customization, which has known reliability issues on current Raspberry Pi OS releases.

Need WiFi instead of wired ethernet? SSH in over the wired connection first (or attach a monitor/keyboard) and run `sudo raspi-config` → System Options → Wireless LAN.

## What's new since v0.4.3

- **Fixed: the in-app updater was silently stripping the executable bit off every file it delivered** - discovered while building and verifying the v0.4.3 SD card image, where `scripts/sanitize-image.sh` (and presumably every other `.sh` script) came out of an in-app update as a plain, non-executable file. Root cause: extraction used a method that reads the zip's stored Unix permissions but never applies them to the extracted file. Fixed by extracting file-by-file and explicitly restoring each file's original permissions.
- That fix took three releases and one manual bootstrap to actually land, since whatever code is *currently running* is what performs an update - a bug in the updater can only ever be escaped via one manual SSH deploy, no matter how many newer fixed releases get published afterward. The full story, for anyone curious: v0.4.4 shipped the permission fix but its own extraction rewrite introduced a second bug (a leftover layout check still looked for the zip's wrapper folder at a path that no longer existed), so any update *attempted from* v0.4.4 failed immediately with "Update archive had an unexpected layout" - including attempts to reach a later, already-fixed version, since the bug lives in whichever version is doing the updating, not the target. v0.4.6 fixed that layout check and was verified by running the entire extraction-and-swap sequence locally end to end before shipping. v0.4.7 (this release) is the confirmed-clean result: updating from a manually-deployed v0.4.6 through the button restored full executable permissions on every script, verified over SSH afterward.
- **`sanitize-image.sh` now also wipes the updater's own working directory** (`installDir/.update`) before an image is captured. The updater intentionally keeps a full copy of the previous version around after every successful update (a manual SSH rollback option), which is useful on a live install but was shipping as unnecessary bloat inside every fresh image otherwise - this build is noticeably smaller as a result (4.0GB used space vs. v0.4.3's 4.1GB).

## What's new since v0.3.0 (through v0.4.3)

- **Toolpath grid now adapts to the job** — no more fixed 400mm plane a bigger part just runs off the edge of. It expands automatically to fit whatever's loaded, with 20% breathing room around it.
- **Machine (0,0) anchored at a corner of the grid**, not its center — matches where a machine's actual home position sits, especially for the common all-positive-work-coordinates case.
- **Bold, numbered X/Y axis rulers** — solid colored lines through the origin with legible tick labels at a regular interval, so it's obvious at a glance exactly where a point sits relative to (0,0), not just "somewhere on the grid".
- **Configurable working area** (Settings → Working Area) — set your spoilboard's actual size in mm and the grid switches to that fixed size instead of auto-fitting; loading a job that doesn't fit shows an on-screen warning naming which side(s) it exceeds. Optional — leave at 0 to keep the auto-fit behavior.
- **Prominent job progress overlay** on the Toolpath view — a big, easy-to-spot percentage and time-remaining readout while a job is running or paused, instead of only the small text next to the Run/Pause/Stop buttons.
- **In-app updates, no SSH needed** — the About page now has an actual "Update now" button: shows the release notes, optionally bundles in any outdated plugins, optionally backs up all your settings first (you pick where to save it), then downloads/builds/restarts itself in place. A short service restart at the end, not a full reboot. Blocked in both directions from ever colliding with a running job - can't start an update while a job's running, can't start a job while an update's in progress.

## What's included

- fluidnc-webcontrol running under a dedicated system service account (`fluidnc-webcontrol`), independent of whatever username you set — no manual setup, systemd service enabled and started automatically
- All 5 bundled plugins pre-installed (disabled by default): Fan SHIM Control, Notifications, Smart Plug Control, Webcam Preview, Z-Probe | Touch Plate — enable and configure whichever apply to your setup from the Plugins tab
- Node.js installed system-wide, no per-user runtime management needed

## Verified before release

- Toolpath grid/ruler/working-area features verified in a local dev/browser environment against real and synthetic test files (small parts, an oversized 800×600mm test part, working-area limits both under and over)
- v0.4.0 deployed to a real PiBot V4.96 PRO setup and confirmed working: boots correctly, toolpath preview renders correctly against real machine coordinates
- **The permission and layout-detection fixes are confirmed working end-to-end on real hardware**: a v0.4.6 → v0.4.7 update through the in-app button completed successfully, and `scripts/sanitize-image.sh` came out `-rwxr-xr-x` afterward as it should, instead of the previously-stripped `-rw-rw-r--`.
- **This image itself round-tripped through a real sanitize → capture → shrink → reflash → boot cycle**: sanitized with the updated `scripts/sanitize-image.sh` (now also clearing the updater's `.update` working directory), captured and shrunk (30GB raw down to 4.0GB used space), reflashed onto a card from the compressed `.img.xz` (the same artifact downloaders get), and booted clean - SSH host keys regenerated, `pi`/`raspberry` login working, Settings and Plugins genuinely blank, `.update` directory confirmed absent, service started on its own with no manual steps, About page confirmed showing v0.4.7.

## Requirements

- Raspberry Pi 4 recommended (tested on this board). Pi 3 and Pi Zero 2 W are architecturally compatible (same 64-bit-capable chip family) and expected to work but are untested by us - see the README's Hardware section for details. **The original Raspberry Pi Zero W will not work at all** - this image is 64-bit, and that board's chip has no 64-bit support, so it won't boot regardless of performance.
- A FluidNC-based controller (tested on PiBot V4.96 PRO) connected over USB serial
- **Your controller must already be running FluidNC firmware with a working `config.yaml` for your machine before this will do anything useful.** This app is a web control interface for an existing, already-configured FluidNC setup — it does not flash firmware or write machine configuration for you. See [FluidNC's own documentation](http://wiki.fluidnc.com/en/home) if you haven't set that up yet.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.

## Checksum

```
sha256: 129ef8154eba18ba5cc466a5de7e6272d6a350fc7cafa7049603cab454f25f75
```
