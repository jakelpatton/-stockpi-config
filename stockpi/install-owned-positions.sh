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

echo "Installing Portfolio / Markets dashboard for $TARGET_USER..."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$REPO_RAW/owned_chart_server.py" -o "$TMP/owned_chart_server.py"
curl -fsSL "$REPO_RAW/static/owned-positions.js" -o "$TMP/owned-positions.js"
curl -fsSL "$REPO_RAW/static/owned-positions.css" -o "$TMP/owned-positions.css"
curl -fsSL "$REPO_RAW/static/estate-tv.js" -o "$TMP/estate-tv.js"
curl -fsSL "$REPO_RAW/static/rotation-controller.js" -o "$TMP/rotation-controller.js"

install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned_chart_server.py" "$APPDIR/owned_chart_server.py"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned-positions.js" "$APPDIR/static/owned-positions.js"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned-positions.css" "$APPDIR/static/owned-positions.css"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/estate-tv.js" "$APPDIR/static/estate-tv.js"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/rotation-controller.js" "$APPDIR/static/rotation-controller.js"

# Repair the Pi's preserved local dashboard settings. Keep its current theme, but
# explicitly re-enable rotation and use the simplified sequence. The Markets DOM
# is created by owned-positions.js immediately after Portfolio loads.
APPDIR="$APPDIR" "$APPDIR/venv/bin/python" - <<'PY'
import json, os
from pathlib import Path
p = Path(os.environ['APPDIR']) / 'dashboard_config.json'
try:
    d = json.loads(p.read_text()) if p.exists() else {}
except Exception:
    d = {}
d['rotation_enabled'] = True
d['rotation_seconds'] = int(d.get('rotation_seconds') or 18)
d['screens'] = ['stocks','markets','activity','home','water','power','thesis']
p.write_text(json.dumps(d, indent=2) + '\n')
print('Rotation repaired:', d['screens'], 'every', d['rotation_seconds'], 'seconds')
PY
chown "$TARGET_USER:$TARGET_GROUP" "$APPDIR/dashboard_config.json"

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
sleep 3

echo
if curl -fsS --max-time 4 http://127.0.0.1:8092/api/health >/dev/null; then
  echo "Owned chart service: OK"
else
  echo "Owned chart service did not answer. Recent log:"
  sudo journalctl -u farm-owned-charts.service -n 30 --no-pager || true
  exit 1
fi

if curl -fsS --max-time 4 http://127.0.0.1:8080/ >/dev/null; then
  echo "Farm dashboard: OK"
else
  echo "Farm dashboard did not answer. Recent log:"
  sudo journalctl -u farm-dashboard.service -n 30 --no-pager || true
  exit 1
fi

echo "Portfolio / Markets display installed."
echo "Brand: 1838 Estate"
echo "Rotation: Portfolio -> Markets -> Activity -> Estate screens"
echo "Refresh Chromium with Ctrl+Shift+R if the old layout is still cached."
