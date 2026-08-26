#!/bin/bash
set -Eeuo pipefail

REPO_RAW="https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi"
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
APPDIR="$TARGET_HOME/farmpi"

if [[ -z "$TARGET_HOME" || ! -d "$APPDIR" ]]; then
  echo "Expected dashboard at $APPDIR but it was not found."
  exit 1
fi
if [[ ! -x "$APPDIR/venv/bin/python" ]]; then
  echo "Dashboard Python environment is missing at $APPDIR/venv."
  exit 1
fi

echo "Installing 1838 Estate Portfolio / Markets dashboard for $TARGET_USER..."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FILES=(
  "templates/dashboard.html"
  "owned_chart_server.py"
  "static/stock-identity.js"
  "static/owned-positions.js"
  "static/owned-positions.css"
  "static/estate-tv.js"
  "static/estate-tv.css"
  "static/rotation-controller.js"
  "static/thesis.js"
  "static/thesis.css"
  "static/thesis-summary.css"
  "static/tv-fit.css"
  "static/webull-activity.js"
  "static/webull-activity.css"
  "static/portfolio-enhanced.js"
  "static/portfolio-enhanced.css"
  "static/market-sequence.css"
  "static/market-alerts.js"
  "static/market-alerts.css"
  "static/market-watchlist-sync.js"
  "static/ticker-prices.js"
  "static/dashboard-watchdog.js"
)

for file in "${FILES[@]}"; do
  mkdir -p "$TMP/$(dirname "$file")"
  echo "  fetching $file"
  curl -fsSL "$REPO_RAW/$file?cachebust=$(date +%s%N)" -o "$TMP/$file"
done

install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/templates/dashboard.html" "$APPDIR/templates/dashboard.html"
install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/owned_chart_server.py" "$APPDIR/owned_chart_server.py"
for file in "${FILES[@]}"; do
  [[ "$file" == "templates/dashboard.html" || "$file" == "owned_chart_server.py" ]] && continue
  install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$TMP/$file" "$APPDIR/$file"
done

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

if ! wait_for_url "1838 Estate dashboard" "http://127.0.0.1:8080/api/health" 60; then
  sudo systemctl status farm-dashboard.service --no-pager || true
  sudo journalctl -u farm-dashboard.service -n 60 --no-pager || true
  exit 1
fi

HTML="$(curl -fsS --max-time 5 http://127.0.0.1:8080/)"
if ! grep -q '1838 Estate' <<<"$HTML"; then
  echo "ERROR: Flask is running but is not serving the 1838 Estate template."
  grep -nE '1838 Estate|<h1>|<title>' "$APPDIR/templates/dashboard.html" | head -n 10 || true
  exit 1
fi
if ! grep -q 'owned-positions.js?v=20260826c' <<<"$HTML"; then
  echo "ERROR: dashboard HTML does not directly load the final Portfolio JavaScript."
  exit 1
fi

echo "Base template verification: OK — 1838 Estate + direct Portfolio assets"

# Do not refresh Chromium while Flask is restarting. Once both services are
# verified healthy, send F5 into the active Raspberry Pi Wayland session. This
# fixes the white/error page that can otherwise remain after a dashboard restart.
refresh_kiosk() {
  local uid runtime socket display
  uid="$(id -u "$TARGET_USER")"
  runtime="/run/user/$uid"
  [[ -d "$runtime" ]] || return 1
  socket="$(find "$runtime" -maxdepth 1 -type s -name 'wayland-*' 2>/dev/null | head -n 1 || true)"
  [[ -n "$socket" ]] || return 1
  display="$(basename "$socket")"
  command -v wtype >/dev/null 2>&1 || return 1
  sudo -u "$TARGET_USER" env XDG_RUNTIME_DIR="$runtime" WAYLAND_DISPLAY="$display" wtype -k F5 >/dev/null 2>&1 || return 1
  return 0
}

if refresh_kiosk; then
  echo "Kiosk refresh: sent F5 after server became healthy"
else
  echo "Kiosk refresh: automatic key refresh unavailable; press F5 once on the TV keyboard"
fi

echo
echo "INSTALLED:"
echo "  - exact brand: 1838 Estate"
echo "  - Portfolio HTML and assets load directly"
echo "  - small owned-position summary strip"
echo "  - large owned-stock cards with company identity"
echo "  - logo fallback chain"
echo "  - 1-day intraday chart in every owned card"
echo "  - investment value/cost/gain-loss/shares/average cost/current price"
echo "  - automatic sizing plus Portfolio continuation pages above 6 positions"
echo "  - Markets immediately follows Portfolio"
echo "  - rotation repaired and enabled"
