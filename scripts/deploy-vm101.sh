#!/usr/bin/env bash
set -Eeuo pipefail

# ---------------------------------------------------------------------------
# GreenWave web app — production deployment to VM101
#
# Deploys the Expo web export from a verified git checkout to the gwgc.cloud
# document root. Must be run interactively, as a normal (non-root) user, on
# VM101 itself, because it requires an interactive `sudo -v` and never
# accepts a sudo password by any other means.
#
# Usage: bash scripts/deploy-vm101.sh
# ---------------------------------------------------------------------------

# ---- fixed deployment parameters ------------------------------------------
readonly TARGET_HOSTNAME_HINT="vm101"
readonly REQUIRED_IP="192.168.1.11"
readonly SOURCE_DIR="/home/ansh/greenwave-deploy-20260827_024823"
readonly SOURCE_DIST="${SOURCE_DIR}/dist"
readonly DEST_DIR="/var/www/greenwave-app/dist"
readonly EXPECTED_BRANCH="main"
readonly EXPECTED_COMMIT="eaa3a6c3c9067a5cf9e92ce9f5bb1f544824a811"
readonly EXPECTED_API_URL="https://api.gwgc.cloud"
readonly FRONTEND_URL="https://gwgc.cloud"
readonly API_HEALTH_URL="https://api.gwgc.cloud/health"
readonly LOG_DIR="/var/log/greenwave-deploy"
readonly NGINX_VHOST="/etc/nginx/sites-enabled/gwgc.cloud"

# Forbidden strings that must never appear in a gwgc.cloud production build.
readonly -a FORBIDDEN_STRINGS=(
  "gwgcservers.ca"
  "www.gwgcservers.ca"
  "mgmt-api.gwgcservers.ca"
  "/api/v1"
)

# Old (Vite) build fingerprints that must not still be live after deploy.
readonly -a OLD_BUILD_ASSETS=(
  "index-YtJM8cwO.js"
  "index-B6G5nuK3.css"
)
readonly OLD_TITLE="GreenWave Recycling Portal"

TS="$(date -u +%Y%m%d_%H%M%S)"
readonly TS
readonly LOGFILE="${LOG_DIR}/deploy-${TS}.log"
readonly BACKUP_DIR="${DEST_DIR}.bak.${TS}"
TMP_LOG="$(mktemp)"
readonly TMP_LOG

STATUS="UNKNOWN"
FAILED_STEP=""

# ---- helpers ----------------------------------------------------------------
log() {
  local line
  line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  echo "$line" | tee -a "$TMP_LOG" >&2
}

abort() {
  FAILED_STEP="$1"
  log "ABORT: ${FAILED_STEP}"
  STATUS="FAIL"
  flush_log || true
  echo
  echo "=================================================================="
  echo "DEPLOYMENT FAILED at step: ${FAILED_STEP}"
  if [[ -f "${LOGFILE}" ]]; then
    echo "Full log: ${LOGFILE}"
  else
    echo "Full log (pre-sudo buffer, not yet promoted to ${LOG_DIR}): ${TMP_LOG}"
  fi
  echo "Rollback (only if the LIVE SITE is broken), restore the last-good backup:"
  echo "  sudo rsync -a --delete '${BACKUP_DIR}/' '${DEST_DIR}/'"
  echo "  sudo chown -R www-data:www-data '${DEST_DIR}'"
  echo "  sudo nginx -t && echo 'nginx config OK (no reload needed for static content)'"
  echo "=================================================================="
  exit 1
}

flush_log() {
  if [[ -w "$LOG_DIR" ]] 2>/dev/null || sudo -n test -d "$LOG_DIR" 2>/dev/null; then
    sudo mkdir -p "$LOG_DIR" 2>/dev/null || true
    sudo touch "$LOGFILE" 2>/dev/null || true
    sudo chown "$(id -u):$(id -g)" "$LOGFILE" 2>/dev/null || true
    cat "$TMP_LOG" > "$LOGFILE" 2>/dev/null || true
  fi
}

trap 'abort "unexpected error on line ${LINENO}"' ERR

# ===========================================================================
# 1. Interactive-terminal precondition
# ===========================================================================
if [[ ! -t 0 ]]; then
  echo "This script requires an interactive terminal (for sudo authentication)." >&2
  exit 1
