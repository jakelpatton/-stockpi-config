#!/bin/bash
set -Eeuo pipefail

SOURCE="${1:-jpatton@farmpi.local}"
APPDIR="${HOME}/farmpi"
REMOTE_ARCHIVE="farmpi-cloudflare-handoff.tgz"
LOCAL_ARCHIVE="$(mktemp)"
WORK="$(mktemp -d)"
trap 'rm -f "$LOCAL_ARCHIVE"; rm -rf "$WORK"' EXIT

if [[ ! -d "$APPDIR" ]]; then
  echo "FarmPi is not installed at $APPDIR. Run install-pi5.sh first."
  exit 1
fi

MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo 'Unknown Raspberry Pi')"
if [[ "$MODEL" != *"Raspberry Pi 5"* ]]; then
  echo "Warning: this promotion script is intended for the Raspberry Pi 5. Detected: $MODEL"
fi

if ! curl -fsS --max-time 5 http://127.0.0.1:8080/api/health >/dev/null 2>&1 && \
   ! curl -fsS --max-time 5 http://127.0.0.1:8080/ >/dev/null 2>&1; then
  echo "The Pi 5 dashboard is not healthy on 127.0.0.1:8080. Refusing to move the public tunnel."
  exit 2
fi

echo "Pi 5 dashboard is healthy."
echo "Preparing Cloudflare tunnel handoff on $SOURCE ..."
echo "You may be prompted for the old Pi SSH/sudo password."

ssh -t "$SOURCE" \
  "curl -fsSL https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/stockpi/prepare-cloudflare-handoff.sh -o /tmp/prepare-cloudflare-handoff.sh && bash /tmp/prepare-cloudflare-handoff.sh"

scp "$SOURCE:$REMOTE_ARCHIVE" "$LOCAL_ARCHIVE"
chmod 600 "$LOCAL_ARCHIVE"
tar -C "$WORK" -xzf "$LOCAL_ARCHIVE"

MODE="$(awk -F= '$1=="MODE" {print substr($0,index($0,"=")+1); exit}' "$WORK/metadata")"
PUBLIC_HOSTNAMES="$(awk -F= '$1=="PUBLIC_HOSTNAMES" {print substr($0,index($0,"=")+1); exit}' "$WORK/metadata")"

if [[ "$MODE" != "local" && "$MODE" != "token" ]]; then
  echo "Unsupported tunnel handoff mode: $MODE"
  exit 3
fi

echo "Installing current cloudflared package on the Pi 5..."
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | \
  sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
sudo apt-get update -qq
sudo apt-get install -y cloudflared

# A fresh Pi should not have a tunnel service yet, but make re-running the cutover safe.
if systemctl cat cloudflared.service >/dev/null 2>&1; then
  sudo systemctl disable --now cloudflared.service >/dev/null 2>&1 || true
  sudo cloudflared service uninstall >/dev/null 2>&1 || true
  sudo rm -f /etc/systemd/system/cloudflared.service
  sudo systemctl daemon-reload
fi
sudo install -d -m 0755 /etc/cloudflared

if [[ "$MODE" == "local" ]]; then
  sudo install -m 0600 "$WORK/config.yml" /etc/cloudflared/config.yml
  sudo install -m 0600 "$WORK/tunnel-credentials.json" /etc/cloudflared/tunnel-credentials.json
  sudo cloudflared --config /etc/cloudflared/config.yml service install
else
  sudo install -m 0600 "$WORK/tunnel-token" /etc/cloudflared/tunnel-token
  CLOUDFLARED_BIN="$(command -v cloudflared)"
  sudo tee /etc/systemd/system/cloudflared.service >/dev/null <<EOF
[Unit]
Description=Cloudflare Tunnel - FarmPi Primary
After=network-online.target farm-dashboard.service
Wants=network-online.target

[Service]
Type=notify
ExecStart=$CLOUDFLARED_BIN --no-autoupdate tunnel run --token-file /etc/cloudflared/tunnel-token
Restart=on-failure
RestartSec=5s
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable cloudflared.service >/dev/null
fi

