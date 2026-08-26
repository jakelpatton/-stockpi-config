"""Read-only Webull OpenAPI integration for the Farm dashboard.

This module intentionally exposes only GET/query operations: account list, balance,
positions, watchlists, and market-data queries. It contains no order placement,
replacement, cancellation, transfer, or withdrawal methods.

Credentials are loaded from ~/farmpi/webull.env (or WEBULL_ENV_FILE) and the
Webull SDK's 2FA token is stored in a private local directory. Nothing here
requires credentials to be committed to GitHub.
"""
from __future__ import annotations

from pathlib import Path
import logging
import os
import threading
import time
from typing import Any

# The official SDK's default error logger can dump complete signed request
# headers, including the App Key. Keep those credential-bearing request dumps
# out of the dashboard journal; callers still receive concise exceptions.
logging.getLogger("webull").setLevel(logging.CRITICAL)
logging.getLogger("webull.core").setLevel(logging.CRITICAL)
logging.getLogger("webull.core.client").setLevel(logging.CRITICAL)

try:
    from webull.core.client import ApiClient
    from webull.trade.trade_client import TradeClient
    from webull.data.data_client import DataClient
except Exception:  # SDK may not be installed yet; dashboard must still start.
    ApiClient = TradeClient = DataClient = None


def _float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _list_payload(value: Any, *keys: str) -> list:
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


def _response_json(response):
    if getattr(response, "status_code", 0) != 200:
        text = getattr(response, "text", "") or ""
        raise RuntimeError(f"Webull HTTP {getattr(response, 'status_code', '?')}: {text[:240]}")
    return response.json()


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return values


