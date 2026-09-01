#!/bin/bash
set -Eeuo pipefail

SOURCE="${1:-${USER}@farmpi.local}"
APPDIR="${HOME}/farmpi"
TRIGGER="/tmp/1838-estate-kiosk-refresh"

if [[ ! -d "$APPDIR" ]]; then
  echo "FarmPi is not installed at $APPDIR. Run the Pi 5 installer first."
  exit 1
fi

echo "Copying machine-local FarmPi settings from $SOURCE"
echo "Only credentials/settings are copied; application code remains managed by GitHub."
echo ""

copy_file() {
  local rel="$1"
  if ssh -o ConnectTimeout=5 "$SOURCE" "test -f \"\$HOME/farmpi/$rel\"" 2>/dev/null; then
    mkdir -p "$(dirname "$APPDIR/$rel")"
    rsync -a "$SOURCE:farmpi/$rel" "$APPDIR/$rel"
    echo "Copied $rel"
  else
    echo "Skipped $rel (not present on source)"
  fi
}

copy_dir() {
  local rel="$1"
  if ssh -o ConnectTimeout=5 "$SOURCE" "test -d \"\$HOME/farmpi/$rel\"" 2>/dev/null; then
    mkdir -p "$APPDIR/$rel"
    rsync -a "$SOURCE:farmpi/$rel/" "$APPDIR/$rel/"
    echo "Copied $rel/"
  else
    echo "Skipped $rel/ (not present on source)"
  fi
}

copy_file cameras.env
copy_file webull.env
copy_file conf/token.txt
copy_file dashboard_config.json
copy_file power_schedule.json
copy_file stocks.json
copy_dir .webull-token

chmod 600 "$APPDIR/cameras.env" "$APPDIR/webull.env" "$APPDIR/conf/token.txt" 2>/dev/null || true
chmod -R go-rwx "$APPDIR/.webull-token" 2>/dev/null || true

sudo systemctl restart farm-dashboard.service
touch "$TRIGGER"

echo ""
echo "Migration complete. The dashboard service was restarted and the kiosk was asked to refresh."
