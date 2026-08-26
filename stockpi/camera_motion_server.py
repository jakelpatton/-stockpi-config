from flask import Flask, jsonify
import os
import re
import threading
import time

import requests
from requests.auth import HTTPDigestAuth

app = Flask(__name__)

AMCREST_NVR_IP = os.environ.get("AMCREST_NVR_IP", "192.168.1.4")
AMCREST_NVR_USER = os.environ.get("AMCREST_NVR_USER", "admin")
AMCREST_NVR_PASSWORD = os.environ.get("AMCREST_NVR_PASSWORD", "")
AMCREST_EVENT_INDEX_OFFSET = int(os.environ.get("AMCREST_EVENT_INDEX_OFFSET", "1"))
WYZE_MOTION_BASE = os.environ.get("WYZE_MOTION_BASE", "http://127.0.0.1:5001")
WYZE_CAMERA_SLUG = os.environ.get("WYZE_CAMERA_SLUG", "farm-backyard-cam")

CAMERAS = {
    1: {"name": "Front Porch", "kind": "amcrest"},
    2: {"name": "Rockhouse Front", "kind": "amcrest"},
    3: {"name": "Rockhouse Back", "kind": "amcrest"},
    4: {"name": "Farm Backyard", "kind": "wyze"},
}

state_lock = threading.Lock()
sequence = 0
latest_event = None
camera_state = {
    channel: {
        "channel": channel,
        "name": meta["name"],
        "kind": meta["kind"],
        "motion": False,
        "event_id": 0,
        "started_at": None,
        "last_motion": None,
        "last_change": None,
        "last_seen": None,
        "source": None,
    }
    for channel, meta in CAMERAS.items()
}

EVENT_RE = re.compile(r"Code=VideoMotion;\s*action=(Start|Stop);\s*index=(\d+)", re.I)


def set_motion(channel, active, source, force_event=False, external_ts=None):
    global sequence, latest_event
    if channel not in camera_state:
        return
    now = time.time()
    with state_lock:
        item = camera_state[channel]
        changed = item["motion"] != bool(active)
        if active and (changed or force_event):
            sequence += 1
            item["event_id"] = sequence
            item["started_at"] = now
            item["last_motion"] = external_ts or now
            latest_event = {
                "event_id": sequence,
                "channel": channel,
                "name": item["name"],
                "kind": item["kind"],
                "started_at": now,
                "source": source,
            }
        if changed:
            item["last_change"] = now
        item["motion"] = bool(active)
        item["last_seen"] = now
        item["source"] = source


def reset_amcrest_motion():
    for channel in (1, 2, 3):
        set_motion(channel, False, "amcrest")


def amcrest_event_loop():
    if not AMCREST_NVR_PASSWORD:
        return
    url = (
        f"http://{AMCREST_NVR_IP}/cgi-bin/eventManager.cgi"
        "?action=attach&codes=[VideoMotion]&heartbeat=5"
    )
    auth = HTTPDigestAuth(AMCREST_NVR_USER, AMCREST_NVR_PASSWORD)
    while True:
        try:
            reset_amcrest_motion()
            with requests.get(url, auth=auth, stream=True, timeout=(6, 25)) as response:
                response.raise_for_status()
                for raw in response.iter_lines(chunk_size=1, decode_unicode=True):
                    if not raw:
                        continue
                    match = EVENT_RE.search(raw.strip())
                    if not match:
                        continue
                    action, index_text = match.groups()
                    channel = int(index_text) + AMCREST_EVENT_INDEX_OFFSET
                    if channel in (1, 2, 3):
                        set_motion(channel, action.lower() == "start", "amcrest")
        except Exception:
            reset_amcrest_motion()
            time.sleep(3)


def extract_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in ("true", "on", "1", "yes", "motion", "active"):
            return True
        if text in ("false", "off", "0", "no", "idle", "none"):
            return False
        return None
    if isinstance(value, dict):
        for key in ("motion", "response", "value", "result", "data"):
            if key in value:
                parsed = extract_bool(value[key])
                if parsed is not None:
                    return parsed
    return None


def extract_number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    if isinstance(value, dict):
        for key in ("motion_ts", "timestamp", "response", "value", "result", "data"):
            if key in value:
                parsed = extract_number(value[key])
                if parsed is not None:
                    return parsed
    return None


def get_bridge_value(path):
    response = requests.get(f"{WYZE_MOTION_BASE}{path}", timeout=4)
    response.raise_for_status()
    try:
        return response.json()
    except ValueError:
        return response.text


def wyze_motion_loop():
    last_ts = None
    hold_until = 0.0
    while True:
        try:
            motion_raw = get_bridge_value(f"/api/{WYZE_CAMERA_SLUG}/motion")
            ts_raw = get_bridge_value(f"/api/{WYZE_CAMERA_SLUG}/motion_ts")
            motion = extract_bool(motion_raw)
            motion_ts = extract_number(ts_raw)
            now = time.time()

            if motion_ts and motion_ts != last_ts:
                last_ts = motion_ts
                # The Wyze Web API supplies motion events but not a dependable
                # local Stop event for every camera. Keep a new event active for
                # up to ten seconds so the display has a useful alert window.
                hold_until = now + 10.0
                set_motion(4, True, "wyze-cloud", force_event=True, external_ts=motion_ts)

            active = bool(motion) or now < hold_until
            set_motion(4, active, "wyze-cloud")
        except Exception:
            # Do not create false alerts if the motion-only Wyze sidecar is down.
            if time.time() >= hold_until:
                set_motion(4, False, "wyze-cloud")
        time.sleep(1.0)


@app.after_request
def cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "amcrest_configured": bool(AMCREST_NVR_PASSWORD),
        "wyze_motion_url": WYZE_MOTION_BASE,
        "camera_count": len(CAMERAS),
    })


@app.route("/api/motion")
def motion():
    with state_lock:
        cameras = [dict(camera_state[channel]) for channel in sorted(camera_state)]
        latest = dict(latest_event) if latest_event else None
    active = [item["channel"] for item in cameras if item["motion"]]
    return jsonify({
        "active": active,
        "latest": latest,
        "cameras": cameras,
        "ts": time.time(),
    })


def start_threads():
    threading.Thread(target=amcrest_event_loop, daemon=True, name="amcrest-motion").start()
    threading.Thread(target=wyze_motion_loop, daemon=True, name="wyze-motion").start()


if __name__ == "__main__":
    start_threads()
    app.run(host="0.0.0.0", port=8091, debug=False, threaded=True)
