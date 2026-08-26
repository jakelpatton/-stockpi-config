#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

import requests

HOST = "0.0.0.0"
PORT = 8092
CACHE_SECONDS = 45
USER_AGENT = "Mozilla/5.0 (X11; Linux aarch64) FarmPi-OwnedCharts/1.0"
SYMBOL_RE = re.compile(r"^[A-Z0-9.^-]{1,16}$")

_cache: dict[str, dict] = {}
_lock = threading.RLock()


def fetch_chart(symbol: str) -> dict:
    symbol = symbol.upper().strip()
    if not SYMBOL_RE.match(symbol):
        raise ValueError("invalid symbol")

    now = time.time()
    with _lock:
        cached = _cache.get(symbol)
        if cached and now - float(cached.get("fetched_at", 0)) < CACHE_SECONDS:
            return dict(cached)

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        "range": "1d",
        "interval": "5m",
        "includePrePost": "false",
        "events": "div,splits",
    }
    try:
        r = requests.get(url, params=params, timeout=6, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        payload = r.json()
        result = ((payload.get("chart") or {}).get("result") or [None])[0]
        if not isinstance(result, dict):
            raise ValueError("missing chart result")

        timestamps = result.get("timestamp") or []
        quote = (((result.get("indicators") or {}).get("quote") or [{}])[0])
        closes = quote.get("close") or []
        points = []
        times = []
        for ts, value in zip(timestamps, closes):
            if value is None:
                continue
            try:
                points.append(round(float(value), 4))
                times.append(int(ts))
            except (TypeError, ValueError):
                continue

        if len(points) < 2:
            raise ValueError("not enough chart points")

        meta = result.get("meta") or {}
        row = {
            "ok": True,
            "symbol": symbol,
            "points": points,
            "timestamps": times,
            "previous_close": meta.get("chartPreviousClose") or meta.get("previousClose"),
            "currency": meta.get("currency"),
            "exchange_timezone": meta.get("exchangeTimezoneName"),
            "fetched_at": now,
            "stale": False,
        }
        with _lock:
            _cache[symbol] = dict(row)
        return row
    except Exception as exc:
        with _lock:
            cached = _cache.get(symbol)
            if cached:
                row = dict(cached)
                row["stale"] = True
                row["error"] = f"{type(exc).__name__}: {exc}"[:180]
                return row
        raise


class Handler(BaseHTTPRequestHandler):
    server_version = "FarmPiOwnedCharts/1.0"

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/api/health":
            self._send_json(200, {"ok": True, "service": "owned-charts", "time": time.time()})
            return
        prefix = "/api/chart/"
        if self.path.startswith(prefix):
            symbol = unquote(self.path[len(prefix):].split("?", 1)[0]).upper().strip()
            if not SYMBOL_RE.match(symbol):
                self._send_json(400, {"ok": False, "error": "invalid symbol"})
                return
            try:
                self._send_json(200, fetch_chart(symbol))
            except Exception as exc:
                self._send_json(502, {"ok": False, "symbol": symbol, "points": [], "error": f"{type(exc).__name__}: {exc}"[:180]})
            return
        self._send_json(404, {"ok": False, "error": "not found"})

    def log_message(self, fmt, *args):
        return


def main():
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"FarmPi owned chart service listening on {HOST}:{PORT}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
