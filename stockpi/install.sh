#!/bin/bash
set -e
APPDIR="$HOME/farmpi"
sudo apt update
sudo apt install -y python3-venv avahi-daemon chromium unclutter cec-utils
sudo hostnamectl set-hostname farmpi
sudo systemctl enable --now avahi-daemon
mkdir -p "$APPDIR"
cp -r ./* "$APPDIR/"
python3 -m venv "$APPDIR/venv"
"$APPDIR/venv/bin/pip" install --upgrade pip
"$APPDIR/venv/bin/pip" install -r "$APPDIR/requirements.txt"

sudo tee /etc/systemd/system/farmpi.service >/dev/null <<EOF
[Unit]
Description=FarmPi Dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$APPDIR
ExecStart=$APPDIR/venv/bin/python $APPDIR/app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now farmpi.service

mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/farmpi-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=FarmPi Kiosk
Exec=sh -c 'sleep 10; chromium --kiosk --noerrdialogs --disable-infobars http://localhost:8080'
X-GNOME-Autostart-enabled=true
EOF

echo "Dashboard: http://farmpi.local:8080"
echo "Settings:  http://farmpi.local:8080/settings"
echo "Reboot once to start kiosk mode."
