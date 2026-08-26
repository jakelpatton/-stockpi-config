from flask import Flask, render_template, request, redirect, url_for, jsonify, Response
from pathlib import Path
import json, time, threading, os, subprocess
import requests
from requests.auth import HTTPDigestAuth
import yfinance as yf
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus
from datetime import datetime
from webull_readonly import WebullReadOnly

app = Flask(__name__)
BASE = Path(__file__).resolve().parent
LOCAL_CONFIG = BASE / "stocks.json"
CLOUD_CACHE = BASE / "cloud_portfolio_cache.json"
POWER_CONFIG = BASE / "power_schedule.json"
DASH_CONFIG = BASE / "dashboard_config.json"
CLOUD_CONFIG_URL = os.environ.get("STOCKPI_CLOUD_CONFIG_URL", "https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/portfolio.json")
WEBULL = WebullReadOnly(BASE)

# Amcrest NVR settings. Password is intentionally NOT stored in GitHub.
AMCREST_NVR_IP = os.environ.get("AMCREST_NVR_IP", "192.168.1.4")
AMCREST_NVR_USER = os.environ.get("AMCREST_NVR_USER", "admin")
AMCREST_NVR_PASSWORD = os.environ.get("AMCREST_NVR_PASSWORD", "")
AMCREST_CHANNELS = [1, 2, 3, 4]

cache = {
    "quotes": {}, "news": [], "quote_ts": 0, "news_ts": 0,
    "cloud_ts": 0, "cloud_ok": False, "cloud_error": None,
    "cloud_updated": None, "cloud_stocks": []
}
lock = threading.Lock()


def _json(path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def load_local_stocks(): return _json(LOCAL_CONFIG, [])
def save_local_stocks(v): LOCAL_CONFIG.write_text(json.dumps(v, indent=2))
def load_cached_cloud(): return _json(CLOUD_CACHE, {})


def refresh_cloud(force=False):
    now = time.time()
    with lock:
        if not force and now - cache["cloud_ts"] < 180:
            return
    try:
        r = requests.get(CLOUD_CONFIG_URL, timeout=10, headers={"User-Agent": "Farm/6.0"})
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, dict) or not isinstance(data.get("stocks", []), list):
            raise ValueError("Cloud JSON must contain stocks")
        CLOUD_CACHE.write_text(json.dumps(data, indent=2))
        with lock:
            cache.update(cloud_stocks=data.get("stocks", []), cloud_updated=data.get("updated"), cloud_ok=True, cloud_error=None, cloud_ts=now)
    except Exception as e:
        c = load_cached_cloud()
        with lock:
            if c:
                cache["cloud_stocks"] = c.get("stocks", [])
                cache["cloud_updated"] = c.get("updated")
            cache.update(cloud_ok=False, cloud_error=str(e), cloud_ts=now)


def merged_stocks():
    refresh_cloud()
    local = load_local_stocks()
    with lock:
        cloud = list(cache["cloud_stocks"])
    cb = {s.get("symbol", "").upper(): dict(s) for s in cloud if s.get("symbol")}
    out, seen = [], set()
    for s in local:
        sym = s.get("symbol", "").upper()
        if not sym:
            continue
        m = dict(s); m.update(cb.get(sym, {})); m["symbol"] = sym
        out.append(m); seen.add(sym)
    out += [dict(v, symbol=k) for k, v in cb.items() if k not in seen]
    return out


def stocks_with_webull():
    """Overlay live Webull positions/watchlists without changing thesis thresholds."""
    base = [dict(s) for s in merged_stocks()]
    by_symbol = {s.get("symbol", "").upper(): s for s in base if s.get("symbol")}
    try:
        summary = WEBULL.summary()
    except Exception:
        return base
    if not summary.get("connected"):
        return base

    for p in summary.get("positions", []):
        sym = str(p.get("symbol") or "").upper()
        if not sym:
            continue
        item = by_symbol.get(sym)
        if item is None:
            item = {"symbol": sym}
            base.append(item); by_symbol[sym] = item
        qty = p.get("quantity"); avg = p.get("average_cost")
        item.update({
            "owned": True,
            "webull": True,
            "shares_estimate": qty,
            "average_cost": avg,
            "position_usd": p.get("cost_basis"),
            "webull_market_value": p.get("market_value"),
            "webull_unrealized_pl": p.get("unrealized_pl"),
            "webull_unrealized_pct": p.get("unrealized_pct"),
            "webull_last_price": p.get("last_price"),
        })

    for watch in summary.get("watchlists", []):
        name = watch.get("name") or "Webull Watchlist"
        for instrument in watch.get("instruments", []):
            sym = str(instrument.get("symbol") or "").upper()
            if not sym:
                continue
            item = by_symbol.get(sym)
            if item is None:
                item = {"symbol": sym}
                base.append(item); by_symbol[sym] = item
            item["webull_watchlist"] = True
            names = item.setdefault("watchlist_names", [])
            if name not in names:
                names.append(name)
    return base


