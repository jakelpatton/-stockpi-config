#!/bin/bash
set -euo pipefail

APPDIR="$HOME/farmpi"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

patch_file() {
  local target="$1"
  [ -f "$target" ] || return 0
  python3 - "$target" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()
orig = s

s = s.replace(
'''    def history_page_loop(self, trade, account_id: str, start_date: str, end_date: str) -> list[dict]:\n''',
'''    def history_page_loop(self, trade, account_id: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]:\n''')

s = s.replace(
'''            res = trade.order_v3.get_order_history(\n                account_id, page_size=100, start_date=start_date, end_date=end_date,\n                last_client_order_id=cursor,\n            )\n''',
'''            kwargs = {"page_size": 100, "last_client_order_id": cursor}\n            if start_date:\n                kwargs["start_date"] = start_date\n            if end_date:\n                kwargs["end_date"] = end_date\n            res = trade.order_v3.get_order_history(account_id, **kwargs)\n''')

marker = '''    def open_page_loop(self, trade, account_id: str) -> list[dict]:\n'''
helper = '''    @staticmethod\n    def order_local_date(order: dict) -> str:\n        value = order.get("place_time") or order.get("filled_time") or ""\n        if value in (None, ""):\n            return ""\n        text = str(value)\n        if text.isdigit():\n            try:\n                n = int(text)\n                if n > 10_000_000_000:\n                    n = n / 1000\n                return datetime.fromtimestamp(n).strftime("%Y-%m-%d")\n            except Exception:\n                return ""\n        # ISO-like values from Webull normally begin with YYYY-MM-DD.\n        if len(text) >= 10 and text[4:5] == "-" and text[7:8] == "-":\n            return text[:10]\n        try:\n            return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d")\n        except Exception:\n            return ""\n\n'''
if helper not in s and marker in s:
    s = s.replace(marker, helper + marker)

s = s.replace(
'''        today = datetime.now().strftime("%Y-%m-%d")\n        open_orders = self.open_page_loop(trade, account_id)\n        today_orders = self.history_page_loop(trade, account_id, today, today)\n\n        history = self.state.get("history") if isinstance(self.state.get("history"), list) else []\n        need_full = not history or time.time() - self.last_full_refresh >= FULL_REFRESH_SECONDS\n        if need_full:\n            history = self.history_page_loop(trade, account_id, FULL_HISTORY_START, today)\n            self.last_full_refresh = time.time()\n''',
'''        today = datetime.now().strftime("%Y-%m-%d")\n        open_orders = self.open_page_loop(trade, account_id)\n\n        # Webull's current Order History endpoint supports full-history queries when\n        # start_date/end_date are omitted. Passing the same date for both currently\n        # returns OPENAPI_PARAM_ERR for US accounts, so query recent/full history\n        # without date parameters and filter today's rows locally.\n        recent_orders = self.history_page_loop(trade, account_id)\n        today_orders = [o for o in recent_orders if self.order_local_date(o) == today]\n\n        history = self.state.get("history") if isinstance(self.state.get("history"), list) else []\n        need_full = not history or time.time() - self.last_full_refresh >= FULL_REFRESH_SECONDS\n        if need_full:\n            history = self.history_page_loop(trade, account_id)\n            self.last_full_refresh = time.time()\n''')

s = s.replace(
'''                "history_start": FULL_HISTORY_START,\n''',
'''                "history_start": "all available",\n''')

if s == orig:
    print(f"No changes needed: {p}")
else:
    p.write_text(s)
    print(f"Patched Webull order-history date handling: {p}")
PY
}

patch_file "$SOURCE_DIR/webull_activity_service.py"
patch_file "$APPDIR/webull_activity_service.py"

if systemctl list-unit-files --type=service 2>/dev/null | grep -q '^farm-webull-activity.service'; then
  sudo systemctl restart farm-webull-activity
fi

echo "Webull activity date-range fix applied."
