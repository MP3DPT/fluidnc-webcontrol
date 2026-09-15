# fluidnc-webcontrol v0.4.11

Two additions to the plugin platform, both aimed at community "tool" plugins that need more than the normal small dialog - developed alongside a community plugin currently in progress.

## New: `"fullscreen": true` for tool plugins

A "tool" plugin (manifest `tool: true`) can now set `fullscreen: true` to have its dialog fill the entire browser window instead of the normal small centered modal - useful for anything that genuinely needs the space, like a live camera preview for part calibration/alignment.

This fills the browser window, not real OS-level fullscreen (the browser's own tabs and address bar stay visible) - deliberately, after finding that hiding them loses access to the rest of the browser for no real benefit here, and interacts badly with native OS dialogs (a plugin using a `<input type="file">` picker would otherwise have its whole dialog closed, since every browser forces fullscreen to exit whenever a native dialog opens).

See [Writing a Plugin](https://github.com/MP3DPT/fluidnc-webcontrol/wiki/Writing-a-Plugin#fullscreen-tool-dialogs) for how to use it.

## New: tool plugins can read the configured Park Corner

A tool plugin's dialog now receives `parkCorner` (`{ x: 'home' | 'far', y: 'home' | 'far' }`) alongside the existing `workingArea` in the `coreState` message - the same Settings → Working Area → Park Corner value the built-in Park button already uses, so a plugin needing a "safe corner" reference doesn't have to duplicate that setting itself.

## Fixed: a `coreState` staleness bug found while adding the above

`workingArea` was passed to the tool dialog as a fresh object literal on every render, defeating the whole point of the `useMemo` a few lines above it that was supposed to keep its reference stable - could occasionally re-deliver a stale `coreState` message a render behind a just-persisted change. Fixed to actually use the memoized value.

## Upgrading

This reaches an already-flashed Pi through the in-app **Update now** button (About page) - no new SD card image needed for this release, since it's a frontend/backend-only change.

## Full changelog

See the [commit history](https://github.com/MP3DPT/fluidnc-webcontrol/commits/master) for everything included in this build.
