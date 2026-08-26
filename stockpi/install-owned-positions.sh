#!/bin/bash
set -Eeuo pipefail

REPO_RAW="https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi"
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
APPDIR="$TARGET_HOME/farmpi"

if [[ -z "$TARGET_HOME" || ! -d "$APPDIR" ]]; then
  echo "Expected FarmPi dashboard at $APPDIR but it was not found."
  exit 1
fi
if [[ ! -x "$APPDIR/venv/bin/python" ]]; then
  echo "FarmPi Python environment is missing at $APPDIR/venv."
  exit 1
fi

echo "Installing owned-position dashboard for $TARGET_USER..."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$REPO_RAW/owned_chart_server.py" -o "$TMP/owned_chart_server.py"
curl -fsSL "$REPO_RAW/static/owned-positions.js" -o "$TMP/owned-positions.js"
curl -fsSL "$REPO_RAW/static/owned-positions.css" -o "$TMP/owned-positions.css"

install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned_chart_server.py" "$APPDIR/owned_chart_server.py"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned-positions.js" "$APPDIR/static/owned-positions.js"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned-positions.css" "$APPDIR/static/owned-positions.css"

sudo tee /etc/systemd/system/farm-owned-charts.service >/dev/null <<EOF
[Unit]
Description=FarmPi Owned Position Intraday Charts
After=network-online.target
Wants=network-online.target

[Service]
User=$TARGET_USER
WorkingDirectory=$APPDIR
ExecStart=$APPDIR/venv/bin/python $APPDIR/owned_chart_server.py
Restart=always
RestartSec=4

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now farm-owned-charts.service
sudo systemctl restart farm-owned-charts.service
sudo systemctl restart farm-dashboard.service
sleep 2

echo
if curl -fsS --max-time 4 http://127.0.0.1:8092/api/health >/dev/null; then
  echo "Owned chart service: OK"
else
  echo "Owned chart service did not answer. Recent log:"
  sudo journalctl -u farm-owned-charts.service -n 30 --no-pager || true
  exit 1
fi

echo "Owned position display files installed."
echo "Refresh Chromium with Ctrl+Shift+R if the old layout is still cached."