fi
if [[ "${EUID}" -eq 0 ]]; then
  echo "Do not run this script as root. Run it as your normal user; it calls sudo itself." >&2
  exit 1
fi

log "=== GreenWave VM101 deployment starting ==="

# ===========================================================================
# 2. Target safety check
# ===========================================================================
CURRENT_HOSTNAME="$(hostname)"
CURRENT_IPS="$(hostname -I)"
CURRENT_USER="$(whoami)"
CURRENT_UTC="$(date -u)"

log "hostname:  ${CURRENT_HOSTNAME}"
log "IPs:       ${CURRENT_IPS}"
log "whoami:    ${CURRENT_USER}"
log "date (UTC): ${CURRENT_UTC}"

if [[ " ${CURRENT_IPS} " != *" ${REQUIRED_IP} "* ]]; then
  abort "target identity check failed: ${REQUIRED_IP} not found in 'hostname -I' output (${CURRENT_IPS}). This does not look like ${TARGET_HOSTNAME_HINT}."
fi
log "OK: target host confirmed as ${TARGET_HOSTNAME_HINT} (${REQUIRED_IP} present)"

# ===========================================================================
# 3. Source verification
# ===========================================================================
[[ -d "${SOURCE_DIR}/.git" ]] || abort "source verification: ${SOURCE_DIR}/.git does not exist"
log "OK: .git exists at ${SOURCE_DIR}"

cd "${SOURCE_DIR}"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "${CURRENT_BRANCH}" == "${EXPECTED_BRANCH}" ]] || abort "source verification: branch is '${CURRENT_BRANCH}', expected '${EXPECTED_BRANCH}'"
log "OK: branch = ${EXPECTED_BRANCH}"

if ! git diff --quiet --ignore-submodules -- . ':!.env' 2>>"$TMP_LOG" || ! git diff --cached --quiet 2>>"$TMP_LOG"; then
  abort "source verification: working tree is not clean (git diff shows changes)"
fi
UNTRACKED="$(git status --porcelain --untracked-files=normal | grep -v '^?? \.env$' | grep -v '^?? dist' | grep -v '^?? node_modules' | grep -v '^?? \.expo' || true)"
if [[ -n "${UNTRACKED}" ]]; then
  abort "source verification: unexpected untracked files present:
${UNTRACKED}"
fi
log "OK: working tree clean"

LOCAL_HEAD="$(git rev-parse HEAD)"
log "local HEAD: ${LOCAL_HEAD}"

git fetch --quiet origin "${EXPECTED_BRANCH}" >>"$TMP_LOG" 2>&1 || log "WARN: could not fetch origin (continuing with local HEAD check only)"
REMOTE_HEAD="$(git rev-parse "origin/${EXPECTED_BRANCH}" 2>/dev/null || echo "unknown")"
log "origin/${EXPECTED_BRANCH}: ${REMOTE_HEAD}"

if [[ "${LOCAL_HEAD}" == "${EXPECTED_COMMIT}" ]]; then
  log "OK: HEAD matches expected commit ${EXPECTED_COMMIT}"
elif [[ "${LOCAL_HEAD}" == "${REMOTE_HEAD}" ]]; then
  if [[ "${ALLOW_COMMIT:-}" == "${LOCAL_HEAD}" ]]; then
    log "OK: HEAD (${LOCAL_HEAD}) is newer than expected but matches origin/${EXPECTED_BRANCH}, and was explicitly allowed via ALLOW_COMMIT"
  else
    abort "origin/${EXPECTED_BRANCH} has moved since ${EXPECTED_COMMIT}. Current HEAD ${LOCAL_HEAD} matches origin but was not the expected commit. Re-run with ALLOW_COMMIT=${LOCAL_HEAD} to explicitly deploy it."
  fi
else
  abort "HEAD (${LOCAL_HEAD}) matches neither the expected commit (${EXPECTED_COMMIT}) nor current origin/${EXPECTED_BRANCH} (${REMOTE_HEAD}). Refusing to deploy an unverified commit."
fi

DEPLOY_COMMIT="${LOCAL_HEAD}"

