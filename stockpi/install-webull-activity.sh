#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE="farm-webull-activity.service"

if [ ! -x "$APPDIR/venv/bin/python" ]; then
  echo "Farm dashboard virtual environment not found at $APPDIR/venv"
  echo "Install the Farm dashboard first, then run this installer again."
  exit 1
fi

mkdir -p "$APPDIR/static"

# Never replace ~/farmpi/webull.env here. Webull credentials remain local.
install -m 700 "$SOURCE_DIR/webull_activity_service.py" "$APPDIR/webull_activity_service.py"
install -m 644 "$SOURCE_DIR/static/webull-activity.js" "$APPDIR/static/webull-activity.js"
install -m 644 "$SOURCE_DIR/static/webull-activity.css" "$APPDIR/static/webull-activity.css"
install -m 644 "$SOURCE_DIR/static/webull-history.html" "$APPDIR/static/webull-history.html"
install -m 644 "$SOURCE_DIR/static/estate-tv.js" "$APPDIR/static/estate-tv.js"
install -m 644 "$SOURCE_DIR/dashboard_config.json" "$APPDIR/dashboard_config.json"

# Webull US currently rejects same-day start/end parameters on Order History.
# Patch the source/deployed monitor to use Webull's full-history query and filter
# today's orders locally. This script is idempotent.
if [ -f "$SOURCE_DIR/fix-webull-activity-history.sh" ]; then
  chmod +x "$SOURCE_DIR/fix-webull-activity-history.sh"
  "$SOURCE_DIR/fix-webull-activity-history.sh"
fi

# The official Webull SDK should already be present after configure-webull.sh,
# but ensure the existing Farm venv has the current dependencies.
"$APPDIR/venv/bin/pip" install -q -r "$SOURCE_DIR/requirements.txt"

sudo tee "/etc/systemd/system/$SERVICE" >/dev/null <<EOF
[Unit]
Description=Farm Webull Read-Only Activity Monitor
After=network-online.target farm-dashboard.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APPDIR
Environment=FARM_APP_DIR=$APPDIR
Environment=WEBULL_ENV_FILE=$APPDIR/webull.env
ExecStart=$APPDIR/venv/bin/python $APPDIR/webull_activity_service.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE"
sudo systemctl restart "$SERVICE"
sudo systemctl restart farm-dashboard

echo
echo "Webull activity monitor installed."
echo "It uses query/subscription methods only; no order-changing calls are implemented."
echo "Service: $SERVICE"
echo "TV activity data: $APPDIR/static/webull-activity.json"
echo "Complete history: http://farmpi.local:8080/static/webull-history.html"
echo
sudo systemctl --no-pager --full status "$SERVICE" | sed -n '1,12p' || true
