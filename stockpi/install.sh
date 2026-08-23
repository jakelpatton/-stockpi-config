#!/bin/bash
set -e
APPDIR="$HOME/stockpi"
sudo apt update
sudo apt install -y python3-venv avahi-daemon chromium unclutter cec-utils
sudo hostnamectl set-hostname stockpi
sudo systemctl enable --now avahi-daemon
mkdir -p "$APPDIR"
cp -r ./* "$APPDIR/"
python3 -m venv "$APPDIR/venv"
"$APPDIR/venv/bin/pip" install --upgrade pip
"$APPDIR/venv/bin/pip" install -r "$APPDIR/requirements.txt"

sudo tee /etc/systemd/system/stockpi.service >/dev/null <<EOF
[Unit]
Description=StockPi Dashboard
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
sudo systemctl enable --now stockpi.service

mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/stockpi-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=StockPi Kiosk
Exec=sh -c 'sleep 10; chromium --kiosk --noerrdialogs --disable-infobars http://localhost:8080'
X-GNOME-Autostart-enabled=true
EOF

echo "Dashboard: http://stockpi.local:8080"
echo "Settings:  http://stockpi.local:8080/settings"
echo "Reboot once to start kiosk mode."