[[ -d "${SOURCE_DIST}" ]] || abort "source verification: ${SOURCE_DIST} does not exist"
log "OK: dist exists at ${SOURCE_DIST}"

# ===========================================================================
# 4. Build verification
# ===========================================================================
[[ -f "${SOURCE_DIST}/index.html" ]] || abort "build verification: index.html missing"
[[ -d "${SOURCE_DIST}/_expo" ]] || abort "build verification: _expo/ missing (not an Expo web export)"
JS_COUNT="$(find "${SOURCE_DIST}/_expo" -name '*.js' | wc -l)"
[[ "${JS_COUNT}" -gt 0 ]] || abort "build verification: no JS assets found under _expo/"
ASSET_COUNT="$(find "${SOURCE_DIST}/assets" -type f 2>/dev/null | wc -l)"
log "OK: index.html, _expo/ (${JS_COUNT} JS files), assets/ (${ASSET_COUNT} files) present"

BUILD_TITLE="$(grep -io '<title>.*</title>' "${SOURCE_DIST}/index.html" || true)"
if [[ "${BUILD_TITLE}" == *"${OLD_TITLE}"* ]]; then
  abort "build verification: index.html still has old title '${OLD_TITLE}'"
fi
log "OK: index.html title = ${BUILD_TITLE}"

if ! grep -rq "${EXPECTED_API_URL}" "${SOURCE_DIST}" 2>/dev/null; then
  abort "build verification: expected API URL ${EXPECTED_API_URL} not found anywhere in build output"
fi
log "OK: ${EXPECTED_API_URL} found in build output"

for bad in "${FORBIDDEN_STRINGS[@]}"; do
  if grep -rq -- "${bad}" "${SOURCE_DIST}" 2>/dev/null; then
    abort "build verification: forbidden string '${bad}' found in build output"
  fi
done
log "OK: no forbidden strings (${FORBIDDEN_STRINGS[*]}) found in build output"

ENTRY_JS="$(find "${SOURCE_DIST}/_expo/static/js/web" -maxdepth 1 -name 'entry-*.js' | head -1)"
if [[ -z "${ENTRY_JS}" ]]; then
  abort "build verification: could not locate entry-*.js web bundle"
fi
if grep -q 'process\.env\.EXPO_PUBLIC' "${ENTRY_JS}"; then
  abort "build verification: raw process.env.EXPO_PUBLIC_* reference found in bundle; build was not produced with env vars inlined"
fi
MOCK_CHECK="$(node -e '
const fs = require("fs");
const s = fs.readFileSync(process.argv[1], "utf8");
const idx = s.indexOf("api.gwgc.cloud");
if (idx === -1) { console.log("NO_MARKER"); process.exit(0); }
const ctx = s.slice(Math.max(0, idx - 200), idx + 50);
const m = ctx.match(/useMock:\(n=([^,]+),/);
if (!m) { console.log("PATTERN_NOT_FOUND"); process.exit(0); }
const val = m[1];
if (val === "\"0\"") { console.log("MOCK_OFF"); }
else if (val === "\"1\"" || val === "\"true\"") { console.log("MOCK_ON"); }
else { console.log("MOCK_INDETERMINATE:" + val); }
' "${ENTRY_JS}")"
log "mock-mode static check: ${MOCK_CHECK}"
case "${MOCK_CHECK}" in
  MOCK_OFF) log "OK: mock mode is disabled in build output" ;;
  *) abort "build verification: could not prove mock mode is disabled (result: ${MOCK_CHECK}). Refusing to deploy a build that may be in mock mode." ;;
esac

log "=== build verification passed for commit ${DEPLOY_COMMIT} ==="

# ===========================================================================
# 5. Sudo authentication (interactive, no password via arguments)
# ===========================================================================
log "Requesting interactive sudo authentication..."
if ! sudo -v; then
  abort "sudo authentication failed or was declined"
fi
log "OK: sudo authenticated"

# ===========================================================================
# 6. Deployment logging (promote temp buffer to the real log file)
# ===========================================================================
sudo mkdir -p "${LOG_DIR}"
sudo touch "${LOGFILE}"
sudo chown "$(id -u):$(id -g)" "${LOGFILE}"
cat "${TMP_LOG}" >> "${LOGFILE}"
log "Deployment log: ${LOGFILE}"
log "commit: ${DEPLOY_COMMIT}"
log "source path: ${SOURCE_DIST}"
log "destination path: ${DEST_DIR}"
log "backup path: ${BACKUP_DIR}"

