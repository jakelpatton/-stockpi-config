#!/bin/bash
set -u
URL="http://127.0.0.1:8080/"
PROFILE="/tmp/farm-kiosk-chromium"

# A dedicated temporary Chromium profile prevents a hard power loss from leaving
# behind a crashed/restored browser session that can reopen as a blank white page.
rm -rf "$PROFILE"

# Do not open the dashboard until Flask is genuinely answering. Keep waiting
# indefinitely rather than opening a dead localhost page after an arbitrary timeout.
until curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; do
  sleep 2
done

exec chromium "$URL" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --start-maximized \
  --password-store=basic \
  --user-data-dir="$PROFILE" \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --enable-features=OverlayScrollbar
