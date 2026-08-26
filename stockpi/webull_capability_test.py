#!/usr/bin/env python3
"""Safe, query-only Webull OpenAPI capability test for the Farm dashboard.

Tests account reads plus market snapshot, extended/overnight fields, historical
bars, level-1 depth, ticks, and a short MQTT streaming subscription. It never
calls preview/place/replace/cancel/transfer/withdrawal endpoints and never writes
credentials, tokens, account IDs, signatures, or raw request headers to output.
"""
from __future__ import annotations

from pathlib import Path
import argparse
import json
import logging
import os
import threading
import time
import uuid
from typing import Any

for name in ("webull", "webull.core", "webull.data", "webull.core.client"):
    log = logging.getLogger(name)
    log.handlers.clear()
    log.propagate = False
    log.setLevel(logging.CRITICAL)

APPDIR = Path(os.environ.get("FARM_APP_DIR", str(Path.home() / "farmpi"))).expanduser()
ENVFILE = Path(os.environ.get("WEBULL_ENV_FILE", str(APPDIR / "webull.env"))).expanduser()
OUTFILE = APPDIR / "static" / "webull-capabilities.json"


def load_env(path: Path) -> dict[str, str]:
    out = {}
    try:
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def list_payload(value: Any, *keys: str) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for key in keys:
            if isinstance(value.get(key), list):
                return value[key]
        data = value.get("data")
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in keys:
                if isinstance(data.get(key), list):
                    return data[key]
    return []


def response_json(response):
    status = getattr(response, "status_code", None)
    if status != 200:
        text = getattr(response, "text", "") or ""
        raise RuntimeError(f"HTTP {status}: {text[:180]}")
    return response.json()


def sample_dict(payload: Any) -> dict:
    if isinstance(payload, list):
        return next((x for x in payload if isinstance(x, dict)), {})
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return next((x for x in data if isinstance(x, dict)), {})
        if isinstance(data, dict):
            for key in ("snapshots", "items", "bars", "ticks", "quotes"):
                if isinstance(data.get(key), list) and data[key]:
                    return next((x for x in data[key] if isinstance(x, dict)), {})
            return data
        for key in ("snapshots", "items", "bars", "ticks", "quotes"):
            if isinstance(payload.get(key), list) and payload[key]:
                return next((x for x in payload[key] if isinstance(x, dict)), {})
        return payload
    return {}


def row_count(payload: Any) -> int:
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict):
        for key in ("snapshots", "items", "bars", "ticks", "quotes"):
            if isinstance(payload.get(key), list):
                return len(payload[key])
        data = payload.get("data")
        if isinstance(data, list):
            return len(data)
        if isinstance(data, dict):
            for key in ("snapshots", "items", "bars", "ticks", "quotes"):
                if isinstance(data.get(key), list):
                    return len(data[key])
            return 1 if data else 0
        return 1 if payload else 0
    return 0


