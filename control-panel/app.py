#!/usr/bin/env python3
from flask import Flask, jsonify, request, send_from_directory, Response
from pathlib import Path
import json, os, requests, time

BASE = Path(__file__).resolve().parent
ASSETS = BASE / "assets"
CONFIG_PATH = BASE / "control-panel.json"
ENV_PATH = BASE / ".env"


def load_env_file():
    if not ENV_PATH.exists():
        return
    for raw in ENV_PATH.read_text(errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env_file()
FARM_API_BASE = os.environ.get("FARM_API_BASE", "http://farmpi.local:8080").rstrip("/")
HA_URL = os.environ.get("HOME_ASSISTANT_URL", "http://farmpi.local:8123").rstrip("/")
HA_TOKEN = os.environ.get("HOME_ASSISTANT_TOKEN", "").strip()
PORT = int(os.environ.get("CONTROL_PANEL_PORT", "8090"))

DEFAULT_CONFIG = {"entities": {"climate_upstairs": None,"light_main_exterior": None,"light_front_porch": None,"light_rockhouse": None,"water_shutoff": None,"gate": None,"scene_goodnight": None,"scene_away": None,"scene_morning": None}}
app = Flask(__name__, static_folder=None)
http = requests.Session()


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        user = json.loads(CONFIG_PATH.read_text())
        if isinstance(user, dict):
            cfg.update({k:v for k,v in user.items() if k != "entities"})
            if isinstance(user.get("entities"), dict): cfg["entities"].update(user["entities"])
    except Exception: pass
    return cfg


def ha_headers(): return {"Authorization": f"Bearer {HA_TOKEN}", "Content-Type":"application/json"}

def ha_available():
    if not HA_TOKEN: return False
    try: return http.get(f"{HA_URL}/api/", headers=ha_headers(), timeout=2.5).ok
    except Exception: return False

def ha_state(entity_id):
    if not entity_id or not HA_TOKEN: return None
    try:
        r=http.get(f"{HA_URL}/api/states/{entity_id}",headers=ha_headers(),timeout=3)
        return r.json() if r.ok else None
    except Exception: return None

def ha_service(domain, service, data):
    r=http.post(f"{HA_URL}/api/services/{domain}/{service}",headers=ha_headers(),json=data,timeout=5)
    if not r.ok: raise RuntimeError(f"Home Assistant returned {r.status_code}")
    return r.json() if r.content else {}

def entity_domain(entity_id): return (entity_id or "").split(".",1)[0]


def execute_action(action, cfg):
    e=cfg["entities"]
    if action in {"light-main-exterior","light-front-porch","light-rockhouse"}:
        key={"light-main-exterior":"light_main_exterior","light-front-porch":"light_front_porch","light-rockhouse":"light_rockhouse"}[action]
        entity=e.get(key)
        if not entity:return False,"Lighting entity is not mapped"
        ha_service("homeassistant","toggle",{"entity_id":entity});return True,"Light command sent"
    if action=="light-all-off":
        lights=[e.get(k) for k in ("light_main_exterior","light_front_porch","light_rockhouse")];lights=[x for x in lights if x]
        if not lights:return False,"No lighting entities are mapped"
        ha_service("light","turn_off",{"entity_id":lights});return True,"Property lights off"
    if action in {"temp-up","temp-down"}:
        entity=e.get("climate_upstairs")
        if not entity:return False,"Upstairs thermostat is not mapped"
        state=ha_state(entity)
        if not state:return False,"Thermostat state is unavailable"
        target=state.get("attributes",{}).get("temperature")
        if target is None:return False,"Thermostat setpoint is unavailable"
        target=max(55,min(85,float(target)+(1 if action=="temp-up" else -1)))
        ha_service("climate","set_temperature",{"entity_id":entity,"temperature":target});return True,f"Upstairs thermostat set to {target:g}°"
    if action.startswith("mode-"):
        entity=e.get("climate_upstairs")
        if not entity:return False,"Upstairs thermostat is not mapped"
        mode=action.replace("mode-","",1);ha_service("climate","set_hvac_mode",{"entity_id":entity,"hvac_mode":mode});return True,f"Thermostat mode set to {mode}"
    if action=="water-off":
        entity=e.get("water_shutoff")
        if not entity:return False,"Main water shutoff is not mapped"
        domain=entity_domain(entity)
        service={"valve":"close_valve","cover":"close_cover","switch":"turn_off"}.get(domain)
        if not service:return False,f"Unsupported water shutoff entity: {domain}"
        ha_service(domain,service,{"entity_id":entity});return True,"Main water shutoff closed"
    if action in {"gate-open","gate-close"}:
        entity=e.get("gate")
        if not entity:return False,"Gate is not mapped"
        if entity_domain(entity)!="cover":return False,"Gate mapping should be a Home Assistant cover entity"
        ha_service("cover","open_cover" if action=="gate-open" else "close_cover",{"entity_id":entity});return True,"Gate command sent"
    if action in {"goodnight","scene-away","scene-morning"}:
        key={"goodnight":"scene_goodnight","scene-away":"scene_away","scene-morning":"scene_morning"}[action];entity=e.get(key)
        if not entity:return False,"Scene is not mapped"
        domain=entity_domain(entity)
        if domain not in {"scene","script"}:return False,"Scene mapping should be a scene or script entity"
        ha_service(domain,"turn_on",{"entity_id":entity});return True,"Scene activated"
    return False,"Control is not mapped"


@app.get("/")
def index(): return send_from_directory(BASE,"index.html")
@app.get("/victorian.css")
def css(): return send_from_directory(BASE,"victorian.css")
@app.get("/control-panel.js")
def js(): return send_from_directory(BASE,"control-panel.js")
@app.get("/assets/<path:name>")
def assets(name): return send_from_directory(ASSETS,name)

@app.get("/api/home")
def api_home():
    try:
        r=http.get(f"{FARM_API_BASE}/api/home",timeout=5);return Response(r.content,status=r.status_code,content_type=r.headers.get("Content-Type","application/json"))
    except Exception as exc:return jsonify({"ok":False,"error":str(exc)}),503

@app.get("/api/cameras/snapshot/<int:channel>")
def camera_snapshot(channel):
    if channel not in (1,2,3,4):return "",404
    try:
        r=http.get(f"{FARM_API_BASE}/api/cameras/snapshot/{channel}",timeout=8);return Response(r.content,status=r.status_code,content_type=r.headers.get("Content-Type","image/jpeg"),headers={"Cache-Control":"no-store"})
    except Exception:return "",503

@app.get("/api/panel/state")
def panel_state():
    cfg=load_config();online=ha_available();result={"home_assistant":online,"control_mode":"live" if online else "preview","entities":{},"mapped":{}}
    for key,entity in cfg["entities"].items():
        result["mapped"][key]=bool(entity)
        if online and entity:result["entities"][key]=ha_state(entity)
    return jsonify(result)

@app.post("/api/panel/control")
def panel_control():
    action=(request.get_json(silent=True) or {}).get("action","");cfg=load_config()
    if not HA_TOKEN:return jsonify({"executed":False,"message":"Preview mode — Home Assistant token not configured"})
    try:
        executed,message=execute_action(action,cfg);return jsonify({"executed":executed,"message":message})
    except Exception as exc:return jsonify({"executed":False,"message":str(exc)}),502

@app.get("/api/panel/health")
def health():
    cfg=load_config();return jsonify({"ok":True,"farm_api":FARM_API_BASE,"home_assistant":HA_URL,"ha_token_configured":bool(HA_TOKEN),"mapped_entities":sum(1 for x in cfg["entities"].values() if x),"time":int(time.time())})

@app.after_request
def no_cache(response):
    if request.path in ("/","/control-panel.js","/victorian.css"):response.headers["Cache-Control"]="no-cache"
    return response

if __name__=="__main__":app.run(host="0.0.0.0",port=PORT,debug=False,threaded=True)
