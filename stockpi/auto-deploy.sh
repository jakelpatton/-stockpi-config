#!/bin/bash
set -Eeuo pipefail

REPO_URL="https://github.com/jakelpatton/-stockpi-config.git"
BRANCH="main"
DEPLOY_USER="${DEPLOY_USER:-pi}"
DEPLOY_HOME="${DEPLOY_HOME:-/home/$DEPLOY_USER}"
APPDIR="$DEPLOY_HOME/farmpi"
SOURCE="$DEPLOY_HOME/.farmpi-deploy"
BACKUP="$DEPLOY_HOME/.farmpi-backup"
STAMP="$APPDIR/.deployed-commit"
LOCK="/run/farmpi-auto-deploy.lock"
SERVICE_FILE="/etc/systemd/system/farm-dashboard.service"
DEPLOY_STARTED=0
LAST_COMMIT=""
ORIGINAL_EXECSTART=""
SERVICE_FILE_CHANGED=0

# Files below are local runtime state, credentials, generated caches, or settings.
# They must never be removed or overwritten by a GitHub code deployment.
RSYNC_EXCLUDES=(
  --exclude 'venv/'
  --exclude 'cameras.env'
  --exclude 'webull.env'
  --exclude '.webull-token/'
  --exclude 'conf/token.txt'
  --exclude 'dashboard_config.json'
  --exclude 'power_schedule.json'
  --exclude 'stocks.json'
  --exclude 'cloud_portfolio_cache.json'
  --exclude 'webull-summary-cache.json'
  --exclude 'quote-cache.json'
  --exclude 'static/webull-activity.json'
  --exclude 'backups/'
  --exclude '.deployed-commit'
  --exclude '__pycache__/'
  --exclude '*.pyc'
)

exec 9>"$LOCK"
flock -n 9 || exit 0