# ===========================================================================
# 7. Backup current production build
# ===========================================================================
if [[ ! -d "${DEST_DIR}" ]]; then
  abort "backup: ${DEST_DIR} does not exist on this host"
fi
sudo cp -a "${DEST_DIR}" "${BACKUP_DIR}"
[[ -d "${BACKUP_DIR}" ]] || abort "backup: ${BACKUP_DIR} was not created"
BACKUP_COUNT="$(find "${BACKUP_DIR}" -type f | wc -l)"
[[ "${BACKUP_COUNT}" -gt 0 ]] || abort "backup: ${BACKUP_DIR} is empty"
[[ -f "${BACKUP_DIR}/index.html" ]] || abort "backup: index.html missing from backup"
BACKUP_SIZE="$(du -sh "${BACKUP_DIR}" | cut -f1)"
log "OK: backup created at ${BACKUP_DIR} (${BACKUP_COUNT} files, ${BACKUP_SIZE})"

# ===========================================================================
# 8. Copy new build
# ===========================================================================
SRC_COUNT="$(find "${SOURCE_DIST}" -type f | wc -l)"
SRC_SIZE="$(du -sh "${SOURCE_DIST}" | cut -f1)"
log "source build: ${SRC_COUNT} files, ${SRC_SIZE}"

sudo rsync -a --delete "${SOURCE_DIST}/" "${DEST_DIR}/"
log "OK: rsync completed"

[[ -f "${DEST_DIR}/index.html" ]] || abort "post-copy: index.html missing from destination"
[[ -d "${DEST_DIR}/_expo" ]] || abort "post-copy: _expo/ missing from destination"
DEST_COUNT="$(find "${DEST_DIR}" -type f | wc -l)"
DEST_SIZE="$(du -sh "${DEST_DIR}" | cut -f1)"
log "destination build: ${DEST_COUNT} files, ${DEST_SIZE}"
[[ "${DEST_COUNT}" -eq "${SRC_COUNT}" ]] || abort "post-copy: file count mismatch (source ${SRC_COUNT} vs destination ${DEST_COUNT})"

# ===========================================================================
# 9. Verify source == destination (deterministic, not just rsync exit code)
# ===========================================================================
SRC_MANIFEST="$(mktemp)"
DST_MANIFEST="$(mktemp)"
( cd "${SOURCE_DIST}" && find . -type f -exec sha256sum {} \; | sort ) > "${SRC_MANIFEST}"
( cd "${DEST_DIR}" && sudo find . -type f -exec sha256sum {} \; | sort ) > "${DST_MANIFEST}"

if ! diff -q "${SRC_MANIFEST}" "${DST_MANIFEST}" >/dev/null; then
  log "MANIFEST DIFF:"
  diff "${SRC_MANIFEST}" "${DST_MANIFEST}" | tee -a "${LOGFILE}" || true
  abort "verification: destination checksums do not match source checksums"
fi
SRC_HASH="$(sha256sum "${SRC_MANIFEST}" | awk '{print $1}')"
DST_HASH="$(sha256sum "${DST_MANIFEST}" | awk '{print $1}')"
log "OK: source/destination sha256 manifests match (manifest hash ${SRC_HASH})"

DRY_RUN_OUT="$(sudo rsync -a --delete -i --dry-run "${SOURCE_DIST}/" "${DEST_DIR}/" || true)"
if [[ -n "${DRY_RUN_OUT}" ]]; then
  log "rsync dry-run shows residual diffs:"
  echo "${DRY_RUN_OUT}" | tee -a "${LOGFILE}"
  abort "verification: rsync --dry-run reports destination still differs from source"
fi
log "OK: rsync --dry-run confirms destination is identical to source"
rm -f "${SRC_MANIFEST}" "${DST_MANIFEST}"

