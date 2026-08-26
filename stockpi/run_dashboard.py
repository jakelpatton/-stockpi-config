from __future__ import annotations

import copy
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote

import requests

import app as dashboard


# Keep credential-bearing Webull SDK internals out of the journal. The dashboard
# still exposes concise errors through its read-only status API.
for logger_name in (
    "webull",
    "webull.core",
    "webull.core.client",
    "webull.core.http",
    "webull.core.http.initializer",
    "webull.core.http.initializer.token",
    "webull.core.http.initializer.token.token_manager",
):
    logging.getLogger(logger_name).setLevel(logging.CRITICAL)


# ---------------------------------------------------------------------------
# Resilient Webull summary
# ---------------------------------------------------------------------------
_summary_lock = threading.RLock()
_original_summary = dashboard.WEBULL.summary
_last_good_summary: dict | None = None
_last_good_at = 0.0


def resilient_summary(force: bool = False) -> dict:
    """Keep the last known-good read-only Webull state through transient faults.

    A brief API/2FA/network failure should not make the TV suddenly claim the
    account is disconnected or erase position data. If a previous good summary
    exists, return it as stale while preserving the latest error for diagnostics.
    """
    global _last_good_summary, _last_good_at

    now = time.time()
    result = _original_summary(force=force)
    if result.get("connected"):
        clean = dict(result)
        clean["stale"] = False
        clean["last_attempt"] = now
        clean["last_success"] = float(clean.get("updated") or now)
        with _summary_lock:
            _last_good_summary = copy.deepcopy(clean)
            _last_good_at = clean["last_success"]
        return clean

    with _summary_lock:
        if _last_good_summary:
            stale = copy.deepcopy(_last_good_summary)
            stale["connected"] = True
            stale["stale"] = True
            stale["last_attempt"] = now
            stale["last_success"] = _last_good_at
            stale["error"] = result.get("error") or "Webull refresh failed; showing last known-good data"
            return stale

    result = dict(result)
    result["stale"] = False
    result["last_attempt"] = now
    return result


dashboard.WEBULL.summary = resilient_summary


# ---------------------------------------------------------------------------
# Resilient public quote path
# ---------------------------------------------------------------------------
_quote_refresh_lock = threading.Lock()
_PUBLIC_UA = "Mozilla/5.0 (X11; Linux aarch64) FarmPi/1.0"


