#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Compatibility helper retained for anyone who still invokes the old command.
# The date-range fix now lives in the canonical webull_activity_service.py; this
# script only deploys that file and never edits the repository in place.
if [ ! -f "$SOURCE_DIR/webull_activity_service.py" ]; then
  echo "Canonical Webull activity service not found in $SOURCE_DIR"
  exit 1
fi
if [ ! -d "$APPDIR" ]; then
  echo "Farm dashboard not found at $APPDIR"
  exit 1
fi

install -m 700 "$SOURCE_DIR/webull_activity_service.py" "$APPDIR/webull_activity_service.py"
if [ -x "$APPDIR/venv/bin/python" ]; then
  "$APPDIR/venv/bin/python" -m py_compile "$APPDIR/webull_activity_service.py"
fi

if systemctl list-unit-files --type=service 2>/dev/null | grep -q '^farm-webull-activity.service'; then
  sudo systemctl restart farm-webull-activity
fi

echo "Canonical Webull activity history handling deployed."
echo "No repository files or credentials were modified."
