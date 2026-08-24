#!/bin/bash
set -e
cd "$(dirname "$0")"
python3 -m venv venv
./venv/bin/python -m pip install --upgrade pip >/dev/null
./venv/bin/python -m pip install -r requirements.txt >/dev/null
echo ""
echo "Patton Estate control panel"
echo "Open: http://localhost:8090"
echo "If farmpi is online, Farm data/cameras will be proxied automatically."
exec ./venv/bin/python app.py
