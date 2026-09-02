#!/usr/bin/env bash
set -euo pipefail

# Automates docs/building-the-image.md's sanitization checklist (steps 3's
# password/key reset, 4-7) so it can't be half-forgotten between builds -
# confirmed the hard way, more than once, that doing this by hand means
# missing a step (a leftover swapfile nearly doubling the image size; host
# keys wiped but the service never actually restarted to pick it up; etc).
#
# Run this ON the dedicated image-build Pi itself, right before pulling the
# SD card - NOT on scripts/install.sh's normal per-user install, and NEVER
# on real production hardware, since it wipes SSH keys, the pi account's
# credentials, and every bit of this app's own saved state.
#
# Usage:
#   sudo ./scripts/sanitize-image.sh                  # asks for confirmation
#   sudo ./scripts/sanitize-image.sh --yes             # skips the prompt
#   sudo ./scripts/sanitize-image.sh --no-shutdown      # sanitizes but stays up (for testing this script itself)
#   sudo ./scripts/sanitize-image.sh --yes --no-shutdown

if [ "$EUID" -ne 0 ]; then
  echo "Run this with sudo: sudo ./scripts/sanitize-image.sh"
  exit 1
fi

AUTO_YES=false
DO_SHUTDOWN=true
for arg in "$@"; do
  case "$arg" in
    --yes) AUTO_YES=true ;;
    --no-shutdown) DO_SHUTDOWN=false ;;
    *)
      echo "Unknown argument: $arg (expected --yes and/or --no-shutdown)" >&2
      exit 1
      ;;
  esac
done

# Safety net: there is more than one Pi in play across this project (real
# production hardware, and this dedicated build/test card), and this script
# is destructive enough that running it against the wrong one would be a
# real, hard-to-undo mistake. Hostname is the cheapest signal available -
# not foolproof, but enough to catch an honest "wrong terminal" slip.
HOSTNAME_NOW="$(hostname)"
if [[ "$HOSTNAME_NOW" != *build* ]]; then
  echo "!! Hostname is '$HOSTNAME_NOW', which doesn't look like the dedicated"
  echo "!! image-build Pi (expected something containing \"build\")."
  echo "!! Refusing to wipe SSH keys, credentials, and settings on what might"
  echo "!! be real production hardware."
  echo "!! If this genuinely is the build Pi under a different hostname,"
  echo "!! edit this check or rename the Pi to match."
  exit 1
fi

# Discovered from the actually-installed systemd unit, not hardcoded - this
# script is meant to run after scripts/install-image.sh specifically (fixed
# system account, /opt/fluidnc-webcontrol, data at /var/lib/fluidnc-webcontrol
# via an explicit FLUIDNC_DATA_DIR override), but reading it back out of the
# unit rather than hardcoding it again here means this stays correct even if
# install-image.sh's own layout ever changes, instead of two files having to
# be kept in sync by hand. Falls back to homedir()/.fluidnc-webcontrol (see
# backend/src/dataDir.ts) only when the unit has no FLUIDNC_DATA_DIR line -
# i.e. if this ever gets run against a scripts/install.sh per-user install
# instead, which normally wouldn't be sanitized/imaged at all, but there's
# no reason to hardcode a wrong answer for that case either.
SERVICE_FILE_INSTALLED=/etc/systemd/system/fluidnc-webcontrol.service
if [ ! -f "$SERVICE_FILE_INSTALLED" ]; then
  echo "!! $SERVICE_FILE_INSTALLED not found - did scripts/install-image.sh"
  echo "!! actually run on this Pi? Nothing to sanitize."
  exit 1
fi
APP_INSTALL_DIR="$(grep '^WorkingDirectory=' "$SERVICE_FILE_INSTALLED" | cut -d= -f2-)"
APP_USER="$(grep '^User=' "$SERVICE_FILE_INSTALLED" | cut -d= -f2-)"
APP_USER_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
APP_DATA_DIR="$(grep '^Environment=FLUIDNC_DATA_DIR=' "$SERVICE_FILE_INSTALLED" | cut -d= -f3-)"
if [ -z "$APP_DATA_DIR" ]; then
  APP_DATA_DIR="$APP_USER_HOME/.fluidnc-webcontrol"
fi
if [ -z "$APP_INSTALL_DIR" ] || [ -z "$APP_USER_HOME" ]; then
  echo "!! Couldn't read WorkingDirectory=/User= from $SERVICE_FILE_INSTALLED"
  echo "!! - refusing to guess. Check that file's contents manually."
  exit 1
fi

if [ "$AUTO_YES" != true ]; then
  echo "This will PERMANENTLY, on THIS Pi ($HOSTNAME_NOW):"
  echo "  - Reset the pi account password to the documented default (raspberry)"
  echo "  - Remove every key from pi's authorized_keys"
  echo "  - Delete all SSH host keys (regenerated fresh on next real boot)"
  echo "  - Delete fluidnc-webcontrol's settings, plugin config, and G-code"
  echo "    library ($APP_DATA_DIR)"
  echo "  - Delete the in-app updater's own working directory (any leftover"
  echo "    previous-version backup, staging, or extract data - under"
  echo "    $APP_INSTALL_DIR/.update)"
  echo "  - Clear $APP_USER's npm cache, machine-id, the orphaned swapfile,"
  echo "    and the apt cache"
  if [ "$DO_SHUTDOWN" = true ]; then
    echo "  - Shut this Pi down when finished"
  fi
  echo ""
  read -r -p "Type 'wipe' to continue: " CONFIRM
  if [ "$CONFIRM" != "wipe" ]; then
    echo "Aborted - nothing was changed."
    exit 1
  fi