def quote_for(symbol):
    try:
        fi = yf.Ticker(symbol).fast_info
        last, prev = fi.get("last_price"), fi.get("previous_close")
        if last is None:
            return None
        change = last - prev if prev else None
        pct = (change / prev) * 100 if prev and change is not None else None
        return {"symbol": symbol, "price": round(float(last), 4), "prev_close": round(float(prev), 4) if prev else None,
                "change": round(float(change), 4) if change is not None else None,
                "pct": round(float(pct), 3) if pct is not None else None, "source": "public"}
    except Exception:
        return None


def refresh_quotes(force=False):
    now = time.time()
    with lock:
        if not force and now - cache["quote_ts"] < 20:
            return
    stocks = stocks_with_webull()
    symbols = [s["symbol"] for s in stocks if s.get("symbol")]
    data = {}
    for sym in symbols:
        q = quote_for(sym)
        if q:
            data[sym] = q

    # Prefer official Webull snapshots when the OpenAPI market-data permission/
    # subscription is available. If it is not, WebullReadOnly backs off and the
    # existing public quote feed remains untouched.
    try:
        webull_quotes = WEBULL.market_quotes(symbols)
    except Exception:
        webull_quotes = {}
    for sym, wq in webull_quotes.items():
        current = data.get(sym, {"symbol": sym})
        for key in ("price", "prev_close", "change", "pct"):
            if wq.get(key) is not None:
                current[key] = wq[key]
        current["source"] = "webull"
        data[sym] = current

    # Account-position last price is still useful even when a separate Webull
    # real-time market-data subscription is not enabled.
    try:
        for sym, price in WEBULL.position_prices().items():
            if price is not None:
                q = data.get(sym, {"symbol": sym})
                q["price"] = price
                q.setdefault("source", "webull-position")
                data[sym] = q
    except Exception:
        pass

    with lock:
        cache["quotes"], cache["quote_ts"] = data, now


def _google_news_rss(query, category, limit=12):
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    items = []
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent": "Farm/6.0"}); r.raise_for_status()
        root = ET.fromstring(r.content)
        for item in root.findall(".//item")[:limit]:
            title = (item.findtext("title") or "").strip()
            if title:
                items.append({"symbol": category, "title": title, "url": (item.findtext("link") or "").strip(),
                              "published": (item.findtext("pubDate") or "").strip(), "category": category})
    except Exception:
        pass
    return items


def refresh_news(force=False):
    now = time.time()
    with lock:
        if not force and now - cache["news_ts"] < 600:
            return
    items = []
    for s in merged_stocks():
        try:
            for n in (yf.Ticker(s["symbol"]).news or [])[:4]:
                c = n.get("content", n); title = c.get("title") or n.get("title"); u = c.get("canonicalUrl")
                link = u.get("url") if isinstance(u, dict) else c.get("link") or n.get("link")
                if title:
                    items.append({"symbol": s["symbol"], "title": title, "url": link, "category": "PORTFOLIO"})
        except Exception:
            pass
    items += _google_news_rss('"AI chips" OR HBM OR GPU OR semiconductor', "AI CHIPS", 12)
    items += _google_news_rss('"artificial intelligence" OR "generative AI"', "AI NEWS", 12)
    seen, ded = set(), []
    for i in items:
        k = " ".join(i.get("title", "").lower().split())
        if k and k not in seen:
            seen.add(k); ded.append(i)
    with lock:
        cache["news"], cache["news_ts"] = ded[:48], now


def load_power_config():
    d = {"enabled": True, "wake_time": "07:15", "sleep_time": "22:30", "switch_to_pi_input_on_wake": True}
    d.update(_json(POWER_CONFIG, {})); return d


def save_power_config(v): POWER_CONFIG.write_text(json.dumps(v, indent=2))


def load_dash_config():
    d = {"rotation_enabled": True, "rotation_seconds": 18, "theme": "light", "screens": ["stocks", "home", "water", "power", "cameras"]}
    d.update(_json(DASH_CONFIG, {})); return d


def save_dash_config(v): DASH_CONFIG.write_text(json.dumps(v, indent=2))


