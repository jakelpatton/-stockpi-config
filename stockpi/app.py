from flask import Flask, render_template, request, redirect, url_for, jsonify
from pathlib import Path
import json, time, threading, os
import requests
import yfinance as yf
import xml.etree.ElementTree as ET
from urllib.parse import quote_plus
import subprocess
from datetime import datetime

app = Flask(__name__)
BASE = Path(__file__).resolve().parent
LOCAL_CONFIG = BASE / "stocks.json"
CLOUD_CACHE = BASE / "cloud_portfolio_cache.json"
POWER_CONFIG = BASE / "power_schedule.json"

CLOUD_CONFIG_URL = os.environ.get(
    "STOCKPI_CLOUD_CONFIG_URL",
    "https://raw.githubusercontent.com/jakelpatton/-stockpi-config/main/portfolio.json"
)

cache = {
    "quotes": {},
    "news": [],
    "quote_ts": 0,
    "news_ts": 0,
    "cloud_ts": 0,
    "cloud_ok": False,
    "cloud_error": None,
    "cloud_updated": None,
    "cloud_stocks": []
}
lock = threading.Lock()

def load_local_stocks():
    try:
        return json.loads(LOCAL_CONFIG.read_text())
    except Exception:
        return []

def save_local_stocks(stocks):
    LOCAL_CONFIG.write_text(json.dumps(stocks, indent=2))

def load_cached_cloud():
    try:
        data = json.loads(CLOUD_CACHE.read_text())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def refresh_cloud(force=False):
    now = time.time()
    with lock:
        if not force and now - cache["cloud_ts"] < 180:
            return
    try:
        r = requests.get(CLOUD_CONFIG_URL, timeout=10, headers={"User-Agent": "StockPi/2.0"})
        r.raise_for_status()
        data = r.json()
        if not isinstance(data, dict) or not isinstance(data.get("stocks", []), list):
            raise ValueError("Cloud JSON must contain a top-level 'stocks' array")
        CLOUD_CACHE.write_text(json.dumps(data, indent=2))
        with lock:
            cache["cloud_stocks"] = data.get("stocks", [])
            cache["cloud_updated"] = data.get("updated")
            cache["cloud_ok"] = True
            cache["cloud_error"] = None
            cache["cloud_ts"] = now
    except Exception as e:
        cached = load_cached_cloud()
        with lock:
            if cached:
                cache["cloud_stocks"] = cached.get("stocks", [])
                cache["cloud_updated"] = cached.get("updated")
            cache["cloud_ok"] = False
            cache["cloud_error"] = str(e)
            cache["cloud_ts"] = now

def merged_stocks():
    refresh_cloud()
    local = load_local_stocks()
    with lock:
        cloud = list(cache["cloud_stocks"])

    cloud_by = {s.get("symbol","").upper(): dict(s) for s in cloud if s.get("symbol")}
    result, seen = [], set()

    for s in local:
        sym = s.get("symbol","").upper()
        if not sym:
            continue
        merged = dict(s)
        if sym in cloud_by:
            merged.update(cloud_by[sym])
        merged["symbol"] = sym
        result.append(merged)
        seen.add(sym)

    for sym, c in cloud_by.items():
        if sym not in seen:
            result.append(dict(c, symbol=sym))

    return result

def quote_for(symbol):
    try:
        t = yf.Ticker(symbol)
        fi = t.fast_info
        last = fi.get("last_price")
        prev = fi.get("previous_close")
        if last is None:
            return None
        change = last - prev if prev else None
        pct = (change / prev) * 100 if prev and change is not None else None
        return {
            "symbol": symbol,
            "price": round(float(last), 4),
            "prev_close": round(float(prev), 4) if prev else None,
            "change": round(float(change), 4) if change is not None else None,
            "pct": round(float(pct), 3) if pct is not None else None
        }
    except Exception:
        return None