sudo systemctl restart cloudflared.service

echo "Waiting for the Pi 5 tunnel connector to register with Cloudflare..."
REGISTERED=0
for _ in $(seq 1 45); do
  if sudo journalctl -u cloudflared.service -n 120 --no-pager 2>/dev/null | grep -qi 'Registered tunnel connection'; then
    REGISTERED=1
    break
  fi
  if ! systemctl is-active --quiet cloudflared.service; then
    break
  fi
  sleep 1
done

if [[ "$REGISTERED" -ne 1 ]]; then
  echo "The new cloudflared service did not register a tunnel connection."
  sudo systemctl status cloudflared.service --no-pager -l || true
  echo "The old Pi tunnel has NOT been stopped."
  exit 4
fi

echo "Pi 5 has registered with the existing Cloudflare tunnel."

# When a locally-managed config exposes hostnames, record the current public
# response before removing the old connector. Access-protected 3xx/4xx responses
# still prove that Cloudflare is serving the hostname; 5xx is treated as unhealthy.
check_public_hostnames() {
  local stage="$1" host code failed=0
  [[ -n "$PUBLIC_HOSTNAMES" ]] || return 0
  IFS=',' read -ra hosts <<<"$PUBLIC_HOSTNAMES"
  for host in "${hosts[@]}"; do
    [[ -n "$host" ]] || continue
    code="$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time 15 "https://$host/" || echo 000)"
    echo "$stage public check: $host -> HTTP $code"
    if [[ "$code" == "000" || "$code" =~ ^5 ]]; then
      failed=1
    fi
  done
  return "$failed"
}

check_public_hostnames "Pre-cutover" || true

echo "Stopping the old Pi Cloudflare connector..."
ssh -t "$SOURCE" "sudo systemctl disable --now cloudflared.service"

sleep 8
if ! check_public_hostnames "Post-cutover"; then
  echo "Public hostname verification failed after stopping the old connector. Restoring it now."
  ssh -t "$SOURCE" "sudo systemctl enable --now cloudflared.service"
  exit 5
fi

if ! systemctl is-active --quiet cloudflared.service; then
  echo "Pi 5 cloudflared stopped unexpectedly. Restoring the old connector."
  ssh -t "$SOURCE" "sudo systemctl enable --now cloudflared.service"
  exit 6
fi

# The public tunnel is now on the Pi 5. Preserve the old machine as an explicitly
# secondary/fallback device and give the Pi 5 the legacy farmpi.local identity so
# local bookmarks/integrations continue to resolve to the primary machine.
echo "Public tunnel cutover succeeded. Renaming the old Pi to farmpi3 and this Pi 5 to farmpi."
ssh -t "$SOURCE" "rm -f ~/$REMOTE_ARCHIVE; sudo hostnamectl set-hostname farmpi3; if grep -q '^127\\.0\\.1\\.1' /etc/hosts; then sudo sed -i 's/^127\\.0\\.1\\.1.*/127.0.1.1    farmpi3/' /etc/hosts; fi; sudo systemctl restart avahi-daemon || true"

sudo hostnamectl set-hostname farmpi
if grep -q '^127\.0\.1\.1' /etc/hosts; then
  sudo sed -i 's/^127\.0\.1\.1.*/127.0.1.1    farmpi/' /etc/hosts
else
  echo '127.0.1.1    farmpi' | sudo tee -a /etc/hosts >/dev/null
fi
sudo systemctl restart avahi-daemon || true

rm -f "$LOCAL_ARCHIVE"
touch /tmp/1838-estate-kiosk-refresh

echo ""
echo "Pi 5 promotion complete."
echo "Primary local name: farmpi.local"
echo "Old Pi fallback name: farmpi3.local"
echo "Cloudflare tunnel service: running on this Pi 5"
echo "Old Pi cloudflared service: disabled"
echo ""
echo "A reboot of the Pi 5 is recommended after the hostname change: sudo reboot"