def cec_command(command):
    try:
        p = subprocess.run(["cec-client", "-s", "-d", "1"], input=command + "\n", text=True, capture_output=True, timeout=12)
        return p.returncode == 0, ((p.stdout or "") + (p.stderr or ""))[-1200:]
    except FileNotFoundError:
        return False, "cec-client is not installed"
    except Exception as e:
        return False, str(e)


_power_last_action = {"wake": None, "sleep": None}
def power_scheduler_loop():
    while True:
        try:
            cfg = load_power_config(); now = datetime.now(); today, hhmm = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")
            if cfg.get("enabled", True):
                if hhmm == cfg.get("wake_time") and _power_last_action["wake"] != today:
                    cec_command("on 0"); time.sleep(3)
                    if cfg.get("switch_to_pi_input_on_wake", True): cec_command("as")
                    _power_last_action["wake"] = today
                if hhmm == cfg.get("sleep_time") and _power_last_action["sleep"] != today:
                    cec_command("standby 0"); _power_last_action["sleep"] = today
        except Exception:
            pass
        time.sleep(20)


@app.after_request
def inject_optional_dashboard_assets(response):
    try:
        if request.endpoint == "dashboard" and response.content_type.startswith("text/html"):
            html = response.get_data(as_text=True)
            for css in ("propane.css", "cameras.css"):
                if f"/static/{css}" not in html:
                    html = html.replace("</head>", f'<link rel="stylesheet" href="/static/{css}">\n</head>')
            for js in ("propane.js", "cameras.js"):
                if f"/static/{js}" not in html:
                    html = html.replace("</body>", f'<script src="/static/{js}"></script>\n</body>')
            response.set_data(html)
    except Exception:
        pass
    return response


@app.route("/")
def dashboard(): return render_template("dashboard.html")


@app.route("/settings", methods=["GET", "POST"])
def settings():
    stocks = load_local_stocks()
    if request.method == "POST":
        action = request.form.get("action")
        if action == "add":
            sym = request.form.get("symbol", "").upper().strip()
            if sym and not any(s["symbol"] == sym for s in stocks):
                def f(n):
                    v = request.form.get(n, "").strip(); return float(v) if v else None
                stocks.append({"symbol": sym, "buy": f("buy"), "strong": f("strong"), "aggressive": f("aggressive")})
        elif action == "delete":
            stocks = [s for s in stocks if s["symbol"] != request.form.get("symbol")]
        elif action == "save":
            updated = []
            for i, s in enumerate(stocks):
                def f(n):
                    v = request.form.get(f"{n}_{i}", "").strip(); return float(v) if v else None
                updated.append({"symbol": request.form.get(f"symbol_{i}", s["symbol"]).upper().strip(), "buy": f("buy"), "strong": f("strong"), "aggressive": f("aggressive")})
            stocks = updated
        elif action in ("up", "down"):
            idx = int(request.form.get("index", 0)); j = idx - 1 if action == "up" else idx + 1
            if 0 <= idx < len(stocks) and 0 <= j < len(stocks): stocks[idx], stocks[j] = stocks[j], stocks[idx]
        save_local_stocks(stocks); return redirect(url_for("settings"))
    return render_template("settings.html", stocks=stocks, cloud_url=CLOUD_CONFIG_URL)


@app.route("/api/quotes")
def api_quotes():
    refresh_quotes()
    with lock: return jsonify({"ts": cache["quote_ts"], "quotes": cache["quotes"]})

@app.route("/api/news")
def api_news():
    refresh_news()
    with lock: return jsonify({"ts": cache["news_ts"], "news": cache["news"]})

@app.route("/api/stocks")
def api_stocks(): return jsonify(stocks_with_webull())

@app.route("/api/webull/summary")
def api_webull_summary():
    """LAN dashboard-safe Webull data. Credentials/account IDs are never exposed."""
    s = WEBULL.summary()
    public = {
        "configured": bool(s.get("configured")),
        "connected": bool(s.get("connected")),
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
        "updated": s.get("updated"),
        "error": s.get("error"),
    }
    account = s.get("account") or {}
    if account:
        public["account"] = {"account_type": account.get("account_type"), "account_name": account.get("account_name")}
    return jsonify(public)

@app.route("/api/cloud-status")
def api_cloud_status():
    refresh_cloud()
    with lock: return jsonify({"ok": cache["cloud_ok"], "updated": cache["cloud_updated"], "error": cache["cloud_error"]})

