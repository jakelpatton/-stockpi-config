#!/bin/bash
set -e
APPDIR="$HOME/farmpi"
ENVFILE="$APPDIR/cameras.env"

sudo apt update
sudo apt install -y python3-venv avahi-daemon chromium cec-utils wtype
sudo hostnamectl set-hostname farmpi
sudo systemctl enable --now avahi-daemon
mkdir -p "$APPDIR"
cp -r ./* "$APPDIR/"
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

sudo tee /etc/systemd/system/farm-dashboard.service >/dev/null <<EOF
[Unit]
Description=Farm Dashboard Server
After=network-online.target
Wants=network-online.target
[Service]
User=$USER
WorkingDirectory=$APPDIR
EnvironmentFile=$ENVFILE
ExecStart=$APPDIR/venv/bin/python $APPDIR/app.py
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now farm-dashboard.service

# Current Raspberry Pi OS desktop uses labwc. Launch Chromium only after the graphical session is ready.
mkdir -p "$HOME/.config/labwc"
AUTOSTART="$HOME/.config/labwc/autostart"
touch "$AUTOSTART"
if ! grep -q "Farm dashboard kiosk" "$AUTOSTART"; then
cat >> "$AUTOSTART" <<'EOF'
# Farm dashboard kiosk
(sleep 10; chromium http://localhost:8080 --kiosk --noerrdialogs --disable-infobars --no-first-run --start-maximized --enable-features=OverlayScrollbar) &
EOF
fi

echo ""
echo "Farm dashboard installed."
echo "Dashboard: http://farmpi.local:8080"
echo "Settings:  http://farmpi.local:8080/settings"
echo "Amcrest:   192.168.1.4 channels 1-4 configured"
echo "For a dedicated display, enable Desktop Autologin and disable Screen Blanking in raspi-config, then reboot."
