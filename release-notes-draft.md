# fluidnc-webcontrol v0.4.8

## New: Surfacing / Facing G-code generator (Tools tab)

A new "Tools" sidebar section for on-demand generator/wizard plugins - distinct from the Plugins tab's always-on dashboard panels, this is for the "open it, configure it, generate G-code, close it" kind.

- Raster or inward-spiral toolpath, target-depth or full-wasteboard mode (tied to your configured working area, with a confirmation before generating against it)
- Compact origin picker (4 corners + center), no scrollbars at any panel size
- Bit diameter/feed/spindle RPM/overrun defaults tuned from real air-testing on actual hardware

## New: Park - rapid to any corner on demand

Four corner buttons plus a default "Park" button, right next to Jog Control - useful for clearing the spindle out of the way (e.g. to place material on the spoilboard) without needing to jog manually every time.

- Computes a real machine-coordinate target from the controller's own `$23`/`$130`/`$131` (homing direction, max travel) rather than a hardcoded guess
- Settings → Park Corner picks which corner the default Park button targets - purely on-demand, not tied to any automatic "when a job finishes" behavior (see below)
- **Requires the machine to have been homed this session.** The Home button pulses as a reminder whenever connected but not yet homed, and Park stays disabled until then

### Fixed: a real safety gap that let Park crash into the machine

Confirmed the hard way: clicking Park as the first action after powering on a never-homed controller caused a small real crash. Root cause - soft limits check a target against the controller's own *tracked* position, and an un-homed controller's tracked position has no relationship to where the tool actually is. The safety net had nothing real to check against.

Fixed by tracking whether `$H` has actually completed successfully, explicitly - not inferred from machine status (a freshly power-cycled controller can, and on real hardware does, report Idle immediately, not some locked Alarm state). The backend now refuses to run Park at all without it - enforced server-side, not just suggested by the UI - and resets on every disconnect and any alarm.

### Fixed: Park's corner-direction math

The sign convention used to compute "the far end of X/Y" from `$23` was backwards from the classic Grbl wiki's documented polarity, at least for this hardware's configuration. Confirmed and corrected against a real machine (`$23=3`, a live homing debug trace, and a soft-limit alarm that proved the assumed direction wrong) rather than guessed twice.

## Console improvements

- **Command history**: ↑/↓ through what you've actually typed and sent, persisted on the backend (not just the browser) so it survives a Pi reboot and reads the same regardless of which device connects
- **`$` setting readbacks now actually show up** - typing `$23` or `$$` used to return nothing at all; that response was silently dropped instead of forwarded
- **Grbl `error:N` responses are now visible** - previously failed completely silently, with zero trace in Console or Logs, which is what made the Park homing bug above so hard to track down in the first place
- Clear and Expand buttons added to the toolbar

## Other fixes

- Removed the automatic "park on job complete" behavior - it could visibly fight a G-code file's own end-of-program move (plenty of CAM posts already emit their own return-to-0,0 before `M30`). The machine now just does whatever the loaded file does at the end; parking is purely something to reach for afterward
- Program panel's Clear button no longer requires an open machine connection - it only ever touched local/backend program state, never the serial port
- Soft Reset now its own orange, distinct from Emergency Stop's red
- About panel: a permanent link to the latest release's notes, not just visible while an update happens to already be pending
