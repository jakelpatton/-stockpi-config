#!/bin/bash
set -Eeuo pipefail

APPDIR="${APPDIR:-$HOME/farmpi}"
AUTOSTART="$HOME/.config/labwc/autostart"

mkdir -p "$HOME/.config/labwc"
touch "$AUTOSTART"

# Remove both legacy one-shot FarmPi launchers and prior supervisor entries while
# leaving unrelated labwc startup commands untouched.
sed -i \
  -e '\#1838 Estate kiosk supervisor#d' \
  -e '\#Farm dashboard kiosk#d' \
  -e '\#farmpi/start-kiosk.sh#d' \
  -e '\#farmpi/kiosk-supervisor.sh#d' \
  "$AUTOSTART"

if command -v lwrespawn >/dev/null 2>&1; then
  printf '\n# 1838 Estate kiosk supervisor\n%s /bin/bash %s/kiosk-supervisor.sh &\n' \
    "$(command -v lwrespawn)" "$APPDIR" >>"$AUTOSTART"
else
  printf '\n# 1838 Estate kiosk supervisor\n/bin/bash %s/kiosk-supervisor.sh &\n' \
    "$APPDIR" >>"$AUTOSTART"
fi
