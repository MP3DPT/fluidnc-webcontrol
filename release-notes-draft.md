# fluidnc-webcontrol v0.4.3

**No new SD card image with this release** — this is a source-only release. If you're flashing a new SD card from scratch, keep using the [v0.3.0 image](https://github.com/MP3DPT/fluidnc-webcontrol/releases/tag/v0.3.0) for now (a fresh image covering everything through this release is planned separately). If you already have fluidnc-webcontrol running, use the in-app **Update now** button on the About page (new since v0.4.0) or the manual update steps in the README's "Running it on a Raspberry Pi" section.

## What's new since v0.3.0

- **Toolpath grid now adapts to the job** — no more fixed 400mm plane a bigger part just runs off the edge of. It expands automatically to fit whatever's loaded, with 20% breathing room around it.
- **Machine (0,0) anchored at a corner of the grid**, not its center — matches where a machine's actual home position sits, especially for the common all-positive-work-coordinates case.
- **Bold, numbered X/Y axis rulers** — solid colored lines through the origin with legible tick labels at a regular interval, so it's obvious at a glance exactly where a point sits relative to (0,0), not just "somewhere on the grid".
- **Configurable working area** (Settings → Working Area) — set your spoilboard's actual size in mm and the grid switches to that fixed size instead of auto-fitting; loading a job that doesn't fit shows an on-screen warning naming which side(s) it exceeds. Optional — leave at 0 to keep the auto-fit behavior.
- **Prominent job progress overlay** on the Toolpath view — a big, easy-to-spot percentage and time-remaining readout while a job is running or paused, instead of only the small text next to the Run/Pause/Stop buttons.
- **In-app updates, no SSH needed** — the About page now has an actual "Update now" button: shows the release notes, optionally bundles in any outdated plugins, optionally backs up all your settings first (you pick where to save it), then downloads/builds/restarts itself in place. A short service restart at the end, not a full reboot. Blocked in both directions from ever colliding with a running job - can't start an update while a job's running, can't start a job while an update's in progress.
- v0.4.1, v0.4.2, and this v0.4.3 are small follow-ups to v0.4.0 specifically to validate that update mechanism end-to-end on real hardware - and it's taken a few rounds to actually get there:
  - v0.4.1's update button failed immediately - the app's own release zip was being fetched from the browser, and GitHub's archive-download endpoint doesn't allow that (no CORS headers). Fails before the request ever leaves the browser, so nothing to clean up if you hit it.
  - v0.4.2 moved that download server-side (not subject to CORS), which got further - download succeeded, then failed trying to create its own working directory *next to* the install directory. The service account that owns the install directory doesn't own its parent (e.g. `/opt`), so it can create files inside its own directory but not a sibling of it. Also fails before touching anything real, safe to retry.
  - v0.4.3 keeps that working directory *inside* the install directory instead, needing no permission beyond what the account already has.

## What's included

- fluidnc-webcontrol running under a dedicated system service account (`fluidnc-webcontrol`), independent of whatever username you set — no manual setup, systemd service enabled and started automatically
- All 5 bundled plugins pre-installed (disabled by default): Fan SHIM Control, Notifications, Smart Plug Control, Webcam Preview, Z-Probe | Touch Plate — enable and configure whichever apply to your setup from the Plugins tab
- Node.js installed system-wide, no per-user runtime management needed

## Verified before release

- Toolpath grid/ruler/working-area features verified in a local dev/browser environment against real and synthetic test files (small parts, an oversized 800×600mm test part, working-area limits both under and over)
- v0.4.0 deployed to a real PiBot V4.96 PRO setup and confirmed working: boots correctly, toolpath preview renders correctly against real machine coordinates
- The in-app updater's real-hardware attempts (v0.4.0 → v0.4.1, then → v0.4.2) surfaced the two bugs described above - real testing doing exactly what it's for. **Still not yet confirmed working end-to-end** - this v0.4.3 release exists to retry that same real update, through the button, with both fixes in place, before it's something anyone should rely on for a production update.

## Requirements

- Raspberry Pi 4 recommended (tested on this board). Pi 3 and Pi Zero 2 W are architecturally compatible (same 64-bit-capable chip family) and expected to work but are untested by us - see the README's Hardware section for details. **The original Raspberry Pi Zero W will not work at all** on the 64-bit SD card image - that board's chip has no 64-bit support, so it won't boot regardless of performance.
- A FluidNC-based controller (tested on PiBot V4.96 PRO) connected over USB serial
- **Your controller must already be running FluidNC firmware with a working `config.yaml` for your machine before this will do anything useful.** This app is a web control interface for an existing, already-configured FluidNC setup — it does not flash firmware or write machine configuration for you. See [FluidNC's own documentation](http://wiki.fluidnc.com/en/home) if you haven't set that up yet.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
