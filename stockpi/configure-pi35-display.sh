#!/bin/bash
set -Eeuo pipefail

ACTION="${1:-enable}"
ROTATE="${FARMPI_PI35_ROTATE:-270}"
SPEED="${FARMPI_PI35_SPEED:-18000000}"
BEGIN_MARKER="# BEGIN FARMPI 3.5 SPI DISPLAY"
END_MARKER="# END FARMPI 3.5 SPI DISPLAY"
BACKUP_DIR="/var/backups/farmpi-display"

CONFIG=""
for candidate in /boot/firmware/config.txt /boot/config.txt; do
  if [[ -f "$candidate" ]]; then
    CONFIG="$candidate"
    break
  fi
done
if [[ -z "$CONFIG" ]]; then
  echo "Unable to find Raspberry Pi boot config.txt."
  exit 1
fi

BOOT_DIR="$(dirname "$CONFIG")"
OVERLAY_DIR="$BOOT_DIR/overlays"
if [[ ! -d "$OVERLAY_DIR" && -d /boot/overlays ]]; then
  OVERLAY_DIR="/boot/overlays"
fi
PISCREEN_DTBO="$OVERLAY_DIR/piscreen.dtbo"
MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo 'Unknown Raspberry Pi')"

remove_managed_block() {
  awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    $0 == begin { skip=1; next }
    $0 == end   { skip=0; next }
    !skip { print }
  ' "$1"
}

backup_config() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  sudo mkdir -p "$BACKUP_DIR"
  sudo cp -a "$CONFIG" "$BACKUP_DIR/config.txt.$stamp"
  echo "Boot config backup: $BACKUP_DIR/config.txt.$stamp"
}

case "$ACTION" in
  enable)
    case "$ROTATE" in
      0|90|180|270) ;;
      *) echo "FARMPI_PI35_ROTATE must be 0, 90, 180, or 270."; exit 2 ;;
    esac
    if [[ ! "$SPEED" =~ ^[0-9]+$ ]] || (( SPEED < 1000000 || SPEED > 32000000 )); then
      echo "FARMPI_PI35_SPEED must be an integer from 1000000 through 32000000."
      exit 2
    fi
    if [[ ! -f "$PISCREEN_DTBO" ]]; then
      echo "The Raspberry Pi OS piscreen overlay was not found at: $PISCREEN_DTBO"
      echo "Update Raspberry Pi OS before enabling the 3.5-inch display."
      exit 1
    fi

    echo "Configuring FarmPi 3.5-inch SPI display on: $MODEL"
    echo "Boot config: $CONFIG"
    echo "Driver: Raspberry Pi OS piscreen DRM/KMS (ILI9486 + XPT2046/ADS7846)"
    echo "SPI speed: $SPEED   rotation: $ROTATE"

    WORK="$(mktemp)"
    trap 'rm -f "${WORK:-}" "${NEW_CONFIG:-}"' EXIT
    remove_managed_block "$CONFIG" > "$WORK"

    # Prevent a manually-added/legacy piscreen line from instantiating the panel
    # twice. Preserve it as a comment so the original setting is still visible.
    sed -E 's@^[[:space:]]*dtoverlay=piscreen(,.*)?$@# FarmPi superseded duplicate: &@' "$WORK" > "$WORK.cleaned"
    mv "$WORK.cleaned" "$WORK"

    NEW_CONFIG="$(mktemp)"
    cat "$WORK" > "$NEW_CONFIG"
    if [[ -s "$NEW_CONFIG" ]] && [[ "$(tail -c1 "$NEW_CONFIG" 2>/dev/null || true)" != "" ]]; then
      echo >> "$NEW_CONFIG"
    fi
    cat >> "$NEW_CONFIG" <<EOF2

$BEGIN_MARKER
# MPI3501/Waveshare-style 480x320 LCD: ILI9486 display + XPT2046 touch.
# Uses the in-kernel DRM/KMS driver so labwc/Wayland and HDMI remain enabled.
[all]
dtparam=spi=on
dtoverlay=piscreen,speed=$SPEED,rotate=$ROTATE,drm
$END_MARKER
EOF2

    if cmp -s "$CONFIG" "$NEW_CONFIG"; then
      echo "3.5-inch display configuration is already current."
    else
      backup_config
      sudo install -m 0644 "$NEW_CONFIG" "$CONFIG"
      echo "3.5-inch display configuration written."
    fi

    if grep -Eq '^[[:space:]]*dtoverlay=vc4-kms-v3d' "$CONFIG"; then
      echo "HDMI KMS configuration preserved."
    else
      echo "Note: no active vc4-kms-v3d line was found; FarmPi did not disable or modify HDMI KMS."
    fi
    echo "Reboot is required before the SPI LCD and touch controller appear."
    ;;

  disable)
    WORK="$(mktemp)"
    trap 'rm -f "${WORK:-}"' EXIT
    remove_managed_block "$CONFIG" > "$WORK"
    if cmp -s "$CONFIG" "$WORK"; then
      echo "FarmPi 3.5-inch display block is not present."
    else
      backup_config
      sudo install -m 0644 "$WORK" "$CONFIG"
      echo "FarmPi 3.5-inch display block removed. Reboot required."
    fi
    ;;

  status)
    echo "Hardware: $MODEL"
    echo "Boot config: $CONFIG"
    echo "PiScreen overlay: $PISCREEN_DTBO"
    if grep -Fq "$BEGIN_MARKER" "$CONFIG"; then
      echo "FarmPi 3.5-inch display: ENABLED in boot config"
      awk -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
        $0 == begin { show=1 }
        show { print }
        $0 == end { show=0 }
      ' "$CONFIG"
    else
      echo "FarmPi 3.5-inch display: not enabled by FarmPi"
    fi
    echo ""
    echo "After reboot, useful checks:"
    echo "  ls -l /dev/dri/"
    echo "  grep -Ei 'ADS7846|XPT2046|PiScreen|ILI9486' /proc/bus/input/devices"
    ;;

  *)
    echo "Usage: $0 {enable|disable|status}"
    exit 2
    ;;
esac