def refresh_quotes(force=False):
    now = time.time()
    with lock:
        if not force and now - cache["quote_ts"] < 20:
            return
    data = {}
    for s in merged_stocks():
        q = quote_for(s["symbol"])
        if q:
            data[s["symbol"]] = q
    with lock:
        cache["quotes"] = data
        cache["quote_ts"] = now


def _google_news_rss(query, category, limit=12):
    """Fetch public Google News RSS search results. No API key required."""
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
    items = []
    try:
        r = requests.get(url, timeout=10, headers={"User-Agent": "StockPi/3.0"})
        r.raise_for_status()
        root = ET.fromstring(r.content)
        for item in root.findall(".//item")[:limit]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub = (item.findtext("pubDate") or "").strip()
            if title:
                items.append({
                    "symbol": category,
                    "title": title,
                    "url": link,
                    "published": pub,
                    "category": category
                })
    except Exception:
        pass
    return items

def refresh_news(force=False):
    now = time.time()
    with lock:
        if not force and now - cache["news_ts"] < 600:
            return

    stock_items = []
    for s in merged_stocks():
        sym = s["symbol"]
        try:
            news = yf.Ticker(sym).news or []
            for n in news[:4]:
                c = n.get("content", n)
                title = c.get("title") or n.get("title")
                url = None
                if isinstance(c.get("canonicalUrl"), dict):
                    url = c["canonicalUrl"].get("url")
                url = url or c.get("link") or n.get("link")
                pub = c.get("pubDate") or n.get("providerPublishTime")
                if title:
                    stock_items.append({
                        "symbol": sym,
                        "title": title,
                        "url": url,
                        "published": pub,
                        "category": "PORTFOLIO"
                    })
        except Exception:
            pass

    chip_items = _google_news_rss(
        '"AI chips" OR "AI semiconductor" OR HBM OR GPU OR "data center chips" OR semiconductor',
        "AI CHIPS",
        14
    )

    ai_items = _google_news_rss(
        '"artificial intelligence" OR "generative AI" OR "AI infrastructure"',
        "AI NEWS",
        14
    )

    merged = stock_items[:24] + chip_items[:12] + ai_items[:12]

    seen = set()
    deduped = []
    for item in merged:
        key = " ".join((item.get("title") or "").lower().split())
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    with lock:
        cache["news"] = deduped[:48]
        cache["news_ts"] = now

def load_power_config():
    cfg={"enabled":True,"wake_time":"07:15","sleep_time":"22:30","switch_to_pi_input_on_wake":True}
    try:
        d=json.loads(POWER_CONFIG.read_text())
        if isinstance(d,dict): cfg.update(d)
    except Exception: pass
    return cfg

def save_power_config(cfg):
    POWER_CONFIG.write_text(json.dumps(cfg,indent=2))

def cec_command(command):
    try:
        p=subprocess.run(["cec-client","-s","-d","1"],input=command+"\n",text=True,capture_output=True,timeout=12)
        return p.returncode==0,((p.stdout or "")+(p.stderr or ""))[-1200:]
    except FileNotFoundError:
        return False,"cec-client is not installed"
    except Exception as e:
        return False,str(e)

_power_last_action={"wake":None,"sleep":None}
def power_scheduler_loop():
    while True:
        try:
            cfg=load_power_config(); now=datetime.now(); today=now.strftime("%Y-%m-%d"); hhmm=now.strftime("%H:%M")
            if cfg.get("enabled",True):
                if hhmm==cfg.get("wake_time") and _power_last_action["wake"]!=today:
                    cec_command("on 0"); time.sleep(3)
                    if cfg.get("switch_to_pi_input_on_wake",True): cec_command("as")
                    _power_last_action["wake"]=today
                if hhmm==cfg.get("sleep_time") and _power_last_action["sleep"]!=today:
                    cec_command("standby 0"); _power_last_action["sleep"]=today
        except Exception: pass
        time.sleep(20)

@app.route("/")
def dashboard():
    return render_template("dashboard.html")

