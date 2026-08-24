#!/usr/bin/env bash
set -euo pipefail

# fluidnc-webcontrol installer.
#
# Run this yourself with sudo on the Raspberry Pi (or any Linux box) that
# will run the app: `sudo ./scripts/install.sh`
#
# This is intentionally something YOU run, not something this project (or
# any agent working on it) executes on your behalf - it modifies sudoers
# and installs a systemd service, both real system/security changes that
# should be a step you take knowingly.
#
# What it does:
#   1. Installs Node.js 20 (via nvm, as your user - no system-wide changes)
#   2. Adds your user to the `dialout` group (serial port access)
#   3. Installs dependencies and builds the frontend + backend
#   4. Adds a scoped, passwordless sudoers entry for ONLY `/sbin/shutdown`
#      (powers the header's Reboot/Shutdown buttons - remove
#      /etc/sudoers.d/fluidnc-webcontrol later if you don't want this)
#   5. Installs + enables a systemd service so it starts automatically on
#      boot and restarts if it crashes

if [ "$EUID" -ne 0 ]; then
  echo "Run this with sudo: sudo ./scripts/install.sh"
  exit 1
fi

REAL_USER="${SUDO_USER:-$(whoami)}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installing fluidnc-webcontrol for user '$REAL_USER' from $REPO_DIR"

echo "==> Checking for Node.js"
if ! sudo -u "$REAL_USER" bash -lc 'command -v node' >/dev/null 2>&1; then
  echo "==> Installing Node.js via nvm"
  sudo -u "$REAL_USER" bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
  sudo -u "$REAL_USER" bash -c 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install 20'
fi

NODE_BIN=$(sudo -u "$REAL_USER" bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; command -v node')
NPM_BIN=$(sudo -u "$REAL_USER" bash -c 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; command -v npm')
echo "==> Using node at $NODE_BIN"
NODE_DIR=$(dirname "$NODE_BIN")

echo "==> Adding $REAL_USER to the dialout group (serial port access)"
usermod -a -G dialout "$REAL_USER"

echo "==> Installing dependencies and building"
# npm's own shebang is "#!/usr/bin/env node" - without node's directory on
# PATH here, `env` can't resolve it even when npm is invoked by absolute
# path, which is exactly the failure this PATH override avoids.
sudo -u "$REAL_USER" env PATH="$NODE_DIR:$PATH" bash -c "cd '$REPO_DIR' && npm install && npm run build:frontend && npm run build:backend"

echo "==> Adding scoped sudoers entry for shutdown/reboot"
SUDOERS_FILE=/etc/sudoers.d/fluidnc-webcontrol
echo "$REAL_USER ALL=(ALL) NOPASSWD: /sbin/shutdown" > "$SUDOERS_FILE"
chmod 440 "$SUDOERS_FILE"
if ! visudo -c -f "$SUDOERS_FILE" >/dev/null; then
  echo "!! sudoers syntax check failed, removing $SUDOERS_FILE"
  rm -f "$SUDOERS_FILE"
  exit 1
fi

echo "==> Installing systemd service"
SERVICE_FILE=/etc/systemd/system/fluidnc-webcontrol.service
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=fluidnc-webcontrol
After=network.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN $REPO_DIR/backend/dist/index.js
Restart=on-failure
RestartSec=2
Environment=PORT=8000

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now fluidnc-webcontrol

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "==> Done. fluidnc-webcontrol is running and will start automatically on boot."
echo "==> Open http://${IP}:8000 from any browser on the network."
echo "==> Logs: journalctl -u fluidnc-webcontrol -f"
