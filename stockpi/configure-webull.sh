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

read -r -s -p "Webull App Key: " WEBULL_APP_KEY
echo
read -r -s -p "Webull App Secret: " WEBULL_APP_SECRET
echo
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
