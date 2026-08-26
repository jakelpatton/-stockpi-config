#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
WYZE_ENV="$HOME/wyze-bridge/wyze.env"
AMCREST_GO2RTC="$HOME/amcrest-go2rtc"
CAMERA_ENV="$APPDIR/cameras.env"

if [ ! -d "$APPDIR/static" ] || [ ! -x "$APPDIR/venv/bin/python" ]; then
  echo "Farm dashboard not found at $APPDIR"
  exit 1
fi
if [ ! -f "$CAMERA_ENV" ]; then
  echo "Amcrest camera environment not found at $CAMERA_ENV"
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

# Build a private go2rtc config from the existing Amcrest credentials.
# The RTSP URLs use the NVR's main stream (subtype=0), preserving the camera's
# native H.264 resolution/bitrate/FPS with no transcoding on the Pi.
mkdir -p "$AMCREST_GO2RTC"
chmod 700 "$AMCREST_GO2RTC"
PI_IP="$(hostname -I | awk '{print $1}')"
python3 - "$CAMERA_ENV" "$AMCREST_GO2RTC/go2rtc.yaml" "$PI_IP" <<'PY'
import json
import sys
from urllib.parse import quote

env_path, out_path, pi_ip = sys.argv[1:]
env = {}
with open(env_path, encoding='utf-8') as f:
    for raw in f:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip()

ip = env.get('AMCREST_NVR_IP', '192.168.1.4')
user = quote(env.get('AMCREST_NVR_USER', 'admin'), safe='')
password = quote(env.get('AMCREST_NVR_PASSWORD', ''), safe='')
if not password:
    raise SystemExit('AMCREST_NVR_PASSWORD is empty')

def rtsp(channel):
    return f'rtsp://{user}:{password}@{ip}:554/cam/realmonitor?channel={channel}&subtype=0'

streams = {
    'front_porch': rtsp(1),
    'rockhouse_front': rtsp(2),
    'rockhouse_back': rtsp(3),
}

with open(out_path, 'w', encoding='utf-8') as f:
    f.write('api:\n')
    f.write('  listen: ":1985"\n')
    f.write('  origin: "*"\n')
    f.write('rtsp:\n')
    f.write('  listen: ""\n')
    f.write('webrtc:\n')
    f.write('  listen: ":8556"\n')
    f.write('  candidates:\n')
    f.write(f'    - "{pi_ip}:8556"\n')
    f.write('streams:\n')
    for name, url in streams.items():
        f.write(f'  {name}: {json.dumps(url)}\n')
    f.write('preload:\n')
    for name in streams:
        f.write(f'  {name}: video\n')
PY
chmod 600 "$AMCREST_GO2RTC/go2rtc.yaml"

docker pull alexxit/go2rtc:latest >/dev/null
docker rm -f amcrest-go2rtc >/dev/null 2>&1 || true
docker run -d \
  --name amcrest-go2rtc \
  --restart unless-stopped \
  --network host \
  -v "$AMCREST_GO2RTC:/config:ro" \
  alexxit/go2rtc:latest >/dev/null

echo "Amcrest native-resolution go2rtc relay started."
echo "  Front Porch:     NVR channel 1 main stream • 1920x1080 H.264 @ 30 fps"
echo "  Rockhouse Front: NVR channel 2 main stream • 2688x1520 H.264 @ 20 fps"
echo "  Rockhouse Back:  NVR channel 3 main stream • 3840x2160 H.264 @ 15 fps"
echo "  Browser relay:   http://farmpi.local:1985"
echo "  WebRTC media:    $PI_IP:8556"

# Wyze motion is deliberately isolated from the working WebRTC streaming bridge.
# The legacy bridge is used only for its read-only Wyze Web API motion endpoint.
# It is bound to localhost and camera controls are disabled.
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
    -e 'DISABLE_CONTROL=True' \
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
sleep 4

echo
echo "Camera motion alert system installed."
echo "Motion API: http://farmpi.local:8091/api/motion"
echo "Behavior: newest detected camera goes full-screen; returns on motion Stop or after 10 seconds."
echo "Amcrest: native main-stream RTSP -> go2rtc -> WebRTC; no JPEG refresh and no transcoding."
echo "Wyze: read-only cloud motion events; working Floodlight Pro WebRTC remains on port 5080."
echo "Backup: $APPDIR/backups/$STAMP"
echo
echo "Health:"
curl -fsS http://127.0.0.1:8091/api/health || true
echo
echo "Amcrest relay streams:"
curl -fsS http://127.0.0.1:1985/api/streams || true
echo