fi

echo "==> Setting the documented default password"
echo 'pi:raspberry' | chpasswd

echo "==> Clearing pi's authorized_keys"
truncate -s 0 /home/pi/.ssh/authorized_keys 2>/dev/null || true

echo "==> Stopping ssh and wiping host keys"
systemctl stop ssh
rm -f /etc/ssh/ssh_host_*

echo "==> Clearing machine-id"
truncate -s 0 /etc/machine-id

echo "==> Removing orphaned swapfile and apt cache"
rm -f /var/swap
apt-get clean

echo "==> Wiping fluidnc-webcontrol's saved state ($APP_DATA_DIR)"
rm -f "$APP_DATA_DIR/settings.json"
rm -rf "$APP_DATA_DIR/gcode-library"
rm -f "$APP_DATA_DIR/console-history.json"
# Everything above is recreated with defaults on the app's next start -
# nothing needs to pre-exist (same self-healing pattern SettingsStore and
# FileLibraryStore already use for a normal fresh install).

echo "==> Clearing $APP_USER's npm cache ($APP_USER_HOME/.npm)"
# node_modules itself (inside $APP_INSTALL_DIR) stays - the app needs it to
# run. This is npm's separate download/build cache - non-trivial in size
# after install-image.sh's own `npm install` populated it (that service
# account's $HOME is the data dir itself, per its --home-dir flag, so this
# really does land under $APP_DATA_DIR when FLUIDNC_DATA_DIR is set - same
# path, cleared once here rather than needing special-casing). Safe to
# remove either way; npm re-populates it on demand, nothing here is
# load-bearing.
rm -rf "$APP_USER_HOME/.npm"

echo "==> Wiping the in-app updater's own working directory ($APP_INSTALL_DIR/.update)"
# backend/src/update/updater.ts (see that file's own comments) keeps
# installDir/.update/previous around on purpose after every successful
# update, as a manual SSH rollback option - a full copy of whatever version
# was running before, node_modules included. Genuinely useful on a live
# install, but never something a *fresh* image should ship with: it can be
# hundreds of MB (directly inflating the image PiShrink then has to carry),
# and a brand new downloader has no "previous version" to roll back to
# anyway. .update/staging and .update/extract are only ever supposed to be
# transient mid-update scratch space (cleaned up by updater.ts itself in
# both the success and failure paths), so finding either non-empty here
# would mean a build was captured mid-update - also worth guarding against.
rm -rf "$APP_INSTALL_DIR/.update"

echo "==> Clearing /tmp"
# Belt-and-suspenders, not a fix for an actual bug: confirmed /tmp is
# tmpfs on the standard Raspberry Pi OS image this project targets (`mount
# | grep /tmp`), meaning it's RAM-backed and already resets on every
# reboot on its own - a clone left there from running install-image.sh or
# this script (step 2 doesn't dictate where you clone to) was never
# actually going to survive into a `dd` capture of the powered-off card.
# Clearing it explicitly costs nothing and covers any environment where
# that assumption doesn't hold. This runs from a cloned checkout too -
# safe even if that checkout happens to be under /tmp, since Linux keeps
# an already-running script's own file open regardless of what happens to
# its directory entry.
rm -rf /tmp/*
# cd out of /tmp in case that's where this checkout lives - the running
# script itself keeps working regardless (Linux keeps its open file handle
# valid), but leaving $PWD pointed at a directory entry that no longer
# exists makes any subsequent subprocess that calls getcwd() (confirmed:
# systemctl below did) print a harmless but ugly "No such file or
# directory" warning.
cd /

echo "==> Re-enabling ssh for the real first boot"
systemctl enable ssh

echo ""
echo "==> Sanitization complete."
if [ "$DO_SHUTDOWN" = true ]; then
  echo "==> Shutting down in 10s - Ctrl-C now to cancel and shut down manually instead."
  sleep 10
  shutdown -h now
else
  # Confirmed the hard way: without this, --no-shutdown locks you out over
  # SSH immediately (ssh.service was just stopped, with no host keys, and
  # only enabled for the *next* boot - which --no-shutdown deliberately
  # skips) - defeating the entire point of this flag, which is staying
  # reachable to inspect the result before committing to power-off. This
  # is test-mode-only: it must NEVER run in the real (shutdown) path, since
  # shipping an image with host keys already regenerated here - instead of
  # genuinely fresh on each downloader's own first boot - is exactly the
  # MITM exposure step 4 exists to prevent.
  echo "==> --no-shutdown: restarting ssh now (with freshly regenerated keys) so you can keep inspecting over SSH."
  ssh-keygen -A
  systemctl start ssh
  echo "==> --no-shutdown was passed - these are TEST keys, not what a real capture would ship."
  echo "==> Run 'sudo shutdown -h now' yourself when ready to pull the card for a real build."
fi
