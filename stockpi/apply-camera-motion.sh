#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
WYZE_ENV="$HOME/wyze-bridge/wyze.env"

if [ ! -d "$APPDIR/static" ] || [ ! -x "$APPDIR/venv/bin/python" ]; then
  echo "Farm dashboard not found at $APPDIR"
  exit 1
fi

mkdir -p "$APPDIR/backups/$STAMP/static"
for f in camera_motion_server.py static/camera-motion.js static/camera-motion.css static/wyze-camera.js; do
  if [ -f "$APPDIR/$f" ]; then
    mkdir -p "$APPDIR/backups/$STAMP/$(dirname "$f")"
    cp -a "$APPDIR/$f" "$APPDIR/backups/$STAMP/$f"
  fi
done

install -m 644 "$SOURCE_DIR/camera_motion_server.py" "$APPDIR/camera_motion_server.py"
install -m 644 "$SOURCE_DIR/static/camera-motion.js" "$APPDIR/static/camera-motion.js"
install -m 644 "$SOURCE_DIR/static/camera-motion.css" "$APPDIR/static/camera-motion.css"
install -m 644 "$SOURCE_DIR/static/wyze-camera.js" "$APPDIR/static/wyze-camera.js"

# Wyze motion is deliberately isolated from the working WebRTC streaming bridge.
# The legacy bridge is used only for its Wyze Web API motion endpoint and is
# bound to localhost, so its REST API is not exposed to other LAN devices.
if [ -f "$WYZE_ENV" ]; then
  chmod 600 "$WYZE_ENV"
  docker rm -f wyze-motion-sensor >/dev/null 2>&1 || true
  docker run -d \
    --name wyze-motion-sensor \
    --restart unless-stopped \
    -p 127.0.0.1:5001:5000 \
    --env-file "$WYZE_ENV" \
    -e 'FILTER_NAMES=Farm Backyard Cam' \
    -e 'MOTION_API=True' \
    -e 'MOTION_INT=1.5' \
    -e 'MOTION_START=False' \
    -e 'ON_DEMAND=True' \
    -e 'WB_AUTH=False' \
    mrlt8/wyze-bridge:latest >/dev/null
  echo "Wyze motion-only sidecar started on 127.0.0.1:5001."
else
  echo "WARNING: $WYZE_ENV not found. Amcrest motion will work; Wyze motion will remain unavailable."
fi

sudo tee /etc/systemd/system/farm-camera-motion.service >/dev/null <<EOF
[Unit]
Description=Farm Camera Motion Monitor
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APPDIR
EnvironmentFile=-$APPDIR/cameras.env
Environment=AMCREST_EVENT_INDEX_OFFSET=1
Environment=WYZE_MOTION_BASE=http://127.0.0.1:5001
Environment=WYZE_CAMERA_SLUG=farm-backyard-cam
ExecStart=$APPDIR/venv/bin/python $APPDIR/camera_motion_server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now farm-camera-motion.service
sudo systemctl restart farm-camera-motion.service
sudo systemctl restart farm-dashboard.service
sleep 3

echo
echo "Camera motion alert system installed."
echo "Motion API: http://farmpi.local:8091/api/motion"
echo "Behavior: newest detected camera goes full-screen; returns on motion Stop or after 10 seconds."
echo "Amcrest: local NVR VideoMotion event stream, channels 1-3."
echo "Wyze: cloud motion events from localhost-only sidecar; WebRTC streaming remains on port 5080."
echo "Backup: $APPDIR/backups/$STAMP"
echo
echo "Health:"
curl -fsS http://127.0.0.1:8091/api/health || true
echo
