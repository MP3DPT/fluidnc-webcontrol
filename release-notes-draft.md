# fluidnc-webcontrol v0.4.6

**No new SD card image with this release** — an ordinary follow-up like this doesn't need one; the [v0.4.3 image](https://github.com/MP3DPT/fluidnc-webcontrol/releases/tag/v0.4.3) is still the current recommended download for a fresh SD card, and its in-app auto-updater will pick this release up like any other. Use the **Update now** button on the About page, or the manual update steps in the README's "Running it on a Raspberry Pi" section.

## What's new since v0.4.3

- **Fixed: the in-app updater was silently stripping the executable bit off every file it delivered** - discovered while building and verifying the v0.4.3 SD card image, where `scripts/sanitize-image.sh` (and presumably every other `.sh` script) came out of an in-app update as a plain, non-executable file. Root cause: extraction used a method that reads the zip's stored Unix permissions but never applies them to the extracted file. Fixed by extracting file-by-file and explicitly restoring each file's original permissions.
- v0.4.4 shipped that fix but couldn't self-verify it - whatever code is *currently running* is what performs an update, so the v0.4.3 → v0.4.4 update was carried out by v0.4.3's own (still-buggy) extraction code, same chicken-and-egg pattern as the CORS/EACCES bugs earlier.
- **v0.4.5 was meant to be that real test and instead surfaced a second real bug**: the fix stripped the zip's wrapper folder from each file's path while writing it out, but a leftover check still looked for that wrapper folder afterward - so a v0.4.4 → v0.4.5 update failed immediately with "Update archive had an unexpected layout", before touching anything real. **Fixed in this v0.4.6**: that check now looks for the extracted `package.json` at the actual (unwrapped) root instead. Confirmed by re-running the real extraction logic locally against v0.4.5's own published archive zip: files now land in the right place, matching a real repo layout.
- v0.4.6 is the next attempt at that real-hardware verification - a v0.4.4/v0.4.5 → v0.4.6 update through the button is what actually exercises both the extraction-location fix and the original permission-bit fix together for the first time.

## What's new since v0.3.0 (through v0.4.3)

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
- **The in-app updater is confirmed working end-to-end on real hardware.** The v0.4.0 → v0.4.1 and → v0.4.2 attempts surfaced the two bugs described above (real testing doing exactly what it's for); a v0.4.2 → v0.4.3 update through the button itself completed successfully: backup saved, download, `npm install`, both builds, the restart, and the automatic page reload all worked, with settings and every installed plugin's state intact afterward.
- The executable-bit fix (v0.4.4) was verified against real permission data in v0.4.3's published archive zip before release. The layout fix (this v0.4.6) was verified by running the actual extraction code locally against v0.4.5's published archive zip, confirming `package.json` and every other file now land at the correct path. **Neither has yet been confirmed through an actual live in-app update** - v0.4.5 was meant to be that test and failed at the layout-detection step before ever reaching the permission-bit code, for the chicken-and-egg reason explained above. This v0.4.6 release is the next attempt at closing that gap for real - update through the button, then check `ls -la` on a deployed script over SSH.

## Requirements

- Raspberry Pi 4 recommended (tested on this board). Pi 3 and Pi Zero 2 W are architecturally compatible (same 64-bit-capable chip family) and expected to work but are untested by us - see the README's Hardware section for details. **The original Raspberry Pi Zero W will not work at all** on the 64-bit SD card image - that board's chip has no 64-bit support, so it won't boot regardless of performance.
- A FluidNC-based controller (tested on PiBot V4.96 PRO) connected over USB serial
- **Your controller must already be running FluidNC firmware with a working `config.yaml` for your machine before this will do anything useful.** This app is a web control interface for an existing, already-configured FluidNC setup — it does not flash firmware or write machine configuration for you. See [FluidNC's own documentation](http://wiki.fluidnc.com/en/home) if you haven't set that up yet.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
