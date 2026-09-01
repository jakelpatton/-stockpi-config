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

# Stage under farmpi5 so the old Pi can stay online during validation. The final
# promotion script moves the existing Cloudflare tunnel to this Pi, renames the
# old Pi to farmpi3, and gives this Pi the legacy farmpi.local identity.
export FARMPI_HOSTNAME="${FARMPI_HOSTNAME:-farmpi5}"

bash ./install.sh

echo ""
echo "Pi 5 bootstrap complete."
echo "Staging name: $FARMPI_HOSTNAME.local"
echo "After reboot the local display should enter the supervised kiosk automatically."
echo ""
echo "PRIMARY CUTOVER (run only after the Pi 5 dashboard works locally):"
echo "  cd ~/farmpi"
echo "  bash migrate-from-existing-pi.sh jpatton@farmpi.local"
echo "  bash promote-pi5-primary.sh jpatton@farmpi.local"
echo ""
echo "The promotion step migrates the existing Cloudflare tunnel without committing credentials to GitHub,"
echo "verifies the Pi 5 connector before stopping the old connector, renames the old Pi to farmpi3,"
echo "and makes this Pi 5 the new farmpi.local primary."