@app.route("/api/dashboard-settings", methods=["GET", "POST"])
def dashboard_settings():
    cfg = load_dash_config()
    if request.method == "POST":
        d = request.get_json(silent=True) or {}
        cfg["rotation_enabled"] = bool(d.get("rotation_enabled", cfg["rotation_enabled"]))
        cfg["rotation_seconds"] = max(5, min(300, int(d.get("rotation_seconds", cfg["rotation_seconds"]))))
        cfg["theme"] = d.get("theme", cfg["theme"]); save_dash_config(cfg)
    return jsonify(cfg)


@app.route("/api/cameras/status")
def api_cameras_status():
    return jsonify({"configured": bool(AMCREST_NVR_PASSWORD), "nvr_ip": AMCREST_NVR_IP, "channels": AMCREST_CHANNELS})

@app.route("/api/cameras/snapshot/<int:channel>")
def api_camera_snapshot(channel):
    if channel not in AMCREST_CHANNELS:
        return Response(status=404)
    if not AMCREST_NVR_PASSWORD:
        return Response(status=503)
    url = f"http://{AMCREST_NVR_IP}/cgi-bin/snapshot.cgi?channel={channel}"
    try:
        r = requests.get(url, auth=HTTPDigestAuth(AMCREST_NVR_USER, AMCREST_NVR_PASSWORD), timeout=4)
        r.raise_for_status()
        return Response(r.content, mimetype=r.headers.get("Content-Type", "image/jpeg"), headers={"Cache-Control": "no-store, max-age=0"})
    except Exception:
        return Response(status=502)


@app.route("/api/home")
def api_home():
    return jsonify({
        "demo": True,
        "weather": {"temp": 76, "condition": "Partly cloudy", "high": 84, "low": 66, "rain": 20, "wind": 7},
        "main": {"upstairs": 73.1, "downstairs": 71.8, "humidity": 48, "power_kw": 2.4},
        "rockhouse": {"temp": 72.4, "humidity": 51, "power_kw": 0.7},
        "water": {"main": {"pressure": 48, "flow": 2.1, "today": 126, "filter": "Good", "quality": "Rain discoloration watch"},
                  "rockhouse": {"pressure": 52, "flow": 0.0, "today": 34, "filter": "Good", "quality": "Clear"},
                  "leaks": {"main": "Dry", "rockhouse": "Dry", "wellhouse": "Dry"}},
        "wellhouse": {"temp": 64, "humidity": 58, "pump": "Ready", "voltage": 241, "current": 0.0},
        "gate": {"state": "Closed", "battery": 13.1, "last_event": "Closed 3:42 PM", "network": "Online"},
        "tesla": {"state": "Parked", "charge": 78, "range": 236, "charging": "Not charging", "location": "Home"},
        "propane": {"demo": True, "level": 67, "status": "Monitoring planned", "sensor": "Gauge info pending", "tank_capacity_gal": None,
                    "estimated_gallons": None, "burn_rate_gpd": None, "days_remaining": None, "low_alert_pct": 25},
        "electrical": {"main_voltage": 121.8, "main_load_kw": 2.4, "rockhouse_voltage": 122.1, "rockhouse_load_kw": 0.7,
                       "well_voltage": 241.0, "well_load_kw": 0.0}
    })

@app.route("/api/power-settings", methods=["GET", "POST"])
def api_power_settings():
    if request.method == "POST":
        data = request.get_json(silent=True) or request.form; cfg = load_power_config()
        for k in ("wake_time", "sleep_time"):
            if data.get(k): cfg[k] = str(data[k])
        for k in ("enabled", "switch_to_pi_input_on_wake"):
            if k in data: cfg[k] = data[k] if isinstance(data[k], bool) else str(data[k]).lower() in ("1", "true", "yes", "on")
        save_power_config(cfg); return jsonify({"ok": True, "config": cfg})
    return jsonify(load_power_config())

@app.route("/api/tv/<action>", methods=["POST"])
def api_tv(action):
    cmd = {"on": "on 0", "standby": "standby 0", "input": "as"}.get(action)
    if not cmd: return jsonify({"ok": False, "message": "Unknown action"}), 400
    ok, msg = cec_command(cmd)
    if action == "on" and ok and load_power_config().get("switch_to_pi_input_on_wake", True): time.sleep(2); cec_command("as")
    return jsonify({"ok": ok, "message": msg})

if __name__ == "__main__":
    threading.Thread(target=power_scheduler_loop, daemon=True).start()
    refresh_cloud(force=True); refresh_quotes(force=True); refresh_news(force=True)
    app.run(host="0.0.0.0", port=8080, debug=False)
