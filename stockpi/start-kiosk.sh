#!/bin/bash
set -u
URL="http://127.0.0.1:8080/"
PROFILE="/tmp/farm-kiosk-chromium"

# A dedicated temporary Chromium profile prevents a hard power loss from leaving
# behind a crashed/restored browser session that can reopen as a blank white page.
rm -rf "$PROFILE"

# Do not open the dashboard until Flask is genuinely answering.
until curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; do
  sleep 2
done

# On current Raspberry Pi OS/labwc, use native Wayland when its socket exists.
# This avoids the XWayland path that has produced blank first frames/VSync errors.
OZONE_ARGS=()
if [[ -n "${WAYLAND_DISPLAY:-}" && -n "${XDG_RUNTIME_DIR:-}" && -S "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}" ]]; then
  OZONE_ARGS+=(--ozone-platform=wayland)
fi

BOOT_URL="${URL}?boot=$(date +%s)"
chromium "$BOOT_URL" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --start-maximized \
  --password-store=basic \
  --user-data-dir="$PROFILE" \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-background-networking \
  --enable-features=OverlayScrollbar \
  "${OZONE_ARGS[@]}" &
CHROMIUM_PID=$!

# The Pi has occasionally shown a white first render even though Flask was ready.
# One automatic refresh after Chromium has had time to create its window removes
# the need for a manual F5 after boot. Failure to send the key is harmless.
(
  sleep 8
  if kill -0 "$CHROMIUM_PID" 2>/dev/null && command -v wtype >/dev/null 2>&1; then
    wtype -k F5 >/dev/null 2>&1 || true
  fi
) &

wait "$CHROMIUM_PID"
