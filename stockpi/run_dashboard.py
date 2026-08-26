from __future__ import annotations

import copy
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
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


WEBULL_CACHE_FILE = dashboard.BASE / "webull-summary-cache.json"
QUOTE_CACHE_FILE = dashboard.BASE / "quote-cache.json"
_PUBLIC_UA = "Mozilla/5.0 (X11; Linux aarch64) FarmPi/1.0"

_summary_lock = threading.RLock()
_webull_refresh_lock = threading.Lock()
_quote_refresh_lock = threading.Lock()
_original_summary = dashboard.WEBULL.summary
_original_refresh_cloud = dashboard.refresh_cloud
_original_refresh_news = dashboard.refresh_news

_last_good_summary: dict | None = None
_last_good_at = 0.0
_last_webull_attempt = 0.0
_last_webull_error: str | None = None


def _load_json(path: Path, default):
    try:
        value = json.loads(path.read_text())
        return value
    except Exception:
        return default


def _atomic_json(path: Path, value, mode: int = 0o600):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2))
    try:
        tmp.chmod(mode)
    except OSError:
        pass
    tmp.replace(path)
    try:
        path.chmod(mode)
    except OSError:
        pass


def _safe_summary_for_disk(summary: dict) -> dict:
    """Persist useful account display data without credentials or account IDs."""
    account = summary.get("account") or {}
    return {
        "configured": True,
        "connected": True,
        "read_only": True,
        "environment": summary.get("environment"),
        "account": {
            "account_type": account.get("account_type"),
            "account_name": account.get("account_name"),
        },
        "balance": summary.get("balance", {}),
        "positions": summary.get("positions", []),
        "watchlists": [
            {
                "name": w.get("name"),
                "instruments": w.get("instruments", []),
                "error": w.get("error"),
            }
            for w in summary.get("watchlists", [])
        ],
        "watchlist_error": summary.get("watchlist_error"),
        "market_data_enabled": bool(summary.get("market_data_enabled")),
        "market_data_connected": bool(summary.get("market_data_connected")),
        "market_data_error": summary.get("market_data_error"),
        "updated": summary.get("updated") or time.time(),
        "error": None,
    }


def _load_persisted_webull():
    global _last_good_summary, _last_good_at
    data = _load_json(WEBULL_CACHE_FILE, {})
    if isinstance(data, dict) and data.get("connected") and isinstance(data.get("positions"), list):
        data["stale"] = True
        data["error"] = "Showing last saved Webull data while live refresh starts"
        _last_good_summary = data
        _last_good_at = float(data.get("updated") or 0)


def _record_good_webull(summary: dict):
    global _last_good_summary, _last_good_at, _last_webull_error
    clean = _safe_summary_for_disk(summary)
    clean["stale"] = False
    clean["last_success"] = float(clean.get("updated") or time.time())
    with _summary_lock:
        _last_good_summary = copy.deepcopy(clean)
        _last_good_at = clean["last_success"]
        _last_webull_error = None
    try:
        _atomic_json(WEBULL_CACHE_FILE, _safe_summary_for_disk(clean))
    except Exception as exc:
        print(f"[farm-runtime] unable to persist Webull display cache: {type(exc).__name__}", flush=True)


def cached_summary(force: bool = False) -> dict:
    """Return memory/disk state only; browser requests never call Webull directly."""
    dashboard.WEBULL.reload()
    now = time.time()
    with _summary_lock:
        if _last_good_summary:
            result = copy.deepcopy(_last_good_summary)
            age = now - float(result.get("updated") or 0)
            result["connected"] = True
            result["stale"] = bool(_last_webull_error) or age > 60
            result["last_attempt"] = _last_webull_attempt
            result["last_success"] = _last_good_at
            result["error"] = _last_webull_error if result["stale"] else None
            return result

    configured = bool(dashboard.WEBULL.configured)
    return {
        "configured": configured,
        "connected": False,
        "stale": False,
        "read_only": True,
        "environment": dashboard.WEBULL.environment,
        "positions": [],
        "watchlists": [],
        "balance": {},
        "updated": None,
        "last_attempt": _last_webull_attempt,
        "error": (
            _last_webull_error
            or ("Waiting for first Webull background refresh" if configured else "Webull credentials/SDK not configured")
        ),
    }


def refresh_webull_external():
    global _last_webull_attempt, _last_webull_error
    if not _webull_refresh_lock.acquire(blocking=False):
        return
    try:
        _last_webull_attempt = time.time()
        result = _original_summary(force=True)
        if result.get("connected"):
            _record_good_webull(result)
        else:
            with _summary_lock:
                _last_webull_error = str(result.get("error") or "Webull refresh failed")[:240]
    except Exception as exc:
        with _summary_lock:
            _last_webull_error = f"{type(exc).__name__}: {exc}"[:240]
    finally:
        _webull_refresh_lock.release()


# All dashboard/UI calls now use the cache. Only refresh_webull_external above
# reaches the Webull account API.
dashboard.WEBULL.summary = cached_summary


