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

echo "Installing final 1838 Estate Portfolio / Markets dashboard for $TARGET_USER..."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for file in \
  owned_chart_server.py \
  static/stock-identity.js \
  static/owned-positions.js \
  static/owned-positions.css \
  static/estate-tv.js \
  static/rotation-controller.js; do
  mkdir -p "$TMP/$(dirname "$file")"
  curl -fsSL "$REPO_RAW/$file" -o "$TMP/$file"
done

install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned_chart_server.py" "$APPDIR/owned_chart_server.py"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/static/stock-identity.js" "$APPDIR/static/stock-identity.js"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/static/owned-positions.js" "$APPDIR/static/owned-positions.js"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/static/owned-positions.css" "$APPDIR/static/owned-positions.css"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/static/estate-tv.js" "$APPDIR/static/estate-tv.js"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/static/rotation-controller.js" "$APPDIR/static/rotation-controller.js"

# dashboard_config.json is intentionally preserved by auto-deploy. Repair it here
# so an old local setting cannot keep the kiosk stuck on Portfolio.
APPDIR="$APPDIR" "$APPDIR/venv/bin/python" - <<'PY'
import json, os
from pathlib import Path
p = Path(os.environ['APPDIR']) / 'dashboard_config.json'
try:
    d = json.loads(p.read_text()) if p.exists() else {}
except Exception:
    d = {}
d['rotation_enabled'] = True
d['rotation_seconds'] = max(5, int(d.get('rotation_seconds') or 18))
d['screens'] = ['stocks','markets','activity','home','water','power','thesis']
p.write_text(json.dumps(d, indent=2) + '\n')
print('Rotation repaired:', ' -> '.join(d['screens']), f"({d['rotation_seconds']} sec)")
PY
chown "$TARGET_USER:$TARGET_GROUP" "$APPDIR/dashboard_config.json"

sudo tee /etc/systemd/system/farm-owned-charts.service >/dev/null <<EOF
[Unit]
Description=1838 Estate Owned Position Intraday Charts
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

echo
wait_for_url() {
  local name="$1" url="$2" attempts="${3:-45}"
  local i
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "$name: OK (${i}s)"
      return 0
    fi
    sleep 1
  done
  echo "$name did not answer after ${attempts}s."
  return 1
}

if ! wait_for_url "1-day chart service" "http://127.0.0.1:8092/api/health" 30; then
  sudo journalctl -u farm-owned-charts.service -n 40 --no-pager || true
  exit 1
fi

# The dashboard can take ~20 seconds to start because its startup path warms
# market/Webull caches. Give it enough time instead of reporting a false failure.
if ! wait_for_url "1838 Estate dashboard" "http://127.0.0.1:8080/api/health" 45; then
  sudo systemctl status farm-dashboard.service --no-pager || true
  sudo journalctl -u farm-dashboard.service -n 50 --no-pager || true
  exit 1
fi

echo
echo "FINAL PORTFOLIO FEATURES INSTALLED:"
echo "  - 1838 Estate branding"
echo "  - small owned-position summary strip"
echo "  - large Cash App-style owned cards"
echo "  - company display names + descriptions"
echo "  - logo chain: local file -> Google favicon -> DuckDuckGo -> monogram"
echo "  - 1-day intraday chart in every owned card"
echo "  - Total invested / value / gain-loss / shares / avg cost / current price"
echo "  - automatic 1-6 card resizing"
echo "  - automatic additional Portfolio pages above 6 positions"
echo "  - Markets immediately after all Portfolio pages"
echo "  - stable rotation without resetting the 18-second timer"
echo
echo "Reload Chromium once with Ctrl+Shift+R."
