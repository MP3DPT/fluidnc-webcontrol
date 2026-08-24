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

if [ "$AUTO_YES" != true ]; then
  echo "This will PERMANENTLY, on THIS Pi ($HOSTNAME_NOW):"
  echo "  - Reset the pi account password to the documented default (raspberry)"
  echo "  - Remove every key from pi's authorized_keys"
  echo "  - Delete all SSH host keys (regenerated fresh on next real boot)"
  echo "  - Delete fluidnc-webcontrol's settings, plugin config, and G-code library"
  echo "  - Clear machine-id, the orphaned swapfile, and the apt cache"
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

echo "==> Wiping fluidnc-webcontrol's saved state"
rm -f /var/lib/fluidnc-webcontrol/settings.json
rm -rf /var/lib/fluidnc-webcontrol/gcode-library
rm -rf /var/lib/fluidnc-webcontrol/.npm_cache /var/lib/fluidnc-webcontrol/.npm_logs
rm -f /var/lib/fluidnc-webcontrol/.npm_update-notifier-last-checked
# Everything above is recreated with defaults on the app's next start -
# nothing needs to pre-exist (same self-healing pattern SettingsStore and
# FileLibraryStore already use for a normal fresh install).

echo "==> Re-enabling ssh for the real first boot"
systemctl enable ssh

echo ""
echo "==> Sanitization complete."
if [ "$DO_SHUTDOWN" = true ]; then
  echo "==> Shutting down in 10s - Ctrl-C now to cancel and shut down manually instead."
  sleep 10
  shutdown -h now
else
  echo "==> --no-shutdown was passed - run 'sudo shutdown -h now' yourself when ready to pull the card."
fi
