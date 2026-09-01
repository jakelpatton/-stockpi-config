#!/bin/bash
set -Eeuo pipefail

OUT="${HOME}/farmpi-cloudflare-handoff.tgz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

if ! command -v cloudflared >/dev/null 2>&1 && ! systemctl cat cloudflared.service >/dev/null 2>&1; then
  echo "No cloudflared installation/service was found on this Pi."
  exit 2
fi

sudo -v

SERVICE_TEXT="$WORK/service.txt"
EXEC_TEXT="$WORK/exec.txt"
ENV_TEXT="$WORK/env.txt"
sudo systemctl cat cloudflared.service >"$SERVICE_TEXT" 2>/dev/null || true
sudo systemctl show cloudflared.service -p ExecStart --value >"$EXEC_TEXT" 2>/dev/null || true
sudo systemctl show cloudflared.service -p Environment --value >"$ENV_TEXT" 2>/dev/null || true
chmod 600 "$SERVICE_TEXT" "$EXEC_TEXT" "$ENV_TEXT"

find_config() {
  local candidate parsed
  parsed="$(python3 - "$EXEC_TEXT" <<'PY' 2>/dev/null || true
import pathlib, re, sys
s = pathlib.Path(sys.argv[1]).read_text(errors='ignore')
m = re.search(r'--config(?:=|\s+)([^\s;"}]+)', s)
print(m.group(1) if m else '')
PY
)"
  for candidate in "$parsed" /etc/cloudflared/config.yml /etc/cloudflared/config.yaml "$HOME/.cloudflared/config.yml" "$HOME/.cloudflared/config.yaml" /root/.cloudflared/config.yml /root/.cloudflared/config.yaml; do
    [[ -n "$candidate" ]] || continue
    if sudo test -f "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

CONFIG="$(find_config || true)"
MODE=""
PUBLIC_HOSTNAMES=""

if [[ -n "$CONFIG" ]]; then
  MODE="local"
  sudo cat "$CONFIG" >"$WORK/config.yml"
  chmod 600 "$WORK/config.yml"

  CRED="$(sudo awk -F: '/^[[:space:]]*credentials-file[[:space:]]*:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/["'"'"']/, ""); print; exit}' "$CONFIG" 2>/dev/null || true)"
  if [[ -n "$CRED" && "$CRED" != /* ]]; then
    CRED="$(dirname "$CONFIG")/$CRED"
  fi
  if [[ -n "$CRED" ]] && sudo test -f "$CRED"; then
    sudo cat "$CRED" >"$WORK/tunnel-credentials.json"
    chmod 600 "$WORK/tunnel-credentials.json"
    sed -i -E 's#^([[:space:]]*credentials-file[[:space:]]*:[[:space:]]*).*$#\1/etc/cloudflared/tunnel-credentials.json#' "$WORK/config.yml"
  else
    echo "A locally-managed tunnel config was found, but its tunnel credentials file could not be located."
    echo "Config: $CONFIG"
    exit 3
  fi

  OLD_HOST="$(hostname)"
  OLD_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  python3 - "$WORK/config.yml" "$OLD_HOST" "$OLD_IP" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1]); old_host = sys.argv[2]; old_ip = sys.argv[3]
text = p.read_text()
lines = []
for line in text.splitlines():
    if re.match(r'^\s*service\s*:', line) and ':8080' in line:
        targets = ('localhost', '127.0.0.1', 'farmpi.local', old_host, old_host + '.local', old_ip)
        if any(t and t in line for t in targets):
            indent = line[:len(line) - len(line.lstrip())]
            line = indent + 'service: http://127.0.0.1:8080'
    lines.append(line)
p.write_text('\n'.join(lines) + '\n')
PY

  PUBLIC_HOSTNAMES="$(awk -F: '/^[[:space:]]*hostname[[:space:]]*:/ {sub(/^[^:]*:[[:space:]]*/, ""); gsub(/["'"'"']/, ""); print}' "$WORK/config.yml" | paste -sd, - || true)"
else
  MODE="token"
  TOKEN="$(python3 - "$EXEC_TEXT" "$SERVICE_TEXT" "$ENV_TEXT" <<'PY' 2>/dev/null || true
import pathlib, re, sys
s = '\n'.join(pathlib.Path(x).read_text(errors='ignore') for x in sys.argv[1:])
patterns = [
    r'--token(?:=|\s+)([^\s;"}]+)',
    r'TUNNEL_TOKEN=([^\s";]+)',
]
for pat in patterns:
    m = re.search(pat, s)
    if m:
        print(m.group(1)); break
PY
)"
  TOKEN_FILE="$(python3 - "$EXEC_TEXT" "$SERVICE_TEXT" "$ENV_TEXT" <<'PY' 2>/dev/null || true
import pathlib, re, sys
s = '\n'.join(pathlib.Path(x).read_text(errors='ignore') for x in sys.argv[1:])
m = re.search(r'--token-file(?:=|\s+)([^\s;"}]+)', s)
print(m.group(1) if m else '')
PY
)"
  if [[ -n "$TOKEN_FILE" ]] && sudo test -f "$TOKEN_FILE"; then
    sudo cat "$TOKEN_FILE" >"$WORK/tunnel-token"
  elif [[ -n "$TOKEN" ]]; then
    printf '%s' "$TOKEN" >"$WORK/tunnel-token"
  else
    echo "cloudflared is present, but neither a local config nor a remotely-managed tunnel token could be discovered."
    echo "The tunnel may be running through Docker or a custom service and will need a one-time manual inspection."
    exit 4
  fi
  chmod 600 "$WORK/tunnel-token"
fi

cat >"$WORK/metadata" <<EOF
MODE=$MODE
SOURCE_HOSTNAME=$(hostname)
PUBLIC_HOSTNAMES=$PUBLIC_HOSTNAMES
EOF
chmod 600 "$WORK/metadata"

rm -f "$OUT"
tar -C "$WORK" -czf "$OUT" .
chmod 600 "$OUT"

echo "Cloudflare tunnel handoff prepared successfully."
echo "Archive: $OUT"
echo "Mode: $MODE"
if [[ -n "$PUBLIC_HOSTNAMES" ]]; then
  echo "Published hostnames: $PUBLIC_HOSTNAMES"
fi
echo "The archive contains tunnel credentials and is intentionally mode 600. Delete it after the Pi 5 cutover."
