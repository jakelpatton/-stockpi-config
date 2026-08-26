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
for f in static/estate-tv.js static/market-sequence.js static/market-sequence.css static/market-alerts.js static/market-alerts.css static/market-watchlist-sync.js static/ticker-prices.js static/wyze-camera.js; do
  if [ -f "$APPDIR/$f" ]; then cp -a "$APPDIR/$f" "$APPDIR/backups/$STAMP/$f"; fi
done

install -m 644 "$SOURCE_DIR/static/estate-tv.js" "$APPDIR/static/estate-tv.js"
install -m 644 "$SOURCE_DIR/static/market-sequence.js" "$APPDIR/static/market-sequence.js"
install -m 644 "$SOURCE_DIR/static/market-sequence.css" "$APPDIR/static/market-sequence.css"
install -m 644 "$SOURCE_DIR/static/market-alerts.js" "$APPDIR/static/market-alerts.js"
install -m 644 "$SOURCE_DIR/static/market-alerts.css" "$APPDIR/static/market-alerts.css"
install -m 644 "$SOURCE_DIR/static/market-watchlist-sync.js" "$APPDIR/static/market-watchlist-sync.js"
install -m 644 "$SOURCE_DIR/static/ticker-prices.js" "$APPDIR/static/ticker-prices.js"
install -m 644 "$SOURCE_DIR/static/wyze-camera.js" "$APPDIR/static/wyze-camera.js"

sudo systemctl restart farm-dashboard
sleep 2

echo "Expanded market rotation installed."
echo "Order: Portfolio -> each owned stock -> Open Limit Orders -> My Watchlist pages -> estate screens."
echo "My Watchlist is read from Webull and refreshes automatically; owned symbols are omitted from later watchlist pages to avoid duplicates."
echo "Recommendation timestamps use recommendation_timestamp when present, otherwise last_reviewed date."
echo "Threshold attention states are enabled for Buy / Strong Buy / Aggressive Buy levels."
echo "Bottom ticker shows current price and daily percent beside stock symbols."
echo "Wyze Farm Backyard camera uses the local HLS bridge at farmpi.local:8888/farm-backyard-cam."
echo "Credentials and token files were not touched."
echo "Backup: $APPDIR/backups/$STAMP"
