#!/bin/bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi"

if [[ "$EUID" -eq 0 && -z "${SUDO_USER:-}" ]]; then
  echo "Run this installer as the normal Raspberry Pi user, not from a root shell."
  exit 1
fi

TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
APPDIR="$TARGET_HOME/farmpi"

if [[ -z "$TARGET_HOME" || ! -d "$APPDIR" ]]; then
  echo "Expected dashboard installation at $APPDIR but it was not found."
  exit 1
fi

echo "Installing FarmPi automatic deployment for user $TARGET_USER..."
sudo apt-get update -qq
sudo apt-get install -y -qq git rsync curl util-linux >/dev/null

TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT
curl -fsSL "$REPO_RAW/auto-deploy.sh" -o "$TMPFILE"
sudo install -o "$TARGET_USER" -g "$TARGET_USER" -m 0755 "$TMPFILE" "$APPDIR/auto-deploy.sh"

sudo tee /etc/systemd/system/farmpi-auto-deploy.service >/dev/null <<EOF
[Unit]
Description=FarmPi GitHub auto-deploy
After=network-online.target farm-dashboard.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=DEPLOY_USER=$TARGET_USER
Environment=DEPLOY_HOME=$TARGET_HOME
ExecStart=/bin/bash $APPDIR/auto-deploy.sh
EOF

sudo tee /etc/systemd/system/farmpi-auto-deploy.timer >/dev/null <<'EOF'
[Unit]
Description=Check GitHub for FarmPi updates

[Timer]
OnBootSec=90s
OnUnitActiveSec=3min
RandomizedDelaySec=15s
Persistent=true
Unit=farmpi-auto-deploy.service

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now farmpi-auto-deploy.timer

# Trigger one deployment immediately so the Pi catches up with main now.
sudo systemctl start farmpi-auto-deploy.service

echo ""
echo "Auto-deploy enabled."
echo "The Pi now checks GitHub main about every 3 minutes."
echo "Manual deploy: sudo systemctl start farmpi-auto-deploy.service"
echo "Timer status:  systemctl status farmpi-auto-deploy.timer --no-pager"
echo "Deploy logs:   journalctl -u farmpi-auto-deploy.service -n 50 --no-pager"
