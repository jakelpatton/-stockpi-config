#!/bin/bash
set -u
URL="http://127.0.0.1:8080/"

# Wait until the Farm dashboard is actually serving HTML before opening Chromium.
# This prevents Chromium from getting stuck on a blank page during slower Pi boots.
for _ in $(seq 1 120); do
  if curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; then
    exec chromium "$URL" \
      --kiosk \
      --noerrdialogs \
      --disable-infobars \
      --no-first-run \
      --start-maximized \
      --password-store=basic \
      --enable-features=OverlayScrollbar
  fi
  sleep 1
done

# If the dashboard still did not become ready after two minutes, open it anyway
# so a manual refresh can be used while troubleshooting the service.
exec chromium "$URL" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --start-maximized \
  --password-store=basic \
  --enable-features=OverlayScrollbar
