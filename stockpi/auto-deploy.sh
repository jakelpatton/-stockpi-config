#!/bin/bash
set -euo pipefail

REPO_URL="https://github.com/jakelpatton/-stockpi-config.git"
BRANCH="main"
DEPLOY_USER="${DEPLOY_USER:-pi}"
DEPLOY_HOME="${DEPLOY_HOME:-/home/$DEPLOY_USER}"
APPDIR="$DEPLOY_HOME/farmpi"
SOURCE="$DEPLOY_HOME/.farmpi-deploy"
BACKUP="$DEPLOY_HOME/.farmpi-backup"
STAMP="$APPDIR/.deployed-commit"
LOCK="/run/farmpi-auto-deploy.lock"

exec 9>"$LOCK"
flock -n 9 || exit 0

log(){ echo "[farmpi-deploy] $*"; logger -t farmpi-deploy -- "$*" 2>/dev/null || true; }
as_user(){ runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" "$@"; }

if [[ ! -d "$APPDIR" ]]; then
  log "Application directory $APPDIR does not exist; refusing to deploy."
  exit 1
fi
if [[ ! -x "$APPDIR/venv/bin/python" ]]; then
  log "Python virtual environment is missing at $APPDIR/venv; refusing to deploy."
  exit 1
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

# Validate files that can be checked without importing app dependencies.
python3 -m py_compile "$SOURCE/stockpi/app.py"
for json_file in dashboard_config.json power_schedule.json stocks.json; do
  if [[ -f "$SOURCE/stockpi/$json_file" ]]; then
    python3 -m json.tool "$SOURCE/stockpi/$json_file" >/dev/null
  fi
done
if [[ -f "$SOURCE/portfolio.json" ]]; then
  python3 -m json.tool "$SOURCE/portfolio.json" >/dev/null
fi

# Snapshot the current deployment so a failed health check can roll back.
rm -rf "$BACKUP"
as_user mkdir -p "$BACKUP"
as_user rsync -a --delete \
  --exclude 'venv/' \
  --exclude 'cameras.env' \
  --exclude 'dashboard_config.json' \
  --exclude 'power_schedule.json' \
  --exclude '.deployed-commit' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "$APPDIR/" "$BACKUP/"

# Sync repository app files while preserving private/runtime-local state.
# auto-deploy.sh is replaced atomically after the main sync so the currently
# executing script is never modified in place.
as_user rsync -a --delete \
  --exclude 'venv/' \
  --exclude 'cameras.env' \
  --exclude 'dashboard_config.json' \
  --exclude 'power_schedule.json' \
  --exclude '.deployed-commit' \
  --exclude 'auto-deploy.sh' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "$SOURCE/stockpi/" "$APPDIR/"

if [[ -f "$SOURCE/stockpi/auto-deploy.sh" ]]; then
  as_user cp "$SOURCE/stockpi/auto-deploy.sh" "$APPDIR/.auto-deploy.sh.new"
  as_user chmod +x "$APPDIR/.auto-deploy.sh.new"
  as_user mv "$APPDIR/.auto-deploy.sh.new" "$APPDIR/auto-deploy.sh"
fi

if [[ -x "$APPDIR/venv/bin/pip" && -f "$APPDIR/requirements.txt" ]]; then
  as_user "$APPDIR/venv/bin/pip" install --quiet -r "$APPDIR/requirements.txt"
fi

as_user "$APPDIR/venv/bin/python" -m py_compile "$APPDIR/app.py"
echo "$NEW_COMMIT" > "$STAMP"
chown "$DEPLOY_USER":"$DEPLOY_USER" "$STAMP"

systemctl restart farm-dashboard.service

healthy=0
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/ >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [[ "$healthy" -eq 1 ]]; then
  log "Deployment ${NEW_COMMIT:0:12} is healthy."
  exit 0
fi

log "Health check failed; rolling back to previous deployment."
as_user rsync -a --delete \
  --exclude 'venv/' \
  --exclude 'cameras.env' \
  --exclude 'dashboard_config.json' \
  --exclude 'power_schedule.json' \
  --exclude '.deployed-commit' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "$BACKUP/" "$APPDIR/"

if [[ -n "$LAST_COMMIT" ]]; then
  echo "$LAST_COMMIT" > "$STAMP"
else
  rm -f "$STAMP"
fi
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$APPDIR" "$BACKUP" "$SOURCE"
systemctl restart farm-dashboard.service
log "Rollback completed."
exit 1