# ---------------------------------------------------------------------------
# Resilient public quote path
# ---------------------------------------------------------------------------
def public_quote(symbol: str) -> dict | None:
    """Fetch one current quote from Yahoo's unauthenticated chart endpoint."""
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


def refresh_quotes_external():
    """Refresh concurrently; failures retain the prior good quote per symbol."""
    if not _quote_refresh_lock.acquire(blocking=False):
        return
    try:
        now = time.time()
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

        # Official Webull market snapshots are preferred when entitlement exists.
        # This is still query-only and is serialized inside WebullReadOnly.
        try:
            for sym, q in dashboard.WEBULL.market_quotes(symbols).items():
                if q:
                    q = dict(q)
                    q["stale"] = False
                    q.setdefault("updated", now)
                    fresh[sym] = q
        except Exception:
            pass

        # Owned-position last prices are a final account fallback.
        summary = cached_summary()
        for p in summary.get("positions", []):
            sym = str(p.get("symbol") or "").upper()
            price = p.get("last_price")
            if not sym or price is None:
                continue
            q = fresh.get(sym, {"symbol": sym})
            q["price"] = float(price)
            q.setdefault("source", "webull-position")
            q.setdefault("updated", summary.get("updated") or now)
            q["stale"] = bool(summary.get("stale")) and sym not in fresh
            fresh[sym] = q

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
            to_disk = {
                "ts": dashboard.cache.get("quote_ts", 0),
                "quotes": dashboard.cache.get("quotes", {}),
            }

        try:
            _atomic_json(QUOTE_CACHE_FILE, to_disk)
        except Exception:
            pass
    finally:
        _quote_refresh_lock.release()


# Browser-facing /api/quotes must never perform external I/O. The background
# worker above is solely responsible for network refreshes.
def cache_only_quote_refresh(force: bool = False):
    return None


dashboard.quote_for = public_quote
dashboard.refresh_quotes = cache_only_quote_refresh


# Cloud config/news follow the same architecture: API routes serve cache only;
# dedicated workers do external I/O.
def cache_only_cloud(force: bool = False):
    return None


def cache_only_news(force: bool = False):
    return None


dashboard.refresh_cloud = cache_only_cloud
dashboard.refresh_news = cache_only_news


# ---------------------------------------------------------------------------
# Cache bootstrap
# ---------------------------------------------------------------------------
_load_persisted_webull()

try:
    cached_cloud = dashboard.load_cached_cloud()
    if cached_cloud:
        with dashboard.lock:
            dashboard.cache["cloud_stocks"] = cached_cloud.get("stocks", [])
            dashboard.cache["cloud_updated"] = cached_cloud.get("updated")
except Exception:
    pass

try:
    persisted_quotes = _load_json(QUOTE_CACHE_FILE, {})
    if isinstance(persisted_quotes, dict) and isinstance(persisted_quotes.get("quotes"), dict):
        quotes = {}
        for sym, row in persisted_quotes["quotes"].items():
            if isinstance(row, dict):
                row = dict(row)
                row["stale"] = True
                quotes[str(sym).upper()] = row
        with dashboard.lock:
            dashboard.cache["quotes"] = quotes
            dashboard.cache["quote_ts"] = float(persisted_quotes.get("ts") or 0)
except Exception:
    pass


# ---------------------------------------------------------------------------
# Status-rich, secret-free API responses
# ---------------------------------------------------------------------------
def api_webull_summary_hardened():
    s = cached_summary()
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
    with dashboard.lock:
        return dashboard.jsonify({
            "ts": dashboard.cache.get("quote_ts", 0),
            "attempt_ts": dashboard.cache.get("quote_attempt_ts", 0),
            "error": dashboard.cache.get("quote_error"),
            "quotes": dashboard.cache.get("quotes", {}),
        })


def api_health():
    s = cached_summary()
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
        "webull_last_attempt": s.get("last_attempt"),
        "quote_ts": quote_ts,
        "quote_count": quote_count,
        "cloud_ok": cloud_ok,
    })


dashboard.app.view_functions["api_webull_summary"] = api_webull_summary_hardened
dashboard.app.view_functions["api_quotes"] = api_quotes_hardened
if "api_health" not in dashboard.app.view_functions:
    dashboard.app.add_url_rule("/api/health", "api_health", api_health, methods=["GET"])


# ---------------------------------------------------------------------------
# Background refresh workers
# ---------------------------------------------------------------------------
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


def main():
    # Flask starts immediately. Slow Webull/market/cloud/news I/O happens only in
    # workers, so the kiosk/API remains responsive through provider slowdowns.
    threading.Thread(target=dashboard.power_scheduler_loop, daemon=True).start()
    periodic("webull", refresh_webull_external, 30, 0.2)
    periodic("cloud", lambda: _original_refresh_cloud(force=True), 180, 0.6)
    periodic("quotes", refresh_quotes_external, 20, 1.5)
    periodic("news", lambda: _original_refresh_news(force=True), 600, 8.0)
    dashboard.app.run(host="0.0.0.0", port=8080, debug=False, threaded=True)


if __name__ == "__main__":
    main()
