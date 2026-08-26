#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVFILE="$APPDIR/webull.env"
TOKEN_DIR="$APPDIR/.webull-token"

if [ ! -x "$APPDIR/venv/bin/python" ]; then
  echo "Farm dashboard virtual environment not found at $APPDIR/venv"
  echo "Install/start the Farm dashboard first, then run this setup again."
  exit 1
fi

mkdir -p "$APPDIR" "$TOKEN_DIR"
chmod 700 "$TOKEN_DIR"

# Always copy the current read-only integration code before testing.
install -m 644 "$SOURCE_DIR/webull_readonly.py" "$APPDIR/webull_readonly.py"
install -m 700 "$SOURCE_DIR/webull_setup.py" "$APPDIR/webull_setup.py"

printf '\nWebull OpenAPI credentials are stored only on this Raspberry Pi.\n'
printf 'They will be written to %s with mode 600.\n\n' "$ENVFILE"

is_repeated_value() {
  local value="$1" len part n repeated i
  len=${#value}
  for n in 2 3 4; do
    if (( len > 0 && len % n == 0 )); then
      part="${value:0:len/n}"
      repeated=""
      for ((i=0; i<n; i++)); do repeated+="$part"; done
      if [ "$value" = "$repeated" ]; then
        echo "$n"
        return 0
      fi
    fi
  done
  return 1
}

while true; do
  read -r -s -p "Webull App Key (paste once): " WEBULL_APP_KEY
  echo
  WEBULL_APP_KEY="${WEBULL_APP_KEY//$'\r'/}"
  if [ -z "$WEBULL_APP_KEY" ]; then
    echo "App Key cannot be blank."
    continue
  fi
  if [[ "$WEBULL_APP_KEY" =~ [[:space:]] ]]; then
    echo "App Key contains whitespace. Copy only the key value from Webull."
    continue
  fi
  if repeats="$(is_repeated_value "$WEBULL_APP_KEY")"; then
    echo "The App Key appears to have been pasted $repeats times consecutively."
    echo "Please paste the Webull App Key exactly once."
    continue
  fi
  echo "Captured App Key length: ${#WEBULL_APP_KEY} characters (value hidden)."
  break
done

while true; do
  read -r -s -p "Webull App Secret (paste once): " WEBULL_APP_SECRET
  echo
  WEBULL_APP_SECRET="${WEBULL_APP_SECRET//$'\r'/}"
  if [ -z "$WEBULL_APP_SECRET" ]; then
    echo "App Secret cannot be blank."
    continue
  fi
  if [[ "$WEBULL_APP_SECRET" =~ [[:space:]] ]]; then
    echo "App Secret contains whitespace. Copy only the secret value from Webull."
    continue
  fi
  if repeats="$(is_repeated_value "$WEBULL_APP_SECRET")"; then
    echo "The App Secret appears to have been pasted $repeats times consecutively."
    echo "Please paste the Webull App Secret exactly once."
    continue
  fi
  echo "Captured App Secret length: ${#WEBULL_APP_SECRET} characters (value hidden)."
  break
done

read -r -p "Environment [prod/sandbox] (default prod): " WEBULL_ENVIRONMENT
WEBULL_ENVIRONMENT="${WEBULL_ENVIRONMENT:-prod}"

if [ "$WEBULL_ENVIRONMENT" != "prod" ] && [ "$WEBULL_ENVIRONMENT" != "sandbox" ]; then
  echo "Environment must be prod or sandbox."
  exit 1
fi

umask 077
cat > "$ENVFILE" <<EOF
# Local Webull OpenAPI settings. NEVER commit this file.
WEBULL_APP_KEY=$WEBULL_APP_KEY
WEBULL_APP_SECRET=$WEBULL_APP_SECRET
WEBULL_ENVIRONMENT=$WEBULL_ENVIRONMENT
WEBULL_REGION_ID=us
WEBULL_ACCOUNT_ID=
WEBULL_USE_MARKET_DATA=true
WEBULL_OPENAPI_TOKEN_DIR=$TOKEN_DIR
EOF
chmod 600 "$ENVFILE"
unset WEBULL_APP_KEY WEBULL_APP_SECRET

printf '\nInstalling/updating the official Webull Python SDK...\n'
"$APPDIR/venv/bin/pip" install --upgrade webull-openapi-python-sdk

printf '\nStarting Webull verification.\n'
printf 'If your account uses OpenAPI 2FA, approve the request in the Webull mobile app.\n'
printf 'If no prompt appears: Menu -> Messages -> OpenAPI Notifications.\n\n'
WEBULL_ENV_FILE="$ENVFILE" "$APPDIR/venv/bin/python" "$APPDIR/webull_setup.py" --env "$ENVFILE"

sudo systemctl restart farm-dashboard

echo
echo "Webull setup complete."
echo "Dashboard API status: http://farmpi.local:8080/api/webull/summary"
echo "Credentials remain local in $ENVFILE"
