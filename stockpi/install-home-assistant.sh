#!/bin/bash
set -e

sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

mkdir -p "$HOME/homeassistant/config"
cd "$(dirname "$0")/home-assistant"

sudo docker compose up -d

echo ""
echo "Home Assistant is starting."
echo "Open: http://farmpi.local:8123"
echo "If that hostname does not resolve yet, use: http://<PI-IP>:8123"
echo "First startup can take several minutes."
echo ""
echo "After onboarding, we can connect Farm to Home Assistant using a long-lived access token stored only on the Pi."
