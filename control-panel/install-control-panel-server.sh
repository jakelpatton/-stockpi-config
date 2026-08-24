#!/bin/bash
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
APPDIR="$HOME/patton-control-panel"

echo "Installing Patton Estate control-panel server..."
sudo apt update
sudo apt install -y python3-venv
mkdir -p "$APPDIR/assets"
cp "$SRC/index.html" "$SRC/victorian.css" "$SRC/control-panel.js" "$SRC/app.py" "$SRC/requirements.txt" "$SRC/control-panel.json" "$APPDIR/"
cp -r "$SRC/assets/"* "$APPDIR/assets/" 2>/dev/null || true
python3 -m venv "$APPDIR/venv"
"$APPDIR/venv/bin/pip" install --upgrade pip >/dev/null
"$APPDIR/venv/bin/pip" install -r "$APPDIR/requirements.txt" >/dev/null

ENVFILE="$APPDIR/.env"
cat > "$ENVFILE" <<EOF2
FARM_API_BASE=http://127.0.0.1:8080
HOME_ASSISTANT_URL=http://127.0.0.1:8123
CONTROL_PANEL_PORT=8090
HOME_ASSISTANT_TOKEN=
EOF2
chmod 600 "$ENVFILE"

sudo tee /etc/systemd/system/patton-control-panel.service >/dev/null <<EOF2
[Unit]
Description=Patton Estate Gilded Domestic Switchboard
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APPDIR
ExecStart=$APPDIR/venv/bin/python $APPDIR/app.py
Restart=always
RestartSec=4

[Install]
WantedBy=multi-user.target
EOF2
sudo systemctl daemon-reload
sudo systemctl enable --now patton-control-panel.service

echo ""
echo "Control panel server installed."
echo "Open: http://farmpi.local:8090"
echo "Preview controls work immediately."
echo "To enable real Home Assistant controls later, add a long-lived token to: $ENVFILE"
echo "Then map entity IDs in: $APPDIR/control-panel.json"
echo "Restart with: sudo systemctl restart patton-control-panel"
