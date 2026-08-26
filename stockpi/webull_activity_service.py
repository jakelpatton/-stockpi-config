#!/usr/bin/env python3
"""Read-only Webull order/activity monitor for the Farm dashboard.

This process uses only query/subscription interfaces. It never calls preview,
place, replace, cancel, transfer, or withdrawal methods.

It writes sanitized dashboard data to ~/farmpi/static/webull-activity.json.
No App Key, App Secret, token, or Webull account ID is written to that file.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import os
import threading
import time
from typing import Any

logging.getLogger("webull.core.client").setLevel(logging.CRITICAL)

try:
    from webull.core.client import ApiClient
    from webull.trade.trade_client import TradeClient
    from webull.trade.trade_events_client import TradeEventsClient
    from webull.trade.events.types import ORDER_STATUS_CHANGED, EVENT_TYPE_ORDER
except Exception:
    ApiClient = TradeClient = TradeEventsClient = None
    ORDER_STATUS_CHANGED = EVENT_TYPE_ORDER = None

APPDIR = Path(os.environ.get("FARM_APP_DIR", str(Path.home() / "farmpi"))).expanduser()
ENVFILE = Path(os.environ.get("WEBULL_ENV_FILE", str(APPDIR / "webull.env"))).expanduser()
OUTFILE = APPDIR / "static" / "webull-activity.json"
FULL_HISTORY_START = os.environ.get("WEBULL_HISTORY_START", "2000-01-01")
POLL_SECONDS = max(8, int(os.environ.get("WEBULL_ACTIVITY_POLL_SECONDS", "15")))
FULL_REFRESH_SECONDS = max(900, int(os.environ.get("WEBULL_HISTORY_REFRESH_SECONDS", "21600")))


def env_values() -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        for raw in ENVFILE.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def response_json(response):
    if getattr(response, "status_code", 0) != 200:
        raise RuntimeError(f"Webull HTTP {getattr(response, 'status_code', '?')}")
    return response.json()


def list_payload(value: Any, *keys: str) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in keys:
            v = value.get(key)
            if isinstance(v, list):
                return v
        data = value.get("data")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in keys:
                v = data.get(key)
                if isinstance(v, list):
                    return v
    return []


def fnum(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def flatten_orders(payload: Any) -> list[dict]:
    rows = list_payload(payload, "orders", "items", "order_list", "historical_orders", "open_orders")
    out: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        nested = row.get("orders")
        if isinstance(nested, list) and nested:
            out.extend(x for x in nested if isinstance(x, dict))
        else:
            out.append(row)
    return out


def normalize_order(o: dict) -> dict:
    commission = o.get("commission") if isinstance(o.get("commission"), dict) else {}
    fees = o.get("fees") if isinstance(o.get("fees"), list) else []
    legs = o.get("legs") if isinstance(o.get("legs"), list) else []
    symbol = str(o.get("symbol") or "").upper()
    if not symbol and legs:
        symbol = str(legs[0].get("symbol") or "").upper()
    total_fees = 0.0
    have_fee = False
    for fee in fees:
        if isinstance(fee, dict):
            value = fnum(fee.get("actual_value") or fee.get("receivable_value"))
            if value is not None:
                total_fees += value
                have_fee = True
    return {
        "client_order_id": str(o.get("client_order_id") or o.get("clientOrderId") or ""),
        "order_id": str(o.get("order_id") or o.get("orderId") or ""),
        "symbol": symbol,
        "instrument_type": o.get("instrument_type") or o.get("category") or "",
        "side": o.get("side") or "",
        "status": o.get("status") or o.get("order_status") or "",
        "order_type": o.get("order_type") or "",
        "time_in_force": o.get("time_in_force") or "",
        "session": o.get("support_trading_session") or "",
        "quantity": fnum(o.get("total_quantity") or o.get("quantity") or o.get("qty")),
        "filled_quantity": fnum(o.get("filled_quantity") or o.get("filled_qty")),
        "filled_price": fnum(o.get("filled_price") or o.get("avg_fill_price")),
        "limit_price": fnum(o.get("limit_price")),
        "stop_price": fnum(o.get("stop_price")),
        "place_time": o.get("place_time_at") or o.get("place_time") or o.get("created_at") or "",
        "filled_time": o.get("filled_time_at") or o.get("filled_time") or "",
        "commission": fnum(commission.get("actual_commission") or commission.get("receivable_commission") or o.get("actual_commission")),
        "fees": total_fees if have_fee else None,
        "legs": [
            {
                "symbol": str(x.get("symbol") or "").upper(),
                "side": x.get("side") or "",
                "quantity": fnum(x.get("quantity")),
                "option_type": x.get("option_type") or "",
                "strike_price": fnum(x.get("strike_price")),
                "expire_date": x.get("option_expire_date") or "",
            }
            for x in legs if isinstance(x, dict)
        ],
    }


def dedupe_orders(rows: list[dict]) -> list[dict]:
    out, seen = [], set()
    for o in rows:
        key = o.get("client_order_id") or o.get("order_id") or f"{o.get('symbol')}|{o.get('place_time')}|{o.get('side')}|{o.get('quantity')}"
        if key in seen:
            continue
        seen.add(key)
        out.append(o)
    return out


class Monitor:
    def __init__(self):
        self.lock = threading.RLock()
        self.trade = None
        self.api = None
        self.client_signature = None
        self.event_thread = None
        self.event_account = None
        self.events: list[dict] = []
        self.state = self.load_existing()
        self.last_full_refresh = float(self.state.get("history_synced_epoch") or 0)

    def load_existing(self) -> dict:
        try:
            data = json.loads(OUTFILE.read_text())
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def write(self):
        OUTFILE.parent.mkdir(parents=True, exist_ok=True)
        with self.lock:
            payload = dict(self.state)
            payload["real_time_events"] = list(self.events[:40])
            payload["updated"] = iso_now()
        tmp = OUTFILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        tmp.replace(OUTFILE)

    def credentials(self):
        e = env_values()
        return {
            "key": os.environ.get("WEBULL_APP_KEY") or e.get("WEBULL_APP_KEY", ""),
            "secret": os.environ.get("WEBULL_APP_SECRET") or e.get("WEBULL_APP_SECRET", ""),
            "environment": (os.environ.get("WEBULL_ENVIRONMENT") or e.get("WEBULL_ENVIRONMENT", "prod")).lower(),
            "region": (os.environ.get("WEBULL_REGION_ID") or e.get("WEBULL_REGION_ID", "us")).lower(),
            "account_id": os.environ.get("WEBULL_ACCOUNT_ID") or e.get("WEBULL_ACCOUNT_ID", ""),
            "token_dir": os.environ.get("WEBULL_OPENAPI_TOKEN_DIR") or e.get("WEBULL_OPENAPI_TOKEN_DIR", str(APPDIR / ".webull-token")),
        }

    def clients(self, c):
        if ApiClient is None or TradeClient is None:
            raise RuntimeError("webull-openapi-python-sdk is not installed")
        sig = (c["key"], c["secret"], c["environment"], c["region"], c["token_dir"])
        if sig != self.client_signature:
            endpoint = "api.sandbox.webull.com" if c["environment"] in ("sandbox", "test", "uat") else "api.webull.com"
            api = ApiClient(c["key"], c["secret"], c["region"])
            api.add_endpoint(c["region"], endpoint)
            try:
                api.set_token_dir(c["token_dir"])
            except Exception:
                os.environ["WEBULL_OPENAPI_TOKEN_DIR"] = c["token_dir"]
            self.api = api
            self.trade = TradeClient(api)
            self.client_signature = sig
        return self.trade

    def account_id(self, trade, configured_id: str) -> str:
        if configured_id:
            return configured_id
        accounts = list_payload(response_json(trade.account_v2.get_account_list()), "accounts", "account_list", "items")
        if len(accounts) == 1:
            return str(accounts[0].get("account_id") or accounts[0].get("accountId") or accounts[0].get("id") or "")
        return ""

    def history_page_loop(self, trade, account_id: str, start_date: str, end_date: str) -> list[dict]:
        rows: list[dict] = []
        cursor = None
        seen_cursor = set()
        for _ in range(500):
            res = trade.order_v3.get_order_history(
                account_id, page_size=100, start_date=start_date, end_date=end_date,
                last_client_order_id=cursor,
            )
            payload = response_json(res)
            raw = flatten_orders(payload)
            if not raw:
                break
            rows.extend(normalize_order(x) for x in raw)
            explicit = None
            if isinstance(payload, dict):
                explicit = payload.get("next_client_order_id") or payload.get("last_client_order_id")
                if isinstance(payload.get("data"), dict):
                    explicit = explicit or payload["data"].get("next_client_order_id") or payload["data"].get("last_client_order_id")
            next_cursor = str(explicit or raw[-1].get("client_order_id") or "")
            if not next_cursor or next_cursor in seen_cursor or next_cursor == cursor:
                break
            seen_cursor.add(next_cursor)
            cursor = next_cursor
            if len(raw) < 100:
                break
        return dedupe_orders(rows)

    def open_page_loop(self, trade, account_id: str) -> list[dict]:
        rows: list[dict] = []
        cursor = None
        seen_cursor = set()
        for _ in range(100):
            payload = response_json(trade.order_v3.get_order_open(account_id, page_size=100, last_client_order_id=cursor))
            raw = flatten_orders(payload)
            if not raw:
                break
            rows.extend(normalize_order(x) for x in raw)
            explicit = None
            if isinstance(payload, dict):
                explicit = payload.get("next_client_order_id") or payload.get("last_client_order_id")
                if isinstance(payload.get("data"), dict):
                    explicit = explicit or payload["data"].get("next_client_order_id") or payload["data"].get("last_client_order_id")
            next_cursor = str(explicit or raw[-1].get("client_order_id") or "")
            if not next_cursor or next_cursor in seen_cursor or next_cursor == cursor:
                break
            seen_cursor.add(next_cursor)
            cursor = next_cursor
            if len(raw) < 100:
                break
        return dedupe_orders(rows)

    def start_events(self, c, account_id: str):
        if TradeEventsClient is None or not account_id or self.event_account == account_id:
            return
        self.event_account = account_id

        def worker():
            try:
                client = TradeEventsClient(c["key"], c["secret"], c["region"])
                client.on_log = lambda *args, **kwargs: None

                def on_message(event_type, subscribe_type, payload, raw_message):
                    if event_type != EVENT_TYPE_ORDER or subscribe_type != ORDER_STATUS_CHANGED or not isinstance(payload, dict):
                        return
                    safe = {k: v for k, v in payload.items() if k not in ("account_id",)}
                    event = {
                        "received": iso_now(),
                        "symbol": str(safe.get("symbol") or "").upper(),
                        "client_order_id": safe.get("client_order_id") or "",
                        "order_id": safe.get("order_id") or "",
                        "side": safe.get("side") or "",
                        "order_type": safe.get("order_type") or "",
                        "status": safe.get("order_status") or "",
                        "scene_type": safe.get("scene_type") or "",
                        "quantity": fnum(safe.get("qty")),
                        "filled_quantity": fnum(safe.get("filled_qty")),
                        "filled_price": fnum(safe.get("filled_price")),
                        "filled_time": safe.get("filled_time") or "",
                        "commission": fnum(safe.get("actual_commission")),
                        "fees": safe.get("fees") if isinstance(safe.get("fees"), list) else [],
                    }
                    with self.lock:
                        self.events.insert(0, event)
                        self.events = self.events[:40]
                        self.state["event_stream"] = "live"
                    self.write()

                client.on_events_message = on_message
                with self.lock:
                    self.state["event_stream"] = "connecting"
                self.write()
                client.do_subscribe([account_id])
            except Exception as exc:
                with self.lock:
                    self.state["event_stream"] = "polling"
                    self.state["event_error"] = str(exc)[:180]
                self.write()

        self.event_thread = threading.Thread(target=worker, daemon=True, name="webull-events")
        self.event_thread.start()

    def refresh(self):
        c = self.credentials()
        if not c["key"] or not c["secret"]:
            with self.lock:
                self.state.update({
                    "configured": False, "connected": False, "read_only": True,
                    "error": "Webull credentials are not configured",
                    "open_orders": [], "today_orders": [],
                })
            self.write()
            return
        trade = self.clients(c)
        account_id = self.account_id(trade, c["account_id"])
        if not account_id:
            raise RuntimeError("Webull account has not been selected yet")
        self.start_events(c, account_id)

        today = datetime.now().strftime("%Y-%m-%d")
        open_orders = self.open_page_loop(trade, account_id)
        today_orders = self.history_page_loop(trade, account_id, today, today)

        history = self.state.get("history") if isinstance(self.state.get("history"), list) else []
        need_full = not history or time.time() - self.last_full_refresh >= FULL_REFRESH_SECONDS
        if need_full:
            history = self.history_page_loop(trade, account_id, FULL_HISTORY_START, today)
            self.last_full_refresh = time.time()

        # Most recent first when timestamps are sortable ISO strings/millisecond strings.
        def sort_key(o):
            return str(o.get("place_time") or o.get("filled_time") or "")
        open_orders = sorted(open_orders, key=sort_key, reverse=True)
        today_orders = sorted(today_orders, key=sort_key, reverse=True)
        history = sorted(dedupe_orders(history), key=sort_key, reverse=True)

        filled_today = sum(1 for o in today_orders if str(o.get("status") or "").upper() in ("FILLED", "PARTIAL_FILLED"))
        failed_today = sum(1 for o in today_orders if str(o.get("status") or "").upper() in ("FAILED", "REJECTED"))
        cancelled_today = sum(1 for o in today_orders if str(o.get("status") or "").upper() in ("CANCELLED", "CANCELED"))

        with self.lock:
            self.state.update({
                "configured": True,
                "connected": True,
                "read_only": True,
                "error": None,
                "event_stream": self.state.get("event_stream") or "polling",
                "open_orders": open_orders,
                "today_orders": today_orders,
                "history": history,
                "history_complete": True,
                "history_start": FULL_HISTORY_START,
                "history_synced_at": iso_now() if need_full else self.state.get("history_synced_at"),
                "history_synced_epoch": self.last_full_refresh,
                "counts": {
                    "open": len(open_orders),
                    "today": len(today_orders),
                    "filled_today": filled_today,
                    "cancelled_today": cancelled_today,
                    "failed_today": failed_today,
                    "history": len(history),
                },
                "notes": {
                    "us_execution_endpoint": "Webull's dedicated get_order_executions SDK method is documented for HK; US fill quantity/price/time are taken from order history/detail data and live trade events.",
                    "latest_status": "Open/history endpoints may lag; live order event subscription is used when available.",
                },
            })
        self.write()

    def run(self):
        self.write()
        while True:
            try:
                self.refresh()
            except Exception as exc:
                with self.lock:
                    self.state["connected"] = False
                    self.state["read_only"] = True
                    self.state["error"] = str(exc)[:240]
                    self.state.setdefault("event_stream", "polling")
                self.write()
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    Monitor().run()