def public_quote(symbol: str) -> dict | None:
    """Fetch one current quote from Yahoo's chart endpoint without auth.

    The chart endpoint is used instead of yfinance.fast_info because the latter
    was being called sequentially for every symbol and could make /api/quotes
    block for a long time. includePrePost keeps extended-hours prices available.
    """
    symbol = str(symbol or "").upper().strip()
    if not symbol:
        return None

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}"
    params = {
        "range": "2d",
        "interval": "1m",
        "includePrePost": "true",
        "events": "div,splits",
    }
    try:
        r = requests.get(url, params=params, timeout=6, headers={"User-Agent": _PUBLIC_UA})
        r.raise_for_status()
        payload = r.json()
        result = ((payload.get("chart") or {}).get("result") or [None])[0]
        if not isinstance(result, dict):
            return None

        meta = result.get("meta") or {}
        timestamps = result.get("timestamp") or []
        closes = (((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [])

        last = None
        trade_ts = None
        for ts, value in zip(reversed(timestamps), reversed(closes)):
            if value is not None:
                try:
                    last = float(value)
                    trade_ts = float(ts)
                    break
                except (TypeError, ValueError):
                    pass

        if last is None:
            try:
                raw = meta.get("regularMarketPrice")
                last = float(raw) if raw is not None else None
            except (TypeError, ValueError):
                last = None
        if last is None:
            return None

        def f(*keys):
            for key in keys:
                try:
                    value = meta.get(key)
                    if value is not None:
                        return float(value)
                except (TypeError, ValueError):
                    pass
            return None

        prev = f("chartPreviousClose", "previousClose")
        change = last - prev if prev else None
        pct = (change / prev * 100) if prev and change is not None else None
        return {
            "symbol": symbol,
            "price": round(last, 4),
            "prev_close": round(prev, 4) if prev is not None else None,
            "change": round(change, 4) if change is not None else None,
            "pct": round(pct, 3) if pct is not None else None,
            "open": f("regularMarketOpen"),
            "high": f("regularMarketDayHigh"),
            "low": f("regularMarketDayLow"),
            "volume": f("regularMarketVolume"),
            "trade_time": trade_ts,
            "updated": trade_ts or time.time(),
            "source": "public-yahoo",
            "stale": False,
        }
    except Exception:
        return None


def resilient_refresh_quotes(force: bool = False):
    """Refresh quotes concurrently and never replace good data with blanks."""
    now = time.time()
    with dashboard.lock:
        current_ts = float(dashboard.cache.get("quote_ts") or 0)
    if not force and now - current_ts < 15:
        return

    # Only one caller may perform the external refresh. Browser requests that
    # arrive simultaneously keep serving the existing cache instead of spawning
    # duplicate Yahoo/Webull requests.
    if not _quote_refresh_lock.acquire(blocking=False):
        return

    try:
        stocks = dashboard.stocks_with_webull()
        symbols = sorted({str(s.get("symbol") or "").upper() for s in stocks if s.get("symbol")})
        fresh: dict[str, dict] = {}

        if symbols:
            with ThreadPoolExecutor(max_workers=min(6, len(symbols))) as pool:
                futures = {pool.submit(public_quote, sym): sym for sym in symbols}
                for future in as_completed(futures):
                    sym = futures[future]
                    try:
                        q = future.result()
                    except Exception:
                        q = None
                    if q:
                        fresh[sym] = q

        # Prefer official Webull market snapshots when entitlement exists.
        try:
            for sym, q in dashboard.WEBULL.market_quotes(symbols).items():
                if q:
                    q = dict(q)
                    q["stale"] = False
                    q.setdefault("updated", now)
                    fresh[sym] = q
        except Exception:
            pass

        # Owned-position prices remain a reliable account fallback even without
        # the separate STOCK QUOTES entitlement.
        try:
            summary = dashboard.WEBULL.summary()
            for p in summary.get("positions", []):
                sym = str(p.get("symbol") or "").upper()
                price = p.get("last_price")
                if not sym or price is None:
                    continue
                q = fresh.get(sym, {"symbol": sym})
                q["price"] = float(price)
                q.setdefault("source", "webull-position")
                q.setdefault("updated", summary.get("updated") or now)
                q["stale"] = bool(summary.get("stale"))
                fresh[sym] = q
        except Exception:
            pass

        with dashboard.lock:
            previous = dict(dashboard.cache.get("quotes") or {})
            merged: dict[str, dict] = {}
            for sym in symbols:
                if sym in fresh:
                    merged[sym] = fresh[sym]
                elif sym in previous:
                    old = dict(previous[sym])
                    old["stale"] = True
                    merged[sym] = old

            if fresh:
                dashboard.cache["quote_ts"] = now
            dashboard.cache["quotes"] = merged
            dashboard.cache["quote_attempt_ts"] = now
            missing = [sym for sym in symbols if sym not in fresh]
            dashboard.cache["quote_error"] = (
                f"{len(missing)} symbol(s) using stale/unavailable public quote data" if missing else None
            )
    finally:
        _quote_refresh_lock.release()


dashboard.quote_for = public_quote
dashboard.refresh_quotes = resilient_refresh_quotes


# Replace the public API views with status-rich versions that still deliberately
# omit credentials and account IDs.
def api_webull_summary_hardened():
    s = dashboard.WEBULL.summary()
    public = {
        "configured": bool(s.get("configured")),
        "connected": bool(s.get("connected")),
        "stale": bool(s.get("stale")),
        "read_only": True,
        "environment": s.get("environment"),
        "needs_account_selection": bool(s.get("needs_account_selection")),
        "balance": s.get("balance", {}),
        "positions": s.get("positions", []),
        "watchlists": [
            {"name": w.get("name"), "instruments": w.get("instruments", []), "error": w.get("error")}
            for w in s.get("watchlists", [])
        ],
        "market_data_enabled": bool(s.get("market_data_enabled")),
        "market_data_connected": bool(s.get("market_data_connected")),
        "market_data_error": s.get("market_data_error"),
        "updated": s.get("updated"),
        "last_attempt": s.get("last_attempt"),
        "last_success": s.get("last_success"),
        "error": s.get("error"),
    }
    account = s.get("account") or {}
    if account:
        public["account"] = {
            "account_type": account.get("account_type"),
            "account_name": account.get("account_name"),
        }
    return dashboard.jsonify(public)


def api_quotes_hardened():
    dashboard.refresh_quotes()
    with dashboard.lock:
        return dashboard.jsonify({
            "ts": dashboard.cache.get("quote_ts", 0),
            "attempt_ts": dashboard.cache.get("quote_attempt_ts", 0),
            "error": dashboard.cache.get("quote_error"),
            "quotes": dashboard.cache.get("quotes", {}),
        })


def api_health():
    try:
        s = dashboard.WEBULL.summary()
    except Exception as exc:
        s = {"configured": False, "connected": False, "error": str(exc)}
    with dashboard.lock:
        quote_ts = dashboard.cache.get("quote_ts", 0)
        quote_count = len(dashboard.cache.get("quotes", {}) or {})
        cloud_ok = bool(dashboard.cache.get("cloud_ok"))
    return dashboard.jsonify({
        "ok": True,
        "server_time": time.time(),
        "webull_configured": bool(s.get("configured")),
        "webull_connected": bool(s.get("connected")),
        "webull_stale": bool(s.get("stale")),
        "webull_updated": s.get("updated"),
        "quote_ts": quote_ts,
        "quote_count": quote_count,
        "cloud_ok": cloud_ok,
    })


dashboard.app.view_functions["api_webull_summary"] = api_webull_summary_hardened
dashboard.app.view_functions["api_quotes"] = api_quotes_hardened
if "api_health" not in dashboard.app.view_functions:
    dashboard.app.add_url_rule("/api/health", "api_health", api_health, methods=["GET"])


# Prime the cloud cache from disk immediately. This is local I/O only and lets
# the dashboard render its configured symbols before the first network refresh.
try:
    cached_cloud = dashboard.load_cached_cloud()
    if cached_cloud:
        with dashboard.lock:
            dashboard.cache["cloud_stocks"] = cached_cloud.get("stocks", [])
            dashboard.cache["cloud_updated"] = cached_cloud.get("updated")
except Exception:
    pass


def periodic(name: str, fn, interval: float, initial_delay: float = 0.0):
    def loop():
        if initial_delay:
            time.sleep(initial_delay)
        while True:
            started = time.monotonic()
            try:
                fn()
            except Exception as exc:
                print(f"[farm-runtime] {name} refresh failed: {type(exc).__name__}: {exc}", flush=True)
            elapsed = time.monotonic() - started
            time.sleep(max(1.0, interval - elapsed))

    threading.Thread(target=loop, name=f"farm-{name}", daemon=True).start()


def refresh_webull():
    dashboard.WEBULL.summary(force=True)


def refresh_quotes():
    dashboard.refresh_quotes(force=True)


def refresh_cloud():
    dashboard.refresh_cloud(force=True)


def refresh_news():
    dashboard.refresh_news(force=True)


def main():
    # Flask starts immediately. All slow external I/O runs after the server is
    # already listening, eliminating the former 20–30+ second startup blackout.
    threading.Thread(target=dashboard.power_scheduler_loop, daemon=True).start()
    periodic("webull", refresh_webull, 20, 0.2)
    periodic("cloud", refresh_cloud, 180, 0.5)
    periodic("quotes", refresh_quotes, 20, 1.5)
    periodic("news", refresh_news, 600, 8.0)
    dashboard.app.run(host="0.0.0.0", port=8080, debug=False, threaded=True)


if __name__ == "__main__":
    main()