# ===========================================================================
# 10. Set ownership
# ===========================================================================
sudo chown -R www-data:www-data "${DEST_DIR}"
OWNER_DIR="$(stat -c '%U:%G' "${DEST_DIR}")"
OWNER_FILE="$(stat -c '%U:%G' "${DEST_DIR}/index.html")"
[[ "${OWNER_DIR}" == "www-data:www-data" ]] || abort "ownership: ${DEST_DIR} owner is ${OWNER_DIR}, expected www-data:www-data"
[[ "${OWNER_FILE}" == "www-data:www-data" ]] || abort "ownership: index.html owner is ${OWNER_FILE}, expected www-data:www-data"
log "OK: ownership set to www-data:www-data (dir: $(stat -c '%A %U:%G' "${DEST_DIR}"), index.html: $(stat -c '%A %U:%G' "${DEST_DIR}/index.html"))"

# ===========================================================================
# 11. Nginx — verify only, never edit, never reload unless required
# ===========================================================================
if [[ -f "${NGINX_VHOST}" ]]; then
  VHOST_ROOT="$(grep -E '^\s*root\s+' "${NGINX_VHOST}" | head -1 | awk '{print $2}' | tr -d ';')"
  [[ "${VHOST_ROOT}" == "${DEST_DIR}" ]] || abort "nginx: vhost root is '${VHOST_ROOT}', expected '${DEST_DIR}'"
  log "OK: nginx vhost root confirmed as ${DEST_DIR}"
else
  log "WARN: could not find ${NGINX_VHOST} to confirm root directive (continuing; content is static and path-independent of this check)"
fi

NGINX_TEST_OUT="$(sudo nginx -t 2>&1)" || { log "${NGINX_TEST_OUT}"; abort "nginx -t failed"; }
log "OK: nginx -t passed"
log "${NGINX_TEST_OUT}"
log "Static content replacement does not require a reload; nginx will NOT be reloaded by this script."

# ===========================================================================
# 12. Local VM101 HTTP verification
# ===========================================================================
LOCAL_HTTP_CODE="$(curl -s -o /tmp/greenwave-local-check.html -w '%{http_code}' --resolve "gwgc.cloud:443:127.0.0.1" -k "${FRONTEND_URL}/" || echo "000")"
[[ "${LOCAL_HTTP_CODE}" == "200" ]] || abort "local HTTP verification: got status ${LOCAL_HTTP_CODE} from local nginx"
LOCAL_TITLE="$(grep -io '<title>.*</title>' /tmp/greenwave-local-check.html || true)"
if [[ "${LOCAL_TITLE}" == *"${OLD_TITLE}"* ]]; then
  abort "local HTTP verification: local server is still serving the old title '${OLD_TITLE}'"
fi
for old_asset in "${OLD_BUILD_ASSETS[@]}"; do
  if grep -q -- "${old_asset}" /tmp/greenwave-local-check.html; then
    abort "local HTTP verification: old asset ${old_asset} still referenced"
  fi
done
log "OK: local nginx serves new build (HTTP ${LOCAL_HTTP_CODE}, title: ${LOCAL_TITLE})"
rm -f /tmp/greenwave-local-check.html

log "=== copy, verification, ownership, nginx, and local checks complete ==="

# ===========================================================================
# 13-16: Public / API / routing verification (read-only, no mutation)
# ===========================================================================
PUBLIC_RESP="$(curl -s -i --max-time 15 "${FRONTEND_URL}/" || true)"
PUBLIC_CODE="$(echo "${PUBLIC_RESP}" | head -1 | grep -oE '[0-9]{3}' || echo "000")"
[[ "${PUBLIC_CODE}" == "200" ]] || abort "public verification: https://gwgc.cloud returned ${PUBLIC_CODE}"
PUBLIC_BODY="$(echo "${PUBLIC_RESP}" | sed -n '/^\r*$/,$p' | tail -n +2)"
PUBLIC_TITLE="$(echo "${PUBLIC_BODY}" | grep -io '<title>.*</title>' || true)"
if [[ "${PUBLIC_TITLE}" == *"${OLD_TITLE}"* ]]; then
  abort "public verification: gwgc.cloud is still serving the old title"
fi
for old_asset in "${OLD_BUILD_ASSETS[@]}"; do
  if echo "${PUBLIC_BODY}" | grep -q -- "${old_asset}"; then
    abort "public verification: old asset ${old_asset} is still referenced live"
  fi
done
log "OK: https://gwgc.cloud returns HTTP 200 with new title (${PUBLIC_TITLE})"

