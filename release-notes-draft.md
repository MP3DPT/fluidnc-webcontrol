# fluidnc-webcontrol v0.4.9

Small patch release - one real bug fix, no other user-facing changes.

## Fixed: "Maximum call stack size exceeded" on larger G-code files

Files around 1.5MB or larger (roughly 50,000+ lines) failed immediately when uploaded through the File Manager, and crashed the main dashboard to a blank screen when loaded via the Program tab's Load File — both requiring a manual browser refresh to recover, with no file actually loaded either way.

Root cause: computing a file's feed-rate range for its metadata spread every cutting-move line's feedrate as individual arguments into `Math.min(...)`/`Math.max(...)` - fine for small files, but enough lines blows the JS engine's call-stack argument limit. Fixed with a running min/max loop instead, the same safe pattern already used elsewhere in the same function for bounding-box size.

Verified against a synthetic 1.7MB/66,713-line file through both previously-failing paths (File Manager upload, and Program tab Load File) - both now complete successfully with correct metadata and no console errors.

Thanks to @rdarkness for the detailed bug report and diagnostics export ([#4](https://github.com/MP3DPT/fluidnc-webcontrol/issues/4)).

## Upgrading

This reaches an already-flashed Pi through the in-app **Update now** button (About page) - no new SD card image needed for this release, since it's a frontend-only fix. See [Updating the App](https://github.com/MP3DPT/fluidnc-webcontrol/wiki/Updating-the-App) if you haven't used it before.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