class WebullReadOnly:
    def __init__(self, base_dir: Path):
        self.base_dir = Path(base_dir)
        self.env_file = Path(os.environ.get("WEBULL_ENV_FILE", self.base_dir / "webull.env"))
        self._lock = threading.Lock()
        self._summary_cache: tuple[float, dict] = (0.0, {})
        self._accounts_cache: tuple[float, list] = (0.0, [])
        self._watch_cache: tuple[float, list] = (0.0, [])
        self._quote_cache: tuple[float, tuple[str, ...], dict] = (0.0, tuple(), {})
        self._market_retry_after = 0.0
        self._market_last_error = None
        self._client_key = None
        self._api = self._trade = self._data = None
        self.reload()

    def reload(self):
        file_values = load_env_file(self.env_file)
        self.app_key = os.environ.get("WEBULL_APP_KEY") or file_values.get("WEBULL_APP_KEY", "")
        self.app_secret = os.environ.get("WEBULL_APP_SECRET") or file_values.get("WEBULL_APP_SECRET", "")
        self.environment = (os.environ.get("WEBULL_ENVIRONMENT") or file_values.get("WEBULL_ENVIRONMENT", "prod")).lower()
        self.region = (os.environ.get("WEBULL_REGION_ID") or file_values.get("WEBULL_REGION_ID", "us")).lower()
        self.account_id = os.environ.get("WEBULL_ACCOUNT_ID") or file_values.get("WEBULL_ACCOUNT_ID", "")
        self.use_market_data = (os.environ.get("WEBULL_USE_MARKET_DATA") or file_values.get("WEBULL_USE_MARKET_DATA", "true")).lower() in ("1", "true", "yes", "on")
        token_dir_value = os.environ.get("WEBULL_OPENAPI_TOKEN_DIR") or file_values.get("WEBULL_OPENAPI_TOKEN_DIR")
        self.token_dir = Path(token_dir_value) if token_dir_value else self.base_dir / ".webull-token"
        self.endpoint = "api.sandbox.webull.com" if self.environment in ("sandbox", "test", "uat") else "api.webull.com"
        key = (self.app_key, self.app_secret, self.environment, self.region, str(self.token_dir))
        if key != self._client_key:
            self._client_key = key
            self._api = self._trade = self._data = None
            self._summary_cache = (0.0, {})
            self._accounts_cache = (0.0, [])
            self._watch_cache = (0.0, [])
            self._quote_cache = (0.0, tuple(), {})
            self._market_retry_after = 0.0
            self._market_last_error = None

    @property
    def configured(self) -> bool:
        return bool(self.app_key and self.app_secret and ApiClient and TradeClient and DataClient)

    def _clients(self):
        self.reload()
        if not self.configured:
            if not self.app_key or not self.app_secret:
                raise RuntimeError("Webull credentials are not configured")
            raise RuntimeError("webull-openapi-python-sdk is not installed")
        if self._api is None:
            self.token_dir.mkdir(parents=True, exist_ok=True)
            try:
                self.token_dir.chmod(0o700)
            except OSError:
                pass
            api = ApiClient(self.app_key, self.app_secret, self.region)
            api.add_endpoint(self.region, self.endpoint)
            try:
                api.set_token_dir(str(self.token_dir))
            except Exception:
                os.environ["WEBULL_OPENAPI_TOKEN_DIR"] = str(self.token_dir)
            self._api = api
            self._trade = TradeClient(api)
            self._data = DataClient(api)
        return self._trade, self._data

    def accounts(self, force: bool = False) -> list[dict]:
        now = time.time()
        with self._lock:
            if not force and now - self._accounts_cache[0] < 3600 and self._accounts_cache[1]:
                return list(self._accounts_cache[1])
        trade, _ = self._clients()
        payload = _response_json(trade.account_v2.get_account_list())
        accounts = _list_payload(payload, "accounts", "account_list", "items")
        if not accounts and isinstance(payload, dict) and any(k in payload for k in ("account_id", "accountId")):
            accounts = [payload]
        with self._lock:
            self._accounts_cache = (now, list(accounts))
        return accounts

    @staticmethod
    def account_identifier(account: dict) -> str:
        return str(account.get("account_id") or account.get("accountId") or account.get("id") or "")

    def _selected_account(self) -> tuple[str, dict | None, list[dict]]:
        accounts = self.accounts()
        if self.account_id:
            match = next((a for a in accounts if self.account_identifier(a) == self.account_id), None)
            return self.account_id, match, accounts
        if len(accounts) == 1:
            return self.account_identifier(accounts[0]), accounts[0], accounts
        return "", None, accounts

    def watchlists(self, force: bool = False) -> list[dict]:
        now = time.time()
        with self._lock:
            if not force and now - self._watch_cache[0] < 120:
                return list(self._watch_cache[1])
        _, data = self._clients()
        watch_payload = _response_json(data.watchlist.get_watchlist())
        watchlists = _list_payload(watch_payload, "watchlists", "items")
        normalized = []
        for watch in watchlists:
            wid = str(watch.get("watchlist_id") or watch.get("watchlistId") or watch.get("id") or "")
            entry = {
                "watchlist_id": wid,
                "name": watch.get("name") or watch.get("watchlist_name") or "Watchlist",
                "instruments": [],
            }
            if wid:
                try:
                    instruments_payload = _response_json(data.watchlist.get_instruments(wid))
                    instruments = _list_payload(instruments_payload, "instruments", "items")
                    entry["instruments"] = [
                        {
                            "symbol": str(i.get("symbol") or "").upper(),
                            "name": i.get("name") or "",
                            "exchange": i.get("exchange_code") or i.get("exchange") or "",
                        }
                        for i in instruments if i.get("symbol")
                    ]
                except Exception as exc:
                    entry["error"] = str(exc)
            normalized.append(entry)
        with self._lock:
            self._watch_cache = (now, list(normalized))
        return normalized

    def summary(self, force: bool = False) -> dict:
        self.reload()
        if not self.configured:
            return {
                "configured": False,
                "connected": False,
                "read_only": True,
                "environment": self.environment,
                "error": "Webull credentials/SDK not configured",
                "positions": [], "watchlists": [], "balance": {},
            }
        now = time.time()
        with self._lock:
            if not force and now - self._summary_cache[0] < 15 and self._summary_cache[1]:
                return dict(self._summary_cache[1])
        try:
            account_id, account, accounts = self._selected_account()
            if not account_id:
                result = {
                    "configured": True, "connected": True, "read_only": True,
                    "environment": self.environment,
                    "needs_account_selection": True,
                    "accounts": [self._safe_account(a) for a in accounts],
                    "positions": [], "watchlists": [], "balance": {},
                    "error": "Multiple Webull accounts found; select WEBULL_ACCOUNT_ID",
                }
                with self._lock:
                    self._summary_cache = (now, result)
                return result

            trade, _ = self._clients()
            balance_raw = _response_json(trade.account_v2.get_account_balance(account_id))
            positions_raw = _response_json(trade.account_v2.get_account_position(account_id))
            positions_list = _list_payload(positions_raw, "positions", "items")
            if not positions_list and isinstance(positions_raw, list):
                positions_list = positions_raw
            positions = []
            for p in positions_list:
                qty = _float(p.get("quantity") or p.get("qty"))
                avg = _float(p.get("cost_price") or p.get("avg_cost") or p.get("average_cost"))
                last = _float(p.get("last_price") or p.get("market_price"))
                upl = _float(p.get("unrealized_profit_loss") or p.get("unrealized_pl"))
                market_value = (qty * last) if qty is not None and last is not None else None
                cost_basis = (qty * avg) if qty is not None and avg is not None else None
                total_pct = (upl / cost_basis * 100) if upl is not None and cost_basis else None
                symbol = str(p.get("symbol") or "").upper()
                if not symbol:
                    continue
                positions.append({
                    "symbol": symbol,
                    "instrument_type": p.get("instrument_type") or "",
                    "quantity": qty,
                    "average_cost": avg,
                    "last_price": last,
                    "market_value": market_value,
                    "cost_basis": cost_basis,
                    "unrealized_pl": upl,
                    "unrealized_pct": total_pct,
                    "currency": p.get("currency") or "USD",
                    "event_outcome": p.get("event_outcome") or "",
                })

            balance = self._normalize_balance(balance_raw)
            try:
                watchlists = self.watchlists()
                watch_error = None
            except Exception as exc:
                watchlists, watch_error = [], str(exc)

            # Enrich owned positions with one batch Webull market snapshot. The
            # market query requests regular, extended-hours and overnight data.
            # Failure is non-fatal: account/position data remains available and
            # the existing public quote fallback continues to work.
            symbols = [p["symbol"] for p in positions if p.get("instrument_type") in ("", "EQUITY")]
            market = self.market_quotes(symbols)
            for p in positions:
                m = market.get(p["symbol"])
                if m:
                    p["market"] = m
                    if m.get("price") is not None:
                        p["last_price"] = m["price"]
                        if p.get("quantity") is not None:
                            p["market_value"] = p["quantity"] * m["price"]
                    prev = m.get("prev_close")
                    current = m.get("price")
                    if p.get("quantity") is not None and current is not None and prev is not None:
                        p["day_pl"] = p["quantity"] * (current - prev)
                        p["day_pct"] = ((current - prev) / prev * 100) if prev else None
                elif p.get("last_price") is not None:
                    p["market"] = {"symbol": p["symbol"], "price": p["last_price"], "source": "webull-position"}

            result = {
                "configured": True, "connected": True, "read_only": True,
                "environment": self.environment,
                "account": self._safe_account(account or {"account_id": account_id}),
                "balance": balance,
                "positions": positions,
                "watchlists": watchlists,
                "watchlist_error": watch_error,
                "market_data_enabled": self.use_market_data,
                "market_data_connected": bool(market),
                "market_data_error": self._market_last_error,
                "updated": time.time(),
                "error": None,
            }
        except Exception as exc:
            result = {
                "configured": True, "connected": False, "read_only": True,
                "environment": self.environment,
                "positions": [], "watchlists": [], "balance": {},
                "error": str(exc),
                "updated": time.time(),
            }
        with self._lock:
            self._summary_cache = (now, result)
        return dict(result)

    @staticmethod
    def _safe_account(account: dict) -> dict:
        return {
            "account_id": str(account.get("account_id") or account.get("accountId") or account.get("id") or ""),
            "account_type": account.get("account_type") or account.get("accountType") or account.get("type") or "",
            "account_name": account.get("account_name") or account.get("accountName") or account.get("name") or "",
        }

    @staticmethod
    def _normalize_balance(raw: Any) -> dict:
        d = raw.get("balance", raw) if isinstance(raw, dict) else {}
        assets = d.get("account_currency_assets") if isinstance(d, dict) else None
        usd = next((x for x in assets or [] if x.get("currency") == "USD"), (assets or [{}])[0] if assets else {})

        def first(*keys):
            for key in keys:
                v = _float(d.get(key)) if isinstance(d, dict) else None
                if v is not None:
                    return v
                v = _float(usd.get(key)) if isinstance(usd, dict) else None
                if v is not None:
                    return v
            return None

        calls = d.get("open_margin_calls") if isinstance(d, dict) else None
        return {
            "currency": d.get("total_asset_currency") or usd.get("currency") or "USD",
            "cash": first("total_cash_balance", "cash_balance"),
            "settled_cash": first("settled_cash"),
            "unsettled_cash": first("unsettled_cash"),
            "held_amount": first("held_amount"),
            "buying_power": first("buying_power", "overnight_buying_power", "day_buying_power"),
            "day_buying_power": first("day_buying_power"),
            "overnight_buying_power": first("overnight_buying_power"),
            "night_trading_buying_power": first("night_trading_buying_power"),
            "available_withdrawal": first("available_withdrawal"),
            "market_value": first("total_market_value", "market_value"),
            "net_liquidation_value": first("total_net_liquidation_value", "net_liquidation_value"),
            "day_pl": first("total_day_profit_loss", "day_profit_loss"),
            "unrealized_pl": first("total_unrealized_profit_loss", "unrealized_profit_loss"),
            "maintenance_margin": first("maintenance_margin"),
            "interests_unpaid": first("interests_unpaid"),
            "open_margin_calls": calls if isinstance(calls, list) else ([] if not calls else calls),
        }

    @staticmethod
    def _snapshot_rows(payload: Any) -> list[dict]:
        rows = _list_payload(payload, "snapshots", "items", "quotes")
        if rows:
            return [x for x in rows if isinstance(x, dict)]
        if isinstance(payload, dict):
            data = payload.get("data")
            if isinstance(data, dict) and (data.get("symbol") or data.get("ticker")):
                return [data]
            if payload.get("symbol") or payload.get("ticker"):
                return [payload]
        return []

    @staticmethod
    def _normalize_snapshot(row: dict) -> dict:
        symbol = str(row.get("symbol") or row.get("ticker") or "").upper()
        price = _float(row.get("price") or row.get("last_price") or row.get("close"))
        prev = _float(row.get("pre_close") or row.get("prev_close") or row.get("previous_close"))
        change = _float(row.get("change"))
        pct = _float(row.get("change_ratio") or row.get("change_rate") or row.get("pct"))
        if pct is not None and abs(pct) <= 1 and row.get("change_ratio") is not None:
            pct *= 100
        if change is None and price is not None and prev is not None:
            change = price - prev
        if pct is None and change is not None and prev:
            pct = change / prev * 100

        ext_pct = _float(row.get("ext_change_ratio") or row.get("extended_change_ratio"))
        ovn_pct = _float(row.get("ovn_change_ratio") or row.get("overnight_change_ratio"))
        if ext_pct is not None and abs(ext_pct) <= 1:
            ext_pct *= 100
        if ovn_pct is not None and abs(ovn_pct) <= 1:
            ovn_pct *= 100

        return {
            "symbol": symbol,
            "price": price,
            "prev_close": prev,
            "change": change,
            "pct": pct,
            "open": _float(row.get("open")),
            "high": _float(row.get("high")),
            "low": _float(row.get("low")),
            "volume": _float(row.get("volume")),
            "turnover": _float(row.get("turnover") or row.get("turnover_rate")),
            "trade_time": row.get("trade_time") or row.get("time") or "",
            "ext_trade_time": row.get("ext_trade_time") or row.get("extended_trade_time") or "",
            "ext_price": _float(row.get("ext_price") or row.get("extended_price")),
            "ext_high": _float(row.get("ext_high") or row.get("extended_high")),
            "ext_low": _float(row.get("ext_low") or row.get("extended_low")),
            "ext_volume": _float(row.get("ext_volume") or row.get("extended_volume")),
            "ext_change": _float(row.get("ext_change") or row.get("extended_change")),
            "ext_pct": ext_pct,
            "ovn_trade_time": row.get("ovn_trade_time") or row.get("overnight_trade_time") or "",
            "ovn_price": _float(row.get("ovn_price") or row.get("overnight_price")),
            "ovn_high": _float(row.get("ovn_high") or row.get("overnight_high")),
            "ovn_low": _float(row.get("ovn_low") or row.get("overnight_low")),
            "ovn_volume": _float(row.get("ovn_volume") or row.get("overnight_volume")),
            "ovn_change": _float(row.get("ovn_change") or row.get("overnight_change")),
            "ovn_pct": ovn_pct,
            "source": "webull",
        }

    def market_quotes(self, symbols: list[str], force: bool = False) -> dict[str, dict]:
        """Try official Webull snapshots including extended/overnight fields.

        Returns {} when OpenAPI market-data entitlement is unavailable. No write or
        trading methods are used.
        """
        self.reload()
        if not self.configured or not self.use_market_data or time.time() < self._market_retry_after:
            return {}
        syms = tuple(sorted({str(s).upper() for s in symbols if s}))
        if not syms:
            return {}
        now = time.time()
        with self._lock:
            ts, cached_syms, cached = self._quote_cache
            if not force and cached_syms == syms and now - ts < 20:
                return dict(cached)
        try:
            _, data = self._clients()
            # Official SDK supports a symbol list (up to 100) and optional
            # extended-hours / overnight fields in the same snapshot request.
            payload = _response_json(data.market_data.get_snapshot(
                list(syms), "US_STOCK",
                extend_hour_required=True,
                overnight_required=True,
            ))
            quotes = {}
            for row in self._snapshot_rows(payload):
                q = self._normalize_snapshot(row)
                if q["symbol"]:
                    quotes[q["symbol"]] = q
            self._market_last_error = None
            self._market_retry_after = 0.0
            with self._lock:
                self._quote_cache = (now, syms, quotes)
            return quotes
        except Exception as exc:
            # Avoid repeatedly hammering an endpoint when the OpenAPI market-data
            # subscription is absent. Public quote fallback remains available.
            self._market_last_error = str(exc)[:240]
            self._market_retry_after = time.time() + 600
            return {}

    def position_prices(self) -> dict[str, float]:
        summary = self.summary()
        return {p["symbol"]: p["last_price"] for p in summary.get("positions", []) if p.get("last_price") is not None}