@app.route("/settings", methods=["GET", "POST"])
def settings():
    stocks = load_local_stocks()
    if request.method == "POST":
        action = request.form.get("action")
        if action == "add":
            sym = request.form.get("symbol", "").upper().strip()
            if sym and not any(s["symbol"] == sym for s in stocks):
                def f(name):
                    v = request.form.get(name, "").strip()
                    return float(v) if v else None
                stocks.append({"symbol": sym, "buy": f("buy"), "strong": f("strong"), "aggressive": f("aggressive")})
        elif action == "delete":
            sym = request.form.get("symbol")
            stocks = [s for s in stocks if s["symbol"] != sym]
        elif action == "save":
            updated = []
            for i, s in enumerate(stocks):
                sym = request.form.get(f"symbol_{i}", s["symbol"]).upper().strip()
                def f(name):
                    v = request.form.get(f"{name}_{i}", "").strip()
                    return float(v) if v else None
                updated.append({"symbol": sym, "buy": f("buy"), "strong": f("strong"), "aggressive": f("aggressive")})
            stocks = updated
        elif action in ("up","down"):
            idx = int(request.form.get("index", 0))
            j = idx - 1 if action == "up" else idx + 1
            if 0 <= idx < len(stocks) and 0 <= j < len(stocks):
                stocks[idx], stocks[j] = stocks[j], stocks[idx]
        save_local_stocks(stocks)
        return redirect(url_for("settings"))
    return render_template("settings.html", stocks=stocks, cloud_url=CLOUD_CONFIG_URL)

@app.route("/api/quotes")
def api_quotes():
    refresh_quotes()
    with lock:
        return jsonify({"ts": cache["quote_ts"], "quotes": cache["quotes"]})

@app.route("/api/news")
def api_news():
    refresh_news()
    with lock:
        return jsonify({"ts": cache["news_ts"], "news": cache["news"]})

@app.route("/api/stocks")
def api_stocks():
    return jsonify(merged_stocks())

@app.route("/api/cloud-status")
def api_cloud_status():
    refresh_cloud()
    with lock:
        return jsonify({
            "ok": cache["cloud_ok"],
            "updated": cache["cloud_updated"],
            "last_checked": cache["cloud_ts"],
            "error": cache["cloud_error"],
            "url": CLOUD_CONFIG_URL
        })

@app.route("/api/power-settings",methods=["GET","POST"])
def api_power_settings():
    if request.method=="POST":
        data=request.get_json(silent=True) or request.form; cfg=load_power_config()
        if "enabled" in data:
            v=data.get("enabled"); cfg["enabled"]=v if isinstance(v,bool) else str(v).lower() in ("1","true","yes","on")
        if data.get("wake_time"): cfg["wake_time"]=str(data.get("wake_time"))
        if data.get("sleep_time"): cfg["sleep_time"]=str(data.get("sleep_time"))
        if "switch_to_pi_input_on_wake" in data:
            v=data.get("switch_to_pi_input_on_wake"); cfg["switch_to_pi_input_on_wake"]=v if isinstance(v,bool) else str(v).lower() in ("1","true","yes","on")
        save_power_config(cfg); return jsonify({"ok":True,"config":cfg})
    return jsonify(load_power_config())

@app.route("/api/tv/<action>",methods=["POST"])
def api_tv(action):
    if action=="on":
        ok,msg=cec_command("on 0"); time.sleep(2)
        if ok and load_power_config().get("switch_to_pi_input_on_wake",True): cec_command("as")
        return jsonify({"ok":ok,"message":msg})
    if action=="standby":
        ok,msg=cec_command("standby 0"); return jsonify({"ok":ok,"message":msg})
    if action=="input":
        ok,msg=cec_command("as"); return jsonify({"ok":ok,"message":msg})
    return jsonify({"ok":False,"message":"Unknown action"}),400

if __name__ == "__main__":
    threading.Thread(target=power_scheduler_loop,daemon=True).start()
    refresh_cloud(force=True)
    refresh_quotes(force=True)
    refresh_news(force=True)
    app.run(host="0.0.0.0", port=8080, debug=False)
