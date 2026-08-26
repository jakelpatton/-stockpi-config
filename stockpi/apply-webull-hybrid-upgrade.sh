#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -x "$APPDIR/venv/bin/python" ]; then
  echo "Farm dashboard virtual environment not found at $APPDIR/venv"
  exit 1
fi

# The hybrid behavior now lives in canonical repository files. Do not text-patch
# deployed Python/JavaScript, because that created drift that auto-deploy later
# overwrote. Credentials and tokens are deliberately untouched.
install -m 644 "$SOURCE_DIR/webull_readonly.py" "$APPDIR/webull_readonly.py"
install -m 644 "$SOURCE_DIR/static/portfolio-enhanced.js" "$APPDIR/static/portfolio-enhanced.js"
if [ -f "$SOURCE_DIR/run_dashboard.py" ]; then
  install -m 644 "$SOURCE_DIR/run_dashboard.py" "$APPDIR/run_dashboard.py"
fi

"$APPDIR/venv/bin/python" -m py_compile "$APPDIR/webull_readonly.py"
if [ -f "$APPDIR/run_dashboard.py" ]; then
  "$APPDIR/venv/bin/python" -m py_compile "$APPDIR/run_dashboard.py"
fi

sudo systemctl restart farm-dashboard

echo
echo "Canonical hybrid Webull/public portfolio code deployed."
echo "Webull account/order access remains read-only."
echo "Public quote fallback retains last known-good data during provider failures."
echo "Webull credentials and token files were not touched."
