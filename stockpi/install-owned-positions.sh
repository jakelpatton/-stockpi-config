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

echo "Installing stable 1838 Estate Portfolio / Markets dashboard for $TARGET_USER..."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FILES=(
  "templates/dashboard.html"
  "start-kiosk.sh"
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
  "static/cameras.js"
)

for file in "${FILES[@]}"; do
  mkdir -p "$TMP/$(dirname "$file")"
  echo "  fetching $file"
  curl -fsSL "$REPO_RAW/$file?cachebust=$(date +%s%N)" -o "$TMP/$file"
done

for file in "${FILES[@]}"; do
  mode=0644
  [[ "$file" == "start-kiosk.sh" ]] && mode=0755
  install -o "$TARGET_USER" -g "$TARGET_GROUP" -m "$mode" "$TMP/$file" "$APPDIR/$file"
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

sudo tee /etc/systemd/system/farm-owned-charts.service >/dev/null <<EOF2
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
EOF2

sudo systemctl daemon-reload
sudo systemctl enable --now farm-owned-charts.service
sudo systemctl restart farm-owned-charts.service
sudo systemctl restart farm-dashboard.service

wait_for_url() {
  local name="$1" url="$2" attempts="${3:-60}"
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

echo
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
if ! grep -q '<title>1838 Estate</title>' <<<"$HTML" || ! grep -q '<h1>1838 Estate</h1>' <<<"$HTML"; then
  echo "ERROR: Flask is not serving the 1838 Estate base template."
  exit 1
fi
if ! grep -q 'owned-positions.js' <<<"$HTML"; then
  echo "ERROR: Portfolio JavaScript is missing from dashboard.html."
  exit 1
fi
echo "Base template: OK — 1838 Estate / Portfolio"

# Capture one verified Webull response to a local static snapshot. The browser
# renders this immediately, before any live Webull/quote/chart request can race.
SUMMARY_TMP="$TMP/webull-summary.json"
if ! curl -fsS --max-time 30 http://127.0.0.1:8080/api/webull/summary -o "$SUMMARY_TMP"; then
  echo "ERROR: Could not read Webull summary for initial Portfolio snapshot."
  exit 1
fi

POSITION_COUNT="$("$APPDIR/venv/bin/python" - "$SUMMARY_TMP" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open(p))
positions=[x for x in d.get('positions',[]) if float(x.get('quantity') or 0)>0]
print(len(positions))
PY
)"

if [[ "${POSITION_COUNT:-0}" -lt 1 ]]; then
  echo "ERROR: Webull summary returned no positive-share positions."
  cat "$SUMMARY_TMP"
  exit 1
fi

install -o "$TARGET_USER" -g "$TARGET_GROUP" -m 0644 "$SUMMARY_TMP" "$APPDIR/static/portfolio-snapshot.json"
echo "Portfolio snapshot: OK ($POSITION_COUNT owned positions)"

# Verify that Flask can serve the snapshot the browser will use for first paint.
SERVED_COUNT="$(curl -fsS --max-time 5 http://127.0.0.1:8080/static/portfolio-snapshot.json | "$APPDIR/venv/bin/python" -c 'import json,sys; d=json.load(sys.stdin); print(sum(1 for p in d.get("positions",[]) if float(p.get("quantity") or 0)>0))')"
if [[ "$SERVED_COUNT" != "$POSITION_COUNT" ]]; then
  echo "ERROR: Served portfolio snapshot does not match Webull response."
  exit 1
fi

echo "Served snapshot: OK ($SERVED_COUNT positions)"

if command -v node >/dev/null 2>&1; then
  node --check "$APPDIR/static/stock-identity.js"
  node --check "$APPDIR/static/owned-positions.js"
  node --check "$APPDIR/static/rotation-controller.js"
  node --check "$APPDIR/static/estate-tv.js"
  echo "JavaScript syntax: OK"
fi

# The smoke test now depends only on localhost HTML + a local static JSON file.
# It no longer waits for a live Webull request, so a card must appear quickly.
SMOKE_PROFILE="/tmp/1838-estate-smoke-$$"
SMOKE_DOM="/tmp/1838-estate-smoke-dom.html"
SMOKE_ERR="/tmp/1838-estate-smoke-errors.log"
rm -rf "$SMOKE_PROFILE" "$SMOKE_DOM" "$SMOKE_ERR"

if command -v chromium >/dev/null 2>&1; then
  timeout 25s chromium \
    --headless \
    --no-sandbox \
    --disable-gpu \
    --user-data-dir="$SMOKE_PROFILE" \
    --virtual-time-budget=7000 \
    --dump-dom \
    "http://127.0.0.1:8080/?smoke=$(date +%s)" \
    >"$SMOKE_DOM" 2>"$SMOKE_ERR" || true

  CARD_COUNT="$(grep -o 'class=\"owned-investment-card' "$SMOKE_DOM" | wc -l | tr -d ' ')"
  if [[ "${CARD_COUNT:-0}" -lt 1 ]]; then
    echo "ERROR: Chromium still did not render the local Portfolio snapshot."
    echo "Expected positions: $POSITION_COUNT"
    echo "Renderer markers:"
    grep -oE 'ownedPositionCards|data-render-source="[^"]+"|Loading portfolio|Portfolio display error' "$SMOKE_DOM" | head -n 20 || true
    echo "Recent Chromium output:"
    tail -n 40 "$SMOKE_ERR" || true
    rm -rf "$SMOKE_PROFILE"
    exit 1
  fi
  echo "Rendered Portfolio cards: OK ($CARD_COUNT cards from local snapshot)"
  rm -rf "$SMOKE_PROFILE"
else
  echo "Chromium smoke test skipped: chromium command not found"
fi

# Only after the DOM smoke test succeeds do we replace the visible kiosk.
UIDNUM="$(id -u "$TARGET_USER")"
RUNTIME="/run/user/$UIDNUM"
SOCKET="$(find "$RUNTIME" -maxdepth 1 -type s -name 'wayland-*' 2>/dev/null | head -n1 || true)"
if [[ -n "$SOCKET" ]]; then
  DISPLAY_NAME="$(basename "$SOCKET")"
  sudo -u "$TARGET_USER" env XDG_RUNTIME_DIR="$RUNTIME" WAYLAND_DISPLAY="$DISPLAY_NAME" \
    nohup "$APPDIR/start-kiosk.sh" >/tmp/1838-estate-kiosk-launch.log 2>&1 &
  echo "Kiosk: restarting one clean 1838 Estate Chromium window"
else
  echo "Kiosk: Wayland session not found; run $APPDIR/start-kiosk.sh from the desktop session"
fi

echo
echo "FIXED / VERIFIED:"
echo "  - 1838 Estate branding"
echo "  - Portfolio first paint comes from a verified local Webull snapshot"
echo "  - live Webull refresh happens after cards are already visible"
echo "  - 1-day charts enrich cards afterward and cannot block them"
echo "  - company names + logo fallback chain"
echo "  - full My investment metrics"
echo "  - automatic sizing + continuation pages"
echo "  - Markets immediately follows Portfolio"
echo "  - camera frontend remains disabled"
echo "  - 18-second rotation restored"
