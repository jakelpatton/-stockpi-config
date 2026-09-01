#!/bin/bash
set -Eeuo pipefail

if [[ "$EUID" -eq 0 && -z "${SUDO_USER:-}" ]]; then
  echo "Run this as the normal Raspberry Pi user, not from a root shell."
  exit 1
fi

TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo 'Unknown Raspberry Pi')"
ARCH="$(uname -m)"
STAGE="$TARGET_HOME/.farmpi-pi5-installer"

cat <<EOF
FarmPi Raspberry Pi 5 bootstrap
Hardware: $MODEL
Architecture: $ARCH
User: $TARGET_USER
EOF

if [[ "$MODEL" != *"Raspberry Pi 5"* ]]; then
  echo "Warning: this bootstrap was prepared for a Raspberry Pi 5, but it can still install on another Raspberry Pi."
fi
if [[ "$ARCH" != "aarch64" ]]; then
  echo "Warning: Raspberry Pi OS 64-bit is strongly recommended for the Pi 5 dashboard."
fi

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  echo "OS: ${PRETTY_NAME:-unknown}"
fi

echo ""
echo "Use Raspberry Pi OS 64-bit WITH DESKTOP. The kiosk requires a graphical labwc/Wayland session."
echo ""

sudo apt update
sudo apt install -y git curl

rm -rf "$STAGE"
git clone --quiet --depth 1 https://github.com/jakelpatton/-stockpi-config.git "$STAGE"
cd "$STAGE/stockpi"

# Keep a staging Pi 5 from colliding with an older FarmPi that may still be online.
# Override this when the old Pi is powered off if you want to retain farmpi.local:
#   FARMPI_HOSTNAME=farmpi bash install-pi5.sh
export FARMPI_HOSTNAME="${FARMPI_HOSTNAME:-farmpi5}"

bash ./install.sh

echo ""
echo "Pi 5 bootstrap complete."
echo "This Pi is currently named: $FARMPI_HOSTNAME"
echo "After reboot the local display should enter the supervised kiosk automatically."
echo "If this Pi is replacing the old unit permanently, you may keep farmpi5.local or reinstall/rename it to farmpi after the old unit is offline."
