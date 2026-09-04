#!/bin/bash
set -Eeuo pipefail

if [[ "$EUID" -eq 0 && -z "${SUDO_USER:-}" ]]; then
  echo "Run this installer as the normal Raspberry Pi desktop user, not from a root shell."
  exit 1
fi

TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
APPDIR="$TARGET_HOME/farmpi"
ENVFILE="$APPDIR/cameras.env"
HOSTNAME_TARGET="${FARMPI_HOSTNAME:-farmpi}"
MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo 'Raspberry Pi')"

if [[ -z "$TARGET_HOME" ]]; then
  echo "Unable to determine the home directory for $TARGET_USER."
  exit 1
fi

echo "Installing FarmPi for $TARGET_USER on: $MODEL"
echo "Application directory: $APPDIR"
echo "Hostname: $HOSTNAME_TARGET"

sudo apt update
sudo apt install -y python3-venv avahi-daemon chromium cec-utils wtype curl git rsync util-linux labwc

sudo hostnamectl set-hostname "$HOSTNAME_TARGET"
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sudo sed -i "s/^127\.0\.1\.1.*/127.0.1.1    $HOSTNAME_TARGET/" /etc/hosts
else
  echo "127.0.1.1    $HOSTNAME_TARGET" | sudo tee -a /etc/hosts >/dev/null
fi
sudo systemctl enable --now avahi-daemon

mkdir -p "$APPDIR"

# Install repository code without destroying machine-local settings if this
# installer is safely re-run later.
rsync -a \
  --exclude 'venv/' \
  --exclude 'cameras.env' \
  --exclude 'webull.env' \
  --exclude '.webull-token/' \
  --exclude 'conf/token.txt' \
  --exclude 'dashboard_config.json' \
  --exclude 'power_schedule.json' \
  --exclude 'stocks.json' \
  --exclude 'cloud_portfolio_cache.json' \
  --exclude 'webull-summary-cache.json' \
  --exclude 'quote-cache.json' \
  --exclude 'static/webull-activity.json' \
  --exclude 'backups/' \
  ./ "$APPDIR/"

chmod +x "$APPDIR/start-kiosk.sh" "$APPDIR/auto-deploy.sh" "$APPDIR/install-auto-deploy.sh" 2>/dev/null || true
chmod +x "$APPDIR/kiosk-supervisor.sh" "$APPDIR/configure-kiosk-autostart.sh" 2>/dev/null || true

if [[ ! -x "$APPDIR/venv/bin/python" ]]; then
  python3 -m venv "$APPDIR/venv"
fi
"$APPDIR/venv/bin/pip" install --upgrade pip
"$APPDIR/venv/bin/pip" install -r "$APPDIR/requirements.txt"

# Amcrest NVR local-LAN configuration. Password stays only on the Pi. On a fresh
# Pi 5 the prompt may be left blank and configured later without blocking install.
if [[ ! -f "$ENVFILE" ]]; then
  NVR_IP="192.168.1.4"
  NVR_USER="admin"
  NVR_PASSWORD=""
  echo ""
  echo "Amcrest NVR setup"
  echo "NVR: $NVR_IP   Channels: 1-4"
  if [[ -t 0 ]]; then
    read -r -s -p "Enter the Amcrest NVR password (or press Enter to configure later): " NVR_PASSWORD
    echo ""
  fi
  cat > "$ENVFILE" <<EOF
AMCREST_NVR_IP=$NVR_IP
AMCREST_NVR_USER=$NVR_USER
AMCREST_NVR_PASSWORD=$NVR_PASSWORD
EOF
  chmod 600 "$ENVFILE"
  unset NVR_PASSWORD
fi

DASHBOARD_RUNNER="$APPDIR/run_dashboard.py"
if [[ ! -f "$DASHBOARD_RUNNER" ]]; then
  DASHBOARD_RUNNER="$APPDIR/app.py"
fi

sudo tee /etc/systemd/system/farm-dashboard.service >/dev/null <<EOF
[Unit]
Description=Farm Dashboard Server
After=network-online.target
Wants=network-online.target

[Service]
User=$TARGET_USER
WorkingDirectory=$APPDIR
EnvironmentFile=-$ENVFILE
ExecStart=$APPDIR/venv/bin/python $DASHBOARD_RUNNER
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now farm-dashboard.service

# Install the kiosk supervisor as a persistent per-user systemd service. The
# helper also keeps a labwc autostart fallback; its lock prevents duplicates.
if [[ -f "$APPDIR/configure-kiosk-autostart.sh" ]]; then
  runuser -u "$TARGET_USER" -- env HOME="$TARGET_HOME" APPDIR="$APPDIR" \
    bash "$APPDIR/configure-kiosk-autostart.sh"
fi

# Make a dedicated dashboard Pi boot straight into the graphical desktop and do
# not let Raspberry Pi OS blank the output. These are the same settings available
# in raspi-config under Desktop Autologin and Screen Blanking.
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_boot_behaviour B4 || true
  sudo raspi-config nonint do_blanking 1 || true
fi

# Install the automatic GitHub deployment timer as part of a fresh installation.
# It now self-recovers a corrupted disposable Git checkout and asks the kiosk
# supervisor to rebuild Chromium after successful deployments.
if [[ -f "$APPDIR/install-auto-deploy.sh" ]]; then
  bash "$APPDIR/install-auto-deploy.sh"
fi

# If a desktop session is already active, bring up the supervised kiosk now.
RUNTIME="/run/user/$(id -u "$TARGET_USER")"
SOCKET="$(find "$RUNTIME" -maxdepth 1 -type s -name 'wayland-*' -print -quit 2>/dev/null || true)"
if [[ -n "$SOCKET" ]]; then
  runuser -u "$TARGET_USER" -- env \
    HOME="$TARGET_HOME" \
    XDG_RUNTIME_DIR="$RUNTIME" \
    WAYLAND_DISPLAY="$(basename "$SOCKET")" \
    bash -c "nohup bash '$APPDIR/kiosk-supervisor.sh' >>/tmp/1838-estate-kiosk-install.log 2>&1 </dev/null &" || true
fi

echo ""
echo "Farm dashboard installed for: $MODEL"
echo "Dashboard: http://$HOSTNAME_TARGET.local:8080"
echo "Settings:  http://$HOSTNAME_TARGET.local:8080/settings"
echo "Server:    systemctl status farm-dashboard.service --no-pager"
echo "Kiosk log: tail -100 /tmp/1838-estate-kiosk-supervisor.log"
echo "Deploy:    systemctl status farmpi-auto-deploy.timer --no-pager"
echo ""
echo "Reboot once after a fresh Raspberry Pi installation: sudo reboot"
