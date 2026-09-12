# fluidnc-webcontrol v0.4.10

Small patch release - one real bug fix, no other user-facing changes.

## Fixed: reinstalling a plugin didn't pick up the new code without a restart

Installing an updated version of an already-installed plugin (via a `.zip` re-upload) silently kept running the *old* code until a manual `sudo systemctl restart fluidnc-webcontrol` or a Pi reboot - confusing when developing or testing a plugin update, since nothing in the UI indicated the update hadn't actually taken effect.

Root cause: Node's ESM module loader caches an imported module by its exact URL for the life of the process. The plugin loader always imports a plugin's entry module from the same path (`.../plugins/<id>/index.js`), so reinstalling (which rewrites that file on disk) and re-importing it returned the same stale, already-cached module instead of the new code. `plugin.json`/`settingsSchema.json` were never affected (read directly from disk each time, no caching) - only the actual plugin code was stuck.

Fixed with a cache-busting parameter on the import, so a reinstall now always loads genuinely fresh code - no restart needed, matching what was already documented as the intended behavior.

## Upgrading

This reaches an already-flashed Pi through the in-app **Update now** button (About page) - no new SD card image needed for this release, since it's a backend-only fix. See [Updating the App](https://github.com/MP3DPT/fluidnc-webcontrol/wiki/Updating-the-App) if you haven't used it before.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