PUBLIC_JS_PATH="$(echo "${PUBLIC_BODY}" | grep -oE 'src="[^"]+\.js"' | head -1 | sed 's/src="//;s/"$//')"
if [[ -z "${PUBLIC_JS_PATH}" ]]; then
  abort "public verification: could not find a JS bundle reference in the live index.html"
fi
PUBLIC_JS_URL="${FRONTEND_URL}${PUBLIC_JS_PATH}"
PUBLIC_JS_CODE="$(curl -s -o /tmp/greenwave-live.js -w '%{http_code}' --max-time 15 "${PUBLIC_JS_URL}" || echo "000")"
[[ "${PUBLIC_JS_CODE}" == "200" ]] || abort "public verification: live JS bundle ${PUBLIC_JS_URL} returned ${PUBLIC_JS_CODE}"
grep -q "${EXPECTED_API_URL}" /tmp/greenwave-live.js || abort "live JS verification: ${EXPECTED_API_URL} not found in live bundle"
for bad in "${FORBIDDEN_STRINGS[@]}"; do
  grep -q -- "${bad}" /tmp/greenwave-live.js && abort "live JS verification: forbidden string '${bad}' found in live bundle"
done
log "OK: live JS bundle (${PUBLIC_JS_URL}) contains ${EXPECTED_API_URL} and no forbidden strings"
rm -f /tmp/greenwave-live.js

API_HEALTH_RESP="$(curl -s -i --max-time 15 "${API_HEALTH_URL}" || true)"
API_HEALTH_CODE="$(echo "${API_HEALTH_RESP}" | head -1 | grep -oE '[0-9]{3}' || echo "000")"
[[ "${API_HEALTH_CODE}" == "200" ]] || abort "API verification: ${API_HEALTH_URL} returned ${API_HEALTH_CODE}"
log "OK: ${API_HEALTH_URL} -> HTTP 200"

CORS_RESP="$(curl -s -i --max-time 15 -H "Origin: ${FRONTEND_URL}" "${API_HEALTH_URL}" || true)"
CORS_ORIGIN="$(echo "${CORS_RESP}" | grep -i '^Access-Control-Allow-Origin:' | tr -d '\r' || true)"
if [[ "${CORS_ORIGIN}" != *"${FRONTEND_URL}"* ]]; then
  log "WARN: CORS header check inconclusive: '${CORS_ORIGIN}' (verify manually)"
else
  log "OK: CORS Access-Control-Allow-Origin matches ${FRONTEND_URL}"
fi

for route in /health /jobs /materials /customers /staff /timesheets; do
  RC="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://api.gwgc.cloud${route}" || echo "000")"
  log "route check: https://api.gwgc.cloud${route} -> ${RC}"
  if [[ "${RC}" == "404" ]]; then
    abort "routing verification: ${route} returned 404 (root-route contract broken?)"
  fi
done
log "OK: root-route contract confirmed (no /api/v1 required, no 404s)"

# ===========================================================================
# 19. Management Portal regression — READ ONLY, no mutation
# ===========================================================================
MGMT_FRONTEND_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://www.gwgcservers.ca" || echo "000")"
MGMT_API_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://mgmt-api.gwgcservers.ca" || echo "000")"
log "Management Portal frontend (read-only check): HTTP ${MGMT_FRONTEND_CODE}"
log "Management Portal API (read-only check): HTTP ${MGMT_API_CODE}"
log "No writes, restarts, or config changes were made to the Management Portal or VM105."

STATUS="PASS"
flush_log
log "=== DEPLOYMENT SUCCEEDED ==="
echo
echo "=================================================================="
echo "DEPLOYMENT SUCCEEDED"
echo "  commit:      ${DEPLOY_COMMIT}"
echo "  destination: ${DEST_DIR}"
echo "  backup:      ${BACKUP_DIR}"
echo "  log:         ${LOGFILE}"
echo
echo "Rollback (only if needed):"
echo "  sudo rsync -a --delete '${BACKUP_DIR}/' '${DEST_DIR}/'"
echo "  sudo chown -R www-data:www-data '${DEST_DIR}'"
echo "  sudo nginx -t"
echo "=================================================================="
exit 0