def safe_call(name, fn):
    try:
        payload = response_json(fn())
        sample = sample_dict(payload)
        return {
            "ok": True,
            "rows": row_count(payload),
            "sample_fields": sorted(str(k) for k in sample.keys()),
            "sample": {k: sample.get(k) for k in (
                "symbol", "price", "pre_close", "change", "change_ratio",
                "open", "high", "low", "volume", "turnover",
                "ext_price", "ext_change", "ext_change_ratio",
                "ovn_price", "ovn_change", "ovn_change_ratio",
                "timestamp", "time", "trade_time"
            ) if k in sample},
        }, payload
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:220]}, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", help="US stock symbol to test; defaults to first held equity")
    ap.add_argument("--stream-seconds", type=int, default=12, help="Maximum streaming test time")
    ap.add_argument("--no-stream", action="store_true", help="Skip MQTT streaming test")
    args = ap.parse_args()

    env = load_env(ENVFILE)
    key = os.environ.get("WEBULL_APP_KEY") or env.get("WEBULL_APP_KEY", "")
    secret = os.environ.get("WEBULL_APP_SECRET") or env.get("WEBULL_APP_SECRET", "")
    region = (os.environ.get("WEBULL_REGION_ID") or env.get("WEBULL_REGION_ID", "us")).lower()
    environment = (os.environ.get("WEBULL_ENVIRONMENT") or env.get("WEBULL_ENVIRONMENT", "prod")).lower()
    account_id = os.environ.get("WEBULL_ACCOUNT_ID") or env.get("WEBULL_ACCOUNT_ID", "")
    token_dir = os.environ.get("WEBULL_OPENAPI_TOKEN_DIR") or env.get("WEBULL_OPENAPI_TOKEN_DIR", str(APPDIR / ".webull-token"))

    result = {
        "query_only": True,
        "credentials_in_output": False,
        "environment": environment,
        "tested_at_epoch": time.time(),
        "account_reads": {},
        "market_data": {},
    }

    if not key or not secret:
        result["error"] = "Webull credentials not configured"
        print(json.dumps(result, indent=2))
        return 2

    try:
        from webull.core.client import ApiClient
        from webull.trade.trade_client import TradeClient
        from webull.data.data_client import DataClient
        from webull.data.common.category import Category
        from webull.data.common.timespan import Timespan
        from webull.data.common.subscribe_type import SubscribeType
        from webull.data.data_streaming_client import DataStreamingClient
    except Exception as exc:
        result["error"] = f"Webull SDK import failed: {exc}"
        print(json.dumps(result, indent=2))
        return 2

    endpoint = "api.sandbox.webull.com" if environment in ("sandbox", "test", "uat") else "api.webull.com"
    mqtt_host = "data-api.sandbox.webull.com" if environment in ("sandbox", "test", "uat") else "data-api.webull.com"

    api = ApiClient(key, secret, region)
    api.add_endpoint(region, endpoint)
    try:
        api.set_token_dir(token_dir)
    except Exception:
        os.environ["WEBULL_OPENAPI_TOKEN_DIR"] = token_dir
    trade = TradeClient(api)
    data = DataClient(api)

    # Account reads are used only to select a test symbol and report which safe
    # fields the API makes available. Account IDs themselves are never output.
    try:
        accounts_payload = response_json(trade.account_v2.get_account_list())
        accounts = list_payload(accounts_payload, "accounts", "account_list", "items")
        if not account_id and len(accounts) == 1:
            a = accounts[0]
            account_id = str(a.get("account_id") or a.get("accountId") or a.get("id") or "")
        result["account_reads"]["account_list"] = {"ok": True, "count": len(accounts)}
    except Exception as exc:
        result["account_reads"]["account_list"] = {"ok": False, "error": str(exc)[:220]}

    positions = []
    if account_id:
        try:
            balance = response_json(trade.account_v2.get_account_balance(account_id))
            bd = balance.get("balance", balance) if isinstance(balance, dict) else {}
            result["account_reads"]["balance"] = {"ok": True, "fields": sorted(str(k) for k in bd.keys()) if isinstance(bd, dict) else []}
        except Exception as exc:
            result["account_reads"]["balance"] = {"ok": False, "error": str(exc)[:220]}
        try:
            pp = response_json(trade.account_v2.get_account_position(account_id))
            positions = list_payload(pp, "positions", "items")
            if not positions and isinstance(pp, list):
                positions = pp
            fields = sorted({str(k) for p in positions if isinstance(p, dict) for k in p.keys()})
            result["account_reads"]["positions"] = {"ok": True, "count": len(positions), "fields": fields}
        except Exception as exc:
            result["account_reads"]["positions"] = {"ok": False, "error": str(exc)[:220]}

    symbol = (args.symbol or "").upper().strip()
    if not symbol:
        for p in positions:
            if isinstance(p, dict) and (p.get("instrument_type") in (None, "", "EQUITY")) and p.get("symbol"):
                symbol = str(p["symbol"]).upper()
                break
    if not symbol:
        symbol = "AAPL"
    result["market_data"]["test_symbol"] = symbol

    snap, snap_payload = safe_call("snapshot", lambda: data.market_data.get_snapshot(
        [symbol], Category.US_STOCK.name, extend_hour_required=True, overnight_required=True))
    if snap.get("ok"):
        sample = sample_dict(snap_payload)
        snap["extended_fields_present"] = any(k in sample for k in ("ext_price", "ext_change", "ext_change_ratio", "ext_trade_time"))
        snap["overnight_fields_present"] = any(k in sample for k in ("ovn_price", "ovn_change", "ovn_change_ratio", "ovn_trade_time"))
    result["market_data"]["snapshot_extended_overnight"] = snap

    bars, _ = safe_call("bars", lambda: data.market_data.get_history_bar(
        symbol, Category.US_STOCK.name, Timespan.M1.name, count="5",
        real_time_required=True, trading_sessions=["PRE", "RTH", "ATH", "OVN"]))
    result["market_data"]["historical_bars_m1"] = bars

    depth, _ = safe_call("depth", lambda: data.market_data.get_quotes(
        symbol, Category.US_STOCK.name, depth=1, overnight_required=True))
    result["market_data"]["level1_depth"] = depth

    ticks, _ = safe_call("ticks", lambda: data.market_data.get_tick(
        symbol, Category.US_STOCK.name, count="5", trading_sessions=["PRE", "RTH", "ATH", "OVN"]))
    result["market_data"]["ticks"] = ticks

    stream_result = {"attempted": False}
    if not args.no_stream:
        stream_result = {"attempted": True, "connected": False, "subscribed": False, "message_received": False}
        connected_evt = threading.Event()
        subscribed_evt = threading.Event()
        message_evt = threading.Event()
        messages = []
        stream_error = []
        client = None
        try:
            client = DataStreamingClient(
                key, secret, region, uuid.uuid4().hex,
                http_host=endpoint, mqtt_host=mqtt_host,
            )
            try:
                client.set_token_dir(token_dir)
            except Exception:
                pass

            def on_connect(c, api_client, session_id):
                connected_evt.set()
                sub_types = [SubscribeType.QUOTE.name, SubscribeType.SNAPSHOT.name, SubscribeType.TICK.name]
                c.subscribe([symbol], Category.US_STOCK.name, sub_types, depth=1, overnight_required=True)

            def on_subscribe(c, api_client, session_id):
                subscribed_evt.set()

            def on_message(c, topic, quotes):
                messages.append({"topic": str(topic), "payload_type": type(quotes).__name__})
                message_evt.set()

            client.on_connect_success = on_connect
            client.on_subscribe_success = on_subscribe
            client.on_quotes_message = on_message

            def run_stream():
                try:
                    client.connect_and_loop_forever(timeout=1, logger_enable=False)
                except Exception as exc:
                    stream_error.append(str(exc)[:220])

            t = threading.Thread(target=run_stream, daemon=True, name="webull-capability-stream")
            t.start()
            deadline = time.time() + max(4, min(args.stream_seconds, 30))
            while time.time() < deadline:
                if subscribed_evt.is_set() and message_evt.is_set():
                    break
                if stream_error:
                    break
                time.sleep(0.25)
            stream_result.update({
                "connected": connected_evt.is_set(),
                "subscribed": subscribed_evt.is_set(),
                "message_received": message_evt.is_set(),
                "messages": messages[:3],
            })
            if stream_error:
                stream_result["error"] = stream_error[0]
            elif subscribed_evt.is_set() and not message_evt.is_set():
                stream_result["note"] = "Streaming subscription succeeded; no market message arrived during the short test window."
        except Exception as exc:
            stream_result["error"] = str(exc)[:220]
        finally:
            if client is not None:
                try:
                    client.disconnect()
                except Exception:
                    pass
                try:
                    client.loop_stop()
                except Exception:
                    pass
    result["market_data"]["streaming_mqtt"] = stream_result

    checks = [v for k, v in result["market_data"].items() if isinstance(v, dict) and k != "streaming_mqtt"]
    result["market_data"]["http_market_data_available"] = any(v.get("ok") for v in checks)
    result["market_data"]["streaming_available"] = bool(stream_result.get("subscribed"))

    OUTFILE.parent.mkdir(parents=True, exist_ok=True)
    OUTFILE.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    print(f"\nSaved sanitized capability report: {OUTFILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
