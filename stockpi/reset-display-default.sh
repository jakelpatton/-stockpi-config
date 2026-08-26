#!/bin/bash
set -u

AUTOSTART="$HOME/.config/labwc/autostart"

# Remove any Farm-specific display scaling override previously added to labwc.
if [ -f "$AUTOSTART" ]; then
  sed -i '/# Farm display scaling/d' "$AUTOSTART"
  sed -i '/wlr-randr --output HDMI-A-1/d' "$AUTOSTART"
fi

# Restore the connected TV to its preferred/native 1080p mode and normal scale
# for the current graphical session when wlr-randr is available.
if command -v wlr-randr >/dev/null 2>&1; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
  if [ -d "$XDG_RUNTIME_DIR" ]; then
    WAYLAND_SOCKET="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' 2>/dev/null | head -n1 || true)"
    if [ -n "$WAYLAND_SOCKET" ]; then
      export WAYLAND_DISPLAY="$(basename "$WAYLAND_SOCKET")"
      wlr-randr --output HDMI-A-1 --mode 1920x1080@60Hz --scale 1.0 || true
    fi
  fi
fi

echo "Farm display scaling overrides removed."
echo "Preferred target: HDMI-A-1 1920x1080 @ 60 Hz, scale 1.0."
echo "Reboot to ensure the desktop starts with the TV's default/native settings."
