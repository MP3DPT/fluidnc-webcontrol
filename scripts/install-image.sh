#!/usr/bin/env bash
set -euo pipefail

# fluidnc-webcontrol SD card image builder.
#
# This is NOT the installer for your own Pi - use scripts/install.sh for
# that, which installs under your own user account exactly as documented
# in the README. This script is for building the pre-flashed SD card
# image distributed to other people: it deploys the app under a fixed,
# non-login system account so it works identically no matter what
# personal username the eventual downloader creates when they flash the
# image with Raspberry Pi Imager - the app has no dependency on any one
# person's account.
#
# Run this yourself with sudo on a clean Raspberry Pi OS install that
# will be captured into the distributable image:
#   sudo ./scripts/install-image.sh
#
# What it does:
#   1. Installs Node.js 20 system-wide (NodeSource), not tied to any
#      user's home directory
#   2. Creates a dedicated system account `fluidnc-webcontrol` with no
#      login shell and no password - it only ever runs the service, it
#      is never meant to be logged into
#   3. Adds that account to the `dialout` and `video` groups (serial
#      port and webcam access)
#   4. Deploys the app to /opt/fluidnc-webcontrol and points its
#      persistent data (settings, G-code library, installed plugins) at
#      /var/lib/fluidnc-webcontrol via FLUIDNC_DATA_DIR
#   5. Adds a scoped, passwordless sudoers entry for ONLY `/sbin/shutdown`
#      (powers the header's Reboot/Shutdown buttons)
#   6. Installs + enables a systemd service so it starts automatically on
#      boot and restarts if it crashes
#
# After running this, see docs/building-the-image.md for the remaining
# sanitization steps (SSH host keys, machine-id, your own personal
# account) before capturing and shrinking the SD card.

if [ "$EUID" -ne 0 ]; then
  echo "Run this with sudo: sudo ./scripts/install-image.sh"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_USER="fluidnc-webcontrol"
INSTALL_DIR="/opt/fluidnc-webcontrol"
DATA_DIR="/var/lib/fluidnc-webcontrol"

echo "==> Building fluidnc-webcontrol image install from $REPO_DIR"

echo "==> Installing Node.js 20 system-wide (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
echo "==> Using node at $NODE_BIN"

echo "==> Creating system account '$SERVICE_USER'"
# --home-dir points at the data dir (created below) rather than a real login
# home - npm still needs *some* writable $HOME to put its cache/logs in when
# the plugin loader shells out to `npm install` for a bundled plugin's own
# dependencies (e.g. smart-plug-control's tuyapi) at startup.
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
usermod -a -G dialout,video "$SERVICE_USER"

echo "==> Deploying app to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# rsync (not cp) so re-runs update in place without duplicating removed files;
# .git/node_modules excluded - node_modules gets a fresh install below, and
# the deployed copy has no business carrying repo history.
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='backups' "$REPO_DIR"/ "$INSTALL_DIR"/

echo "==> Installing dependencies and building"
cd "$INSTALL_DIR"
npm install
npm run build:frontend
npm run build:backend

echo "==> Preparing data directory $DATA_DIR"
mkdir -p "$DATA_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"

echo "==> Adding scoped sudoers entry for shutdown/reboot"
SUDOERS_FILE=/etc/sudoers.d/fluidnc-webcontrol
echo "$SERVICE_USER ALL=(ALL) NOPASSWD: /sbin/shutdown" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"
if ! visudo -c -f "$SUDOERS_FILE" >/dev/null; then
  echo "!! sudoers syntax check failed, removing $SUDOERS_FILE"
  rm -f "$SUDOERS_FILE"
  exit 1
fi

echo "==> Installing guaranteed SSH host key regeneration"
# docs/building-the-image.md's sanitization step deletes /etc/ssh/ssh_host_*
# before capturing the image, relying on the base OS to regenerate fresh,
# unique keys on each downloader's first boot - but that turned out not to
# be reliable on every Raspberry Pi OS release (confirmed: ssh.service can
# fail to start at all when its host keys are simply missing, if whatever
# distro-provided regeneration mechanism doesn't fire in time, or isn't
# present on that particular build). Rather than depend on unverified
# distro behavior for something this important, guarantee it ourselves:
# ssh-keygen -A is already idempotent (only creates whichever key types are
# actually missing), so running it unconditionally before every ssh.service
# start is always safe, not just on the first boot after imaging.
KEYGEN_SERVICE=/etc/systemd/system/fluidnc-ssh-keygen.service
cat > "$KEYGEN_SERVICE" <<'EOF'
[Unit]
Description=Ensure SSH host keys exist before sshd starts
Before=ssh.service
DefaultDependencies=no

[Service]
Type=oneshot
ExecStart=/usr/bin/ssh-keygen -A
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable fluidnc-ssh-keygen.service

echo "==> Installing systemd service"
SERVICE_FILE=/etc/systemd/system/fluidnc-webcontrol.service
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=fluidnc-webcontrol
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/backend/dist/index.js
Restart=on-failure
RestartSec=2
Environment=PORT=8000
Environment=FLUIDNC_DATA_DIR=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now fluidnc-webcontrol

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "==> Done. fluidnc-webcontrol is running under the '$SERVICE_USER' system account."
echo "==> Open http://${IP}:8000 from any browser on the network."
echo "==> Logs: journalctl -u fluidnc-webcontrol -f"
echo ""
echo "==> This Pi is now ready to be sanitized and captured as an image -"
echo "==> see docs/building-the-image.md for the remaining steps."
