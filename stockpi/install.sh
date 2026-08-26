#!/bin/bash
set -e
APPDIR="$HOME/farmpi"
ENVFILE="$APPDIR/cameras.env"

sudo apt update
sudo apt install -y python3-venv avahi-daemon chromium cec-utils wtype curl
sudo hostnamectl set-hostname farmpi

# Keep sudo/local hostname resolution clean after renaming the Pi.
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sudo sed -i 's/^127\.0\.1\.1.*/127.0.1.1    farmpi/' /etc/hosts
else
  echo '127.0.1.1    farmpi' | sudo tee -a /etc/hosts >/dev/null
fi

sudo systemctl enable --now avahi-daemon
mkdir -p "$APPDIR"
cp -r ./* "$APPDIR/"
chmod +x "$APPDIR/start-kiosk.sh"
python3 -m venv "$APPDIR/venv"
"$APPDIR/venv/bin/pip" install --upgrade pip
"$APPDIR/venv/bin/pip" install -r "$APPDIR/requirements.txt"

# Amcrest NVR local-LAN configuration. Password stays on the Pi and is never written to GitHub.
NVR_IP="192.168.1.4"
NVR_USER="admin"
echo ""
echo "Amcrest NVR setup"
echo "NVR: $NVR_IP   Channels: 1-4"
read -s -p "Enter the Amcrest NVR password: " NVR_PASSWORD
echo ""
cat > "$ENVFILE" <<EOF
AMCREST_NVR_IP=$NVR_IP
AMCREST_NVR_USER=$NVR_USER
AMCREST_NVR_PASSWORD=$NVR_PASSWORD
EOF
chmod 600 "$ENVFILE"
unset NVR_PASSWORD

# run_dashboard.py imports the Flask application and starts the HTTP server
# immediately. Slow Webull/market/news refreshes run in background workers, so
# port 8080 does not disappear for 20-30+ seconds on every restart.
DASHBOARD_RUNNER="$APPDIR/run_dashboard.py"
if [ ! -f "$DASHBOARD_RUNNER" ]; then
  DASHBOARD_RUNNER="$APPDIR/app.py"
fi

sudo tee /etc/systemd/system/farm-dashboard.service >/dev/null <<EOF
[Unit]
Description=Farm Dashboard Server
After=network-online.target
Wants=network-online.target
[Service]
User=$USER
WorkingDirectory=$APPDIR
EnvironmentFile=$ENVFILE
ExecStart=$APPDIR/venv/bin/python $DASHBOARD_RUNNER
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now farm-dashboard.service

# Current Raspberry Pi OS desktop uses labwc. The kiosk launcher waits until
# the Flask dashboard responds before opening Chromium, avoiding a blank page
# on slower boots. --password-store=basic prevents the desktop keyring prompt.
mkdir -p "$HOME/.config/labwc"
AUTOSTART="$HOME/.config/labwc/autostart"
touch "$AUTOSTART"
if grep -q "# Farm dashboard kiosk" "$AUTOSTART"; then
  sed -i '/# Farm dashboard kiosk/{n;s#.*#'$APPDIR'/start-kiosk.sh \&#;}' "$AUTOSTART"
else
cat >> "$AUTOSTART" <<EOF
# Farm dashboard kiosk
$APPDIR/start-kiosk.sh &
EOF
fi

echo ""
echo "Farm dashboard installed."
echo "Dashboard: http://farmpi.local:8080"
echo "Settings:  http://farmpi.local:8080/settings"
echo "Amcrest:   192.168.1.4 channels 1-4 configured"
echo "For a dedicated display, enable Desktop Autologin and disable Screen Blanking in raspi-config, then reboot."
