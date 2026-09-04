#!/bin/bash
set -Eeuo pipefail

APPDIR="${APPDIR:-$HOME/farmpi}"
AUTOSTART="$HOME/.config/labwc/autostart"
USER_UNIT_DIR="$HOME/.config/systemd/user"
USER_UNIT="$USER_UNIT_DIR/farmpi-kiosk.service"
WANTS_DIR="$USER_UNIT_DIR/default.target.wants"
UID_NUM="$(id -u)"
RUNTIME="/run/user/$UID_NUM"

mkdir -p "$HOME/.config/labwc" "$USER_UNIT_DIR" "$WANTS_DIR"
touch "$AUTOSTART"

# Remove legacy one-shot launchers and older supervisor entries while leaving
# unrelated labwc startup commands untouched.
sed -i \
  -e '\#1838 Estate kiosk supervisor#d' \
  -e '\#Farm dashboard kiosk#d' \
  -e '\#farmpi/start-kiosk.sh#d' \
  -e '\#farmpi/kiosk-supervisor.sh#d' \
  "$AUTOSTART"

# Primary startup path: a persistent user systemd service. The supervisor itself
# waits for the Wayland socket, so the service can safely start before labwc has
# finished creating wayland-0. Restart=always also recovers unexpected exits.
cat >"$USER_UNIT" <<EOF
[Unit]
Description=1838 Estate FarmPi Kiosk Supervisor
After=default.target

[Service]
Type=simple
Environment=APPDIR=$APPDIR
ExecStart=/bin/bash $APPDIR/kiosk-supervisor.sh
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

ln -sfn ../farmpi-kiosk.service "$WANTS_DIR/farmpi-kiosk.service"

# Secondary fallback: labwc also attempts to start the same supervisor. The
# supervisor's flock prevents duplicates, so this is safe and covers unusual
# desktop/user-manager startup failures.
printf '\n# 1838 Estate kiosk supervisor fallback\n/bin/bash %s/kiosk-supervisor.sh &\n' \
  "$APPDIR" >>"$AUTOSTART"

# If the user's systemd manager is currently reachable, activate the service now.
# Otherwise the enabled unit will start automatically at the next desktop login.
if [[ -S "$RUNTIME/bus" ]]; then
  export XDG_RUNTIME_DIR="$RUNTIME"
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME/bus"
  systemctl --user daemon-reload || true
  systemctl --user enable farmpi-kiosk.service >/dev/null 2>&1 || true
  systemctl --user restart farmpi-kiosk.service || true
fi