log(){ echo "[farmpi-deploy] $*"; logger -t farmpi-deploy -- "$*" 2>/dev/null || true; }
as_user(){ runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" "$@"; }

restart_kiosk(){
  local uid runtime socket
  uid="$(id -u "$DEPLOY_USER" 2>/dev/null || true)"
  runtime="/run/user/$uid"
  socket=""

  # Avoid a find|grep -q pipeline here. With `set -o pipefail`, grep can exit as
  # soon as it sees a match and make find receive SIGPIPE, incorrectly turning a
  # valid Wayland socket into a failed condition.
  if [[ -n "$uid" && -d "$runtime" ]]; then
    socket="$(find "$runtime" -maxdepth 1 -type s -name 'wayland-*' -print -quit 2>/dev/null || true)"
  fi

  # The wall display is a dedicated local Wayland kiosk. Restarting Chromium after
  # a healthy code deployment prevents a stale/white page from surviving a Flask
  # restart. If nobody is logged into the graphical session, simply skip it.
  if [[ -x "$APPDIR/start-kiosk.sh" && -n "$socket" ]]; then
    log "Refreshing local Chromium kiosk on $(basename "$socket")."
    as_user bash -c "export XDG_RUNTIME_DIR='$runtime'; export WAYLAND_DISPLAY='$(basename "$socket")'; nohup '$APPDIR/start-kiosk.sh' >>/tmp/1838-estate-kiosk-deploy.log 2>&1 </dev/null &"
  else
    log "No active Wayland kiosk session found; display refresh skipped."
  fi
}

restore_previous(){
  local status="${1:-1}"
  set +e
  if [[ "$DEPLOY_STARTED" -eq 1 && -d "$BACKUP" ]]; then
    log "Deployment failed; restoring previous working code while preserving local state."
    as_user rsync -a --delete \
      "${RSYNC_EXCLUDES[@]}" \
      "$BACKUP/" "$APPDIR/"

    # If this deployment changed the systemd runner, put the prior ExecStart back
    # before restarting the rolled-back application. Without this, a failed first
    # run_dashboard.py deployment could restore old code but leave systemd pointing
    # at a file that no longer exists.
    if [[ "$SERVICE_FILE_CHANGED" -eq 1 && -n "$ORIGINAL_EXECSTART" && -f "$SERVICE_FILE" ]]; then
      sed -i "s#^ExecStart=.*#${ORIGINAL_EXECSTART}#" "$SERVICE_FILE"
      systemctl daemon-reload
    fi

    if [[ -n "$LAST_COMMIT" ]]; then
      echo "$LAST_COMMIT" > "$STAMP"
      chown "$DEPLOY_USER" "$STAMP"
    else
      rm -f "$STAMP"
    fi
    systemctl restart farm-dashboard.service
    log "Rollback completed."
  fi
  exit "$status"
}
trap 'restore_previous $?' ERR

if [[ ! -d "$APPDIR" ]]; then
  log "Application directory $APPDIR does not exist; refusing to deploy."
  exit 1
fi
if [[ ! -x "$APPDIR/venv/bin/python" ]]; then
  log "Python virtual environment is missing at $APPDIR/venv; refusing to deploy."
  exit 1
fi

if [[ -f "$SERVICE_FILE" ]]; then
  ORIGINAL_EXECSTART="$(grep '^ExecStart=' "$SERVICE_FILE" | head -n1 || true)"
fi

if [[ ! -d "$SOURCE/.git" ]]; then
  log "Creating deployment checkout."
  rm -rf "$SOURCE"
  as_user git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$SOURCE"
else
  as_user git -C "$SOURCE" remote set-url origin "$REPO_URL"
  as_user git -C "$SOURCE" fetch --quiet --depth 1 origin "$BRANCH"
  as_user git -C "$SOURCE" reset --hard --quiet FETCH_HEAD
  as_user git -C "$SOURCE" clean -fdq
fi

NEW_COMMIT="$(as_user git -C "$SOURCE" rev-parse HEAD)"
LAST_COMMIT="$(cat "$STAMP" 2>/dev/null || true)"

if [[ "$NEW_COMMIT" == "$LAST_COMMIT" ]]; then
  exit 0
fi

if [[ -n "$LAST_COMMIT" ]]; then
  PREVIOUS_LABEL="${LAST_COMMIT:0:12}"
else
  PREVIOUS_LABEL="none"
fi
log "New main commit detected: ${NEW_COMMIT:0:12} (previous $PREVIOUS_LABEL)."

# Validate files that can be checked without starting the dashboard.
python3 -m py_compile "$SOURCE/stockpi/app.py"
for py_file in run_dashboard.py webull_readonly.py camera_motion_server.py webull_activity_service.py; do
  if [[ -f "$SOURCE/stockpi/$py_file" ]]; then
    python3 -m py_compile "$SOURCE/stockpi/$py_file"
  fi
done
for json_file in dashboard_config.json power_schedule.json stocks.json; do
  if [[ -f "$SOURCE/stockpi/$json_file" ]]; then
    python3 -m json.tool "$SOURCE/stockpi/$json_file" >/dev/null
  fi
done
if [[ -f "$SOURCE/portfolio.json" ]]; then
  python3 -m json.tool "$SOURCE/portfolio.json" >/dev/null
fi

# Resolve/install dependency changes before touching the running application.
if [[ -x "$APPDIR/venv/bin/pip" && -f "$SOURCE/stockpi/requirements.txt" ]]; then
  as_user "$APPDIR/venv/bin/pip" install --quiet -r "$SOURCE/stockpi/requirements.txt"
fi

# Snapshot the current deployed CODE. Local credentials/settings are deliberately
# excluded from both backup and sync because deployment must never own them.
rm -rf "$BACKUP"
as_user mkdir -p "$BACKUP"
as_user rsync -a --delete \
  "${RSYNC_EXCLUDES[@]}" \
  --exclude 'auto-deploy.sh' \
  "$APPDIR/" "$BACKUP/"
DEPLOY_STARTED=1

# Sync repository application code while preserving all runtime-local state.
as_user rsync -a --delete \
  "${RSYNC_EXCLUDES[@]}" \
  --exclude 'auto-deploy.sh' \
  "$SOURCE/stockpi/" "$APPDIR/"

# Replace the deployer atomically so the currently running process is never
# modified in place.
if [[ -f "$SOURCE/stockpi/auto-deploy.sh" ]]; then
  as_user cp "$SOURCE/stockpi/auto-deploy.sh" "$APPDIR/.auto-deploy.sh.new"
  as_user chmod +x "$APPDIR/.auto-deploy.sh.new"
  as_user mv "$APPDIR/.auto-deploy.sh.new" "$APPDIR/auto-deploy.sh"
fi

# Migrate existing installations to the nonblocking runner. app.py remains the
# Flask application module; run_dashboard.py starts Flask first and moves slow
# network refreshes to background workers.
if [[ -f "$APPDIR/run_dashboard.py" && -f "$SERVICE_FILE" ]]; then
  if grep -q '^ExecStart=' "$SERVICE_FILE"; then
    NEW_EXECSTART="ExecStart=$APPDIR/venv/bin/python $APPDIR/run_dashboard.py"
    if [[ "$ORIGINAL_EXECSTART" != "$NEW_EXECSTART" ]]; then
      sed -i "s#^ExecStart=.*#${NEW_EXECSTART}#" "$SERVICE_FILE"
      SERVICE_FILE_CHANGED=1
      systemctl daemon-reload
    fi
  fi
fi

as_user "$APPDIR/venv/bin/python" -m py_compile "$APPDIR/app.py"
if [[ -f "$APPDIR/run_dashboard.py" ]]; then
  as_user "$APPDIR/venv/bin/python" -m py_compile "$APPDIR/run_dashboard.py"
fi

echo "$NEW_COMMIT" > "$STAMP"
chown "$DEPLOY_USER" "$STAMP"

systemctl restart farm-dashboard.service

# The hardened runner normally answers in a few seconds. Allow a full minute so
# a slow SD card or package import never causes a false rollback.
healthy=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/api/health >/dev/null 2>&1 || \
     curl -fsS --max-time 2 http://127.0.0.1:8080/ >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" -ne 1 ]]; then
  log "Post-deploy health check failed."
  restore_previous 1
fi

restart_kiosk
DEPLOY_STARTED=0
log "Deployment ${NEW_COMMIT:0:12} is healthy."
exit 0
