# Building the distributable SD card image

This is the checklist for producing the pre-flashed image that gets attached
to a GitHub Release, so anyone can flash it and be running in minutes with
no manual install. If you just want to run the app on your own Pi, use
[`scripts/install.sh`](../scripts/install.sh) instead - this document is
only for building the image other people download.

The image must ship with **no trace of the machine it was built on** - no
*personal* account, no SSH host keys, no secrets, no personal G-code files -
but it does ship with one documented, fixed login: `pi` / `raspberry`, SSH
enabled by default. That's a deliberate, informed choice, not an oversight:
the alternative (rely on Raspberry Pi Imager to inject a fresh per-user
account at flash time) turned out to be unreliable in practice - Imager's
own OS-customization feature has known, currently-unresolved bugs on recent
Raspberry Pi OS releases (cloud-init-based Trixie images in particular),
and burned a lot of build time chasing Imager-version and cloud-init
quirks before this project settled on the same tradeoff OctoPi has long
made: a known default is simpler and more reliable than a customization
mechanism that doesn't reliably work, as long as it's loudly documented
(see the README's setup instructions) rather than left as a silent trap.
Everything below still guarantees there's no trace of *this specific build
machine* - the fixed account is intentional, everything else is not.

## 1. Start from a clean Raspberry Pi OS install

Flash the latest Raspberry Pi OS Lite (64-bit) to a card and boot it. The
account you create here (via Imager's customization, or manually - see
step 3 for the manual fallback if customization doesn't take, which is a
real possibility on current Trixie-based images) doesn't need to be
`pi`/`raspberry` yet; it just needs SSH access so you can run the next
steps. It becomes the documented default in step 3.

## 2. Deploy the app under its own system account

```bash
git clone https://github.com/MP3DPT/fluidnc-webcontrol.git
cd fluidnc-webcontrol
sudo ./scripts/install-image.sh
```

This creates a dedicated `fluidnc-webcontrol` system account (no login
shell, no password), installs Node.js system-wide, and deploys the app to
`/opt/fluidnc-webcontrol` with its data directory at
`/var/lib/fluidnc-webcontrol` - completely independent of whatever
personal account exists on the build machine, or gets created later by
whoever flashes the image.

Verify it actually works before moving on: open `http://<pi-ip>:8000`,
connect to a real controller if you have one handy, confirm the service
survives a reboot (`sudo reboot`, then check `systemctl status
fluidnc-webcontrol`).

## 3. One-time only: set the account to the documented default

Only needed the *first* time you set up this particular build Pi - once
the account is named `pi`, step 4 below handles everything else (password,
keys) on every subsequent build, so this step won't come up again.

Whatever personal/build account you used in step 1 needs to end up as
exactly `pi` (password gets set by step 4) - the same name the README and
release notes tell downloaders about.

```bash
# Confirm exactly what personal accounts exist (UID 1000-65533)
awk -F: '$3 >= 1000 && $3 < 65534 {print $1, $3, $6}' /etc/passwd

# If the build account isn't already named "pi", rename it (and its home dir)
sudo usermod -l pi -d /home/pi -m <old-username>
sudo groupmod -n pi <old-username>
```

Confirm `ssh_pwauth`/`PasswordAuthentication` is enabled in
`/etc/ssh/sshd_config` (it should be, by default, unless something in your
build process disabled it) - password auth is how downloaders actually log
in with the documented credentials.

`pi`/`raspberry` is purely an OS-level SSH/console login for administering
the Pi itself - it is not a dependency of the app. Step 2's dedicated
`fluidnc-webcontrol` system account is what actually owns the systemd
service, the `dialout`/`video`/`gpio` group memberships, the scoped
`shutdown` sudoers entry, and the data directory. A downloader renaming
`pi`, changing its password, swapping to key-only auth, or disabling
password auth entirely does not affect the app in any way - the web UI
keeps running untouched through any of that, since it never depended on
that account to begin with. Worth telling downloaders this directly if it
comes up, since "change the default password" is exactly what the README
tells them to do right after first login.

## 4. Sanitize for distribution

```bash
sudo ./scripts/sanitize-image.sh
```

This is [`scripts/sanitize-image.sh`](../scripts/sanitize-image.sh) -
everything in the list below used to be a manual checklist, and confirmed the hard way
(more than once) that doing it by hand means something eventually gets
missed: a leftover swapfile nearly doubling one build's image size, host
keys wiped but the service never actually restarted to pick it up, that
kind of thing. The script does all of it in order, asks for a typed
confirmation first (since it's genuinely destructive), and refuses to run
at all unless the Pi's hostname looks like a build machine - a safety net
against running it against real production hardware by mistake.

What it does, and why each part matters:

- **Resets the `pi` password and clears `authorized_keys`** - the
  documented `raspberry` default needs to actually be set, and your own
  SSH key must not survive into the shipped image (that would be an actual
  unintended backdoor into every device flashed from it).
- **Wipes SSH host keys.** If every image shares the same ones, every
  device flashed from it is impersonable/MITM-able by anything that
  captured them. `install-image.sh` already installs a
  `fluidnc-ssh-keygen.service` unit that runs `ssh-keygen -A` before
  `ssh.service` starts on every boot - confirmed necessary since relying on
  Raspberry Pi OS's own `regenerate_ssh_host_keys.service` firing
  automatically was not reliable on every release (an image was captured
  and flashed with host keys removed, and `ssh.service` simply never came
  up - no distro-provided mechanism regenerated them, silently taking SSH
  away entirely on that build).
- **Clears `machine-id`** - also unique-per-device, also regenerated by
  systemd on next boot.
- **Removes an orphaned `/var/swap` and runs `apt-get clean`.** An
  earlier `dphys-swapfile`-era leftover holding real swapped-out data,
  plus an uncleaned download cache from step 2's `ffmpeg` install, nearly
  doubled one build's compressed image size (696MB -> 1.02GB) - neither is
  unique-per-device like the host keys, they're just build-machine debris
  PiShrink's free-space zeroing can't help with, since both count as
  *used* space, not free space. (Raspberry Pi OS Bookworm/Trixie normally
  swaps to `zram` - compressed RAM, not a disk file - by default; a
  leftover disk-backed swapfile from an older setup won't show up in
  `swapon`/`fstab` if it's not currently active, only by sitting there.)
- **Wipes `fluidnc-webcontrol`'s entire saved state** - `settings.json`,
  the G-code library, npm cache/logs under the data directory. No smart-plug
  local keys, ntfy topics, or test G-code files should ship; the app
  recreates all of this fresh on its next start, so nothing needs to
  pre-exist.
- **Clears `/tmp`.** Confirmed the hard way: it's part of the persistent
  root filesystem on this OS, not tmpfs - a git clone left there from
  running this script or `install-image.sh` (step 2 doesn't dictate where
  you clone to) survives right into the captured image otherwise.
- **Re-enables `ssh`** for the real first boot (it gets stopped, not
  disabled, partway through - it just won't have working host keys until
  that first boot regenerates them).
- **Shuts the Pi down** once everything above is done, by default (10s
  countdown, `Ctrl-C` to cancel) - pass `--no-shutdown` to skip that (e.g.
  while testing this script itself) and `--yes` to skip the confirmation
  prompt.

## 5. Capture the image

Once step 4 has shut the Pi down, remove the SD card and, on another machine:

```bash
# Read the raw card to an image file (replace /dev/sdX with your card's device)
sudo dd if=/dev/sdX of=fluidnc-webcontrol.img bs=4M status=progress conv=fsync

# Shrink it to just the used space (https://github.com/Drewsif/PiShrink)
sudo pishrink.sh fluidnc-webcontrol.img

# Compress for distribution
xz -T0 -9 fluidnc-webcontrol.img
```

## 6. Publish

Attach `fluidnc-webcontrol.img.xz` to a [GitHub
Release](https://github.com/MP3DPT/fluidnc-webcontrol/releases) - not the
git repo itself, which isn't meant for multi-gigabyte binaries. Include in
the release notes:

- Flash with [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
  using "Use custom" to select the `.img.xz` directly (it decompresses
  automatically) - no OS customization step needed, the image already has
  working SSH
- **Default login: `pi` / `raspberry` - change this password immediately
  after your first login** (`passwd`), same as you would for any device
  shipped with a known default
- After first boot, open `http://<pi-ip>:8000` from any browser on the
  network

The [v0.2.0 release](https://github.com/MP3DPT/fluidnc-webcontrol/releases/tag/v0.2.0)
is the current published image, verified end-to-end (headers, size, and a
full-download sha256 match) after upload - a good reference for what the
release notes and attached asset should look like.
