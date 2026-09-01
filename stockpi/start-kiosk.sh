#!/bin/bash
set -u

APPDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="http://127.0.0.1:8080/"
PROFILE="/tmp/1838-estate-kiosk-chromium"
LOG="/tmp/1838-estate-kiosk.log"

# Backward-compatible migration: older FarmPi installations/autostart entries call
# start-kiosk.sh directly. Once the supervisor exists, a standalone invocation
# updates labwc autostart, starts the supervisor, and exits. The supervisor sets
# FARMPI_KIOSK_CHILD=1 when it intentionally calls this launcher, preventing a
# recursion loop.
if [[ "${FARMPI_KIOSK_CHILD:-0}" != "1" && -f "$APPDIR/kiosk-supervisor.sh" ]]; then
  if [[ -f "$APPDIR/configure-kiosk-autostart.sh" ]]; then
    bash "$APPDIR/configure-kiosk-autostart.sh" >/dev/null 2>&1 || true
  fi

  if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  fi
  if [[ -z "${WAYLAND_DISPLAY:-}" && -d "$XDG_RUNTIME_DIR" ]]; then
    SOCKET="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' -print -quit 2>/dev/null || true)"
    [[ -n "$SOCKET" ]] && export WAYLAND_DISPLAY="$(basename "$SOCKET")"
  fi

  nohup bash "$APPDIR/kiosk-supervisor.sh" >>/tmp/1838-estate-kiosk-bootstrap.log 2>&1 </dev/null &
  exit 0
fi

# Discover the active Wayland session when launched from a terminal/system helper.
if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi
if [[ -z "${WAYLAND_DISPLAY:-}" && -d "$XDG_RUNTIME_DIR" ]]; then
  SOCKET="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' -print -quit 2>/dev/null || true)"
  [[ -n "$SOCKET" ]] && export WAYLAND_DISPLAY="$(basename "$SOCKET")"
fi

# Do not open Chromium until Flask is genuinely serving the dashboard.
until curl -fsS --max-time 2 "$URL" | grep -q '1838 Estate'; do
  sleep 2
done

# This Raspberry Pi is a dedicated kiosk. Close stale Chromium sessions so an old
# Farm/Stocks page cannot sit on top of the current 1838 Estate window.
pkill -u "$(id -u)" chromium >/dev/null 2>&1 || true
pkill -u "$(id -u)" chromium-browser >/dev/null 2>&1 || true
sleep 2
rm -rf "$PROFILE"

OZONE_ARGS=()
if [[ -n "${WAYLAND_DISPLAY:-}" && -S "${XDG_RUNTIME_DIR}/${WAYLAND_DISPLAY}" ]]; then
  OZONE_ARGS+=(--ozone-platform=wayland)
fi

BOOT_URL="${URL}?fresh=$(date +%s)"
echo "Launching 1838 Estate kiosk: $BOOT_URL" >"$LOG"
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
  --enable-features=OverlayScrollbar \
  "${OZONE_ARGS[@]}" >>"$LOG" 2>&1 &
CHROMIUM_PID=$!

# One refresh after the page scripts have had time to initialize catches a rare
# first-frame Wayland/Chromium blank render without creating duplicate browsers.
(
  sleep 10
  if kill -0 "$CHROMIUM_PID" 2>/dev/null && command -v wtype >/dev/null 2>&1 && [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
    wtype -M ctrl -M shift -k r -m shift -m ctrl >/dev/null 2>&1 || wtype -k F5 >/dev/null 2>&1 || true
  fi
) &

wait "$CHROMIUM_PID"
