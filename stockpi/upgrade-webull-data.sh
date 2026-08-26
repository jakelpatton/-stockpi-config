#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -x "$APPDIR/venv/bin/python" ]; then
  echo "Farm dashboard virtual environment not found at $APPDIR/venv"
  exit 1
fi
if [ ! -f "$APPDIR/webull.env" ]; then
  echo "Webull local credential file not found at $APPDIR/webull.env"
  exit 1
fi

mkdir -p "$APPDIR/static" "$APPDIR/backups"

# Back up only dashboard code/assets. Credentials and token files are never copied.
for f in webull_readonly.py static/estate-tv.js static/portfolio-enhanced.js static/portfolio-enhanced.css; do
  if [ -f "$APPDIR/$f" ]; then
    mkdir -p "$APPDIR/backups/$STAMP/$(dirname "$f")"
    cp -a "$APPDIR/$f" "$APPDIR/backups/$STAMP/$f"
  fi
done

install -m 600 "$SOURCE_DIR/webull_readonly.py" "$APPDIR/webull_readonly.py"
install -m 644 "$SOURCE_DIR/static/estate-tv.js" "$APPDIR/static/estate-tv.js"
install -m 644 "$SOURCE_DIR/static/portfolio-enhanced.js" "$APPDIR/static/portfolio-enhanced.js"
install -m 644 "$SOURCE_DIR/static/portfolio-enhanced.css" "$APPDIR/static/portfolio-enhanced.css"
install -m 700 "$SOURCE_DIR/webull_capability_test.py" "$APPDIR/webull_capability_test.py"

# Ensure the current official SDK/dependencies are present, without touching credentials.
"$APPDIR/venv/bin/pip" install -q -r "$SOURCE_DIR/requirements.txt"

sudo systemctl restart farm-dashboard
sleep 3

echo
echo "Enhanced read-only Webull data installed."
echo "Credentials remain untouched in $APPDIR/webull.env"
echo "Backup: $APPDIR/backups/$STAMP"
echo
echo "Testing Webull market-data capabilities (snapshot, extended/overnight, bars, depth, ticks, streaming)..."
echo

set +e
"$APPDIR/venv/bin/python" "$APPDIR/webull_capability_test.py"
TEST_RC=$?
set -e

echo
if [ "$TEST_RC" -eq 0 ]; then
  echo "Capability test completed."
else
  echo "Capability test returned code $TEST_RC; dashboard account access was still installed."
fi
echo "Sanitized report: $APPDIR/static/webull-capabilities.json"
echo "Portfolio screen: http://farmpi.local:8080/"
echo
systemctl --no-pager --full status farm-dashboard | sed -n '1,10p' || true
