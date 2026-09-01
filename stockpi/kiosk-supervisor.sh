#!/bin/bash
set -u

APPDIR="${APPDIR:-$HOME/farmpi}"
LAUNCHER="$APPDIR/start-kiosk.sh"
DASHBOARD_URL="http://127.0.0.1:8080/"
REFRESH_TRIGGER="/tmp/1838-estate-kiosk-refresh"
LOCK="/tmp/1838-estate-kiosk-supervisor.lock"
LOG="/tmp/1838-estate-kiosk-supervisor.log"
CHECK_SECONDS=5

exec 9>"$LOCK"
flock -n 9 || exit 0

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"
}

wayland_socket() {
  local runtime="/run/user/$(id -u)"
  find "$runtime" -maxdepth 1 -type s -name 'wayland-*' -print -quit 2>/dev/null || true
}

hdmi_state() {
  local found=0 f
  for f in /sys/class/drm/card*-HDMI-A-*/status; do
    [[ -e "$f" ]] || continue
    found=1
    printf '%s:%s\n' "$(basename "$(dirname "$f")")" "$(cat "$f" 2>/dev/null || echo unknown)"
  done
  [[ "$found" -eq 1 ]] || printf 'no-hdmi-status\n'
}

wake_time() {
  python3 - "$APPDIR/power_schedule.json" <<'PY' 2>/dev/null || printf '07:15\n'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
try:
    data = json.loads(p.read_text())
except Exception:
    data = {}
print(str(data.get("wake_time") or "07:15"))
PY
}

kill_kiosk_browser() {
  pkill -u "$(id -u)" chromium >/dev/null 2>&1 || true
  pkill -u "$(id -u)" chromium-browser >/dev/null 2>&1 || true
}

log "Kiosk supervisor started."
last_hdmi="$(hdmi_state)"
last_wake_date=""
dashboard_was_down=0

while true; do
  socket="$(wayland_socket)"
  if [[ -z "$socket" ]]; then
    sleep 2
    continue
  fi

  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  export WAYLAND_DISPLAY="$(basename "$socket")"

  if [[ ! -f "$LAUNCHER" ]]; then
    log "Launcher missing at $LAUNCHER; retrying."
    sleep 5
    continue
  fi

  # A fresh launch already satisfies any refresh request left from a deployment.
  rm -f "$REFRESH_TRIGGER"
  log "Launching kiosk on $WAYLAND_DISPLAY."
  bash "$LAUNCHER" &
  launcher_pid=$!

  while kill -0 "$launcher_pid" 2>/dev/null; do
    reason=""

    # Auto-deploy and manual recovery can request a browser rebuild without
    # needing to know which Wayland socket the desktop currently uses.
    if [[ -e "$REFRESH_TRIGGER" ]]; then
      rm -f "$REFRESH_TRIGGER"
      reason="external refresh request"
    fi

    # If the TV/monitor disappears and comes back on HDMI, rebuild Chromium.
    # Some TVs keep HDMI electrically connected in standby, so the scheduled
    # wake check below is retained as a second recovery path.
    current_hdmi="$(hdmi_state)"
    if [[ "$current_hdmi" != "$last_hdmi" ]]; then
      if printf '%s\n' "$current_hdmi" | grep -q ':connected'; then
        reason="HDMI reconnect"
      fi
      last_hdmi="$current_hdmi"
    fi

    # The dashboard already wakes the TV by CEC. Relaunch Chromium once during
    # that configured wake minute so a compositor/TV handshake cannot leave a
    # stale or invisible browser from the night before.
    today="$(date +%F)"
    hhmm="$(date +%H:%M)"
    configured_wake="$(wake_time)"
    if [[ "$hhmm" == "$configured_wake" && "$last_wake_date" != "$today" ]]; then
      last_wake_date="$today"
      sleep 8
      reason="scheduled TV wake"
    fi

    # If Flask temporarily disappears, wait for it to recover and then rebuild
    # the page instead of leaving Chromium parked on an error page indefinitely.
    if curl -fsS --max-time 2 "$DASHBOARD_URL" >/dev/null 2>&1; then
      if [[ "$dashboard_was_down" -eq 1 ]]; then
        dashboard_was_down=0
        reason="dashboard recovered"
      fi
    else
      dashboard_was_down=1
    fi

    if [[ -n "$reason" ]]; then
      log "Restarting kiosk: $reason."
      kill_kiosk_browser
      break
    fi

    # If the compositor itself is replaced, restart after its new socket appears.
    if [[ ! -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
      log "Wayland socket disappeared; restarting when the desktop returns."
      kill_kiosk_browser
      break
    fi

    sleep "$CHECK_SECONDS"
  done

  wait "$launcher_pid" 2>/dev/null || true
  log "Kiosk launcher exited; retrying."
  sleep 2
done
