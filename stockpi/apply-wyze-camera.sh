#!/bin/bash
set -euo pipefail
APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -d "$APPDIR/static" ]; then
  echo "Farm dashboard not found at $APPDIR"
  exit 1
fi

mkdir -p "$APPDIR/backups/$STAMP/static"
if [ -f "$APPDIR/static/wyze-camera.js" ]; then
  cp -a "$APPDIR/static/wyze-camera.js" "$APPDIR/backups/$STAMP/static/wyze-camera.js"
fi

install -m 644 "$SOURCE_DIR/static/wyze-camera.js" "$APPDIR/static/wyze-camera.js"
sudo systemctl restart farm-dashboard
sleep 2

echo "Wyze Farm Backyard camera dashboard integration installed."
echo "Player: http://farmpi.local:5080/camera/farm_backyard_cam"
echo "HLS: http://farmpi.local:5080/hls/farm_backyard_cam.m3u8"
echo "Backup: $APPDIR/backups/$STAMP"
