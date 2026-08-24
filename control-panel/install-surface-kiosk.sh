#!/bin/bash
set -e
URL="${1:-http://farmpi.local:8090}"

echo "Installing Surface touch-kiosk launcher for: $URL"
sudo apt update
sudo apt install -y curl fonts-urw-base35

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  if command -v snap >/dev/null 2>&1; then
    sudo snap install chromium
  else
    sudo apt install -y chromium-browser
  fi
fi

CHROMIUM="$(command -v chromium || command -v chromium-browser || true)"
if [ -z "$CHROMIUM" ]; then
  echo "Chromium installation failed. Install Chromium, then rerun this script."
  exit 1
fi

mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/patton-estate-control.desktop" <<EOF2
[Desktop Entry]
Type=Application
Name=Patton Estate Control
Exec=$CHROMIUM --kiosk --app=$URL --noerrdialogs --disable-session-crashed-bubble --disable-infobars --no-first-run --overscroll-history-navigation=0
X-GNOME-Autostart-enabled=true
Terminal=false
EOF2

gsettings set org.gnome.desktop.session idle-delay 300 2>/dev/null || true
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing' 2>/dev/null || true

echo ""
echo "Surface kiosk configured."
echo "URL: $URL"
echo "Log out/in or reboot to launch it automatically."
echo "For appliance-like startup, enable Automatic Login in Ubuntu Settings > System > Users."
echo "Press Alt+F4 to exit kiosk during setup."
