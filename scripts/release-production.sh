#!/usr/bin/env bash

set -Eeuo pipefail

REPO="${TIANZHILING_REPO_ROOT:-/opt/tianzhiling}"
BRANCH="${1:-}"
TARGET="${2:-}"
PUBLIC_HEALTH="${TIANZHILING_PUBLIC_HEALTH:-https://tianzhiling.chat/api/system/health}"
ADMIN_HEALTH="${TIANZHILING_ADMIN_HEALTH:-https://admin.tianzhiling.chat/admin_api/system/health}"
STABILITY_SECONDS="${TIANZHILING_STABILITY_SECONDS:-120}"
SERVICES=(tzl_node tzl_admin_node tzl_admin_web tzl_nginx)
DEPLOY_STARTED=0
PREVIOUS_COMMIT=""
ADMIN_ASSET_SNAPSHOT=""

declare -A OLD_IMAGES=()
declare -A COMPOSE_IMAGES=()
declare -A OLD_REVISIONS=()

cleanup_admin_asset_snapshot() {
  if [[ -n "$ADMIN_ASSET_SNAPSHOT" && \
    "$ADMIN_ASSET_SNAPSHOT" == /var/tmp/tzl-admin-assets.* && \
    -d "$ADMIN_ASSET_SNAPSHOT" ]]; then
    rm -rf -- "$ADMIN_ASSET_SNAPSHOT"
  fi
}

trap cleanup_admin_asset_snapshot EXIT

fail() {
  printf '[RELEASE_FAILED] phase=%s message=%s\n' "${PHASE:-preflight}" "$*" >&2
  exit 1
}

rollback_runtime() {
  local service
  local rollback_ok=1

  [[ "$DEPLOY_STARTED" -eq 1 ]] || return 0
  set +e
  printf '[ROLLBACK_BEGIN] previous=%s\n' "${PREVIOUS_COMMIT:-unknown}" >&2
  for service in "${SERVICES[@]}"; do
    if [[ -n "${OLD_IMAGES[$service]:-}" && -n "${COMPOSE_IMAGES[$service]:-}" ]]; then
      docker image tag "${OLD_IMAGES[$service]}" "${COMPOSE_IMAGES[$service]}"
    fi
  done
  docker compose --profile prod up -d --no-deps --force-recreate "${SERVICES[@]}"
  for service in "${SERVICES[@]}"; do
    check_container "$service" || rollback_ok=0
  done
  wait_for_node_health tzl_node 'http://127.0.0.1:7001/api/system/health' || rollback_ok=0
  wait_for_node_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health' || rollback_ok=0
  check_pm2_processes tzl_node 4 0 || rollback_ok=0
  check_pm2_processes tzl_admin_node 2 0 || rollback_ok=0
  if [[ "$rollback_ok" -eq 1 ]]; then
    printf '[ROLLBACK_DONE] runtime restored and verified; git remains at %s\n' "$TARGET" >&2
  else
    printf '[ROLLBACK_VERIFY_FAILED] manual recovery required; git remains at %s\n' "$TARGET" >&2
  fi
}

on_error() {
  local rc="$?"
  trap - ERR
  rollback_runtime
  printf '[RELEASE_FAILED] phase=%s target=%s exit=%s\n' "${PHASE:-unknown}" "$TARGET" "$rc" >&2
  exit "$rc"
}
trap on_error ERR

wait_for_node_health() {
  local service="$1"
  local url="$2"
  local attempt

  for attempt in $(seq 1 24); do
    if docker exec "$service" node -e \
      "fetch('$url').then(async r=>{const j=await r.json();const d=j.data||j;if(!r.ok||d.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

wait_for_public_health() {
  local url="$1"
  local attempt

  for attempt in $(seq 1 24); do
    if curl -fsS --max-time 20 "$url" | \
      grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      return 0
    fi
    sleep 5
  done
  return 1
}

check_container() {
  local service="$1"
  local state restarts

  read -r state restarts < <(
    docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$service"
  )
  [[ "$state" == 'running' && "$restarts" == '0' ]]
}

check_pm2_processes() {
  local service="$1"
  local expected="$2"
  local minimum_uptime_ms="${3:-0}"

  docker exec "$service" node -e '
const { execFileSync } = require("child_process");
const expected = Number(process.argv[1]);
const minimumUptimeMs = Number(process.argv[2]);
const processes = JSON.parse(execFileSync("pm2", ["jlist"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}));
const failures = [];
if (processes.length !== expected) {
  failures.push(`count=${processes.length}/${expected}`);
}
for (const processInfo of processes) {
  const env = processInfo.pm2_env || {};
  const uptimeMs = Date.now() - Number(env.pm_uptime || 0);
  const restartTime = Number(env.restart_time || 0);
  const unstableRestarts = Number(env.unstable_restarts || 0);
  if (env.status !== "online" || restartTime !== 0 || unstableRestarts !== 0 || uptimeMs < minimumUptimeMs) {
    failures.push(JSON.stringify({
      pm_id: processInfo.pm_id,
      status: env.status,
      restart_time: restartTime,
      unstable_restarts: unstableRestarts,
      uptime_ms: uptimeMs,
    }));
  }
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
' "$expected" "$minimum_uptime_ms"
}

check_internal_health() {
  local service="$1"
  local url="$2"

  docker exec "$service" node -e \
    "fetch('$url').then(async r=>{const j=await r.json();const d=j.data||j;if(!r.ok||d.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}

wait_for_release_stability() {
  local required_seconds="$1"
  local elapsed=0

  while (( elapsed < required_seconds )); do
    check_container tzl_node
    check_container tzl_admin_node
    check_pm2_processes tzl_node 4 0
    check_pm2_processes tzl_admin_node 2 0
    check_internal_health tzl_node 'http://127.0.0.1:7001/api/system/health'
    check_internal_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health'
    sleep 10
    elapsed=$((elapsed + 10))
  done
  check_pm2_processes tzl_node 4 "$((required_seconds * 1000))"
  check_pm2_processes tzl_admin_node 2 "$((required_seconds * 1000))"
  check_internal_health tzl_node 'http://127.0.0.1:7001/api/system/health'
  check_internal_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health'
}

check_public_health_repeated() {
  local url="$1"
  local attempt

  for attempt in $(seq 1 3); do
    curl -fsS --max-time 20 "$url" | \
      grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'
    if [[ "$attempt" -lt 3 ]]; then sleep 5; fi
  done
}

[[ "$EUID" -eq 0 ]] || fail 'run as root'
[[ "$BRANCH" =~ ^[0-9]{8}$ ]] || fail 'branch must be YYYYMMDD'
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || fail 'target must be a full commit hash'
[[ "$STABILITY_SECONDS" =~ ^[0-9]+$ && "$STABILITY_SECONDS" -ge 60 ]] || \
  fail 'stability window must be at least 60 seconds'

PHASE='preflight'
cd "$REPO"
[[ "$(git symbolic-ref --short HEAD)" == "$BRANCH" ]] || fail 'server branch mismatch'
[[ -z "$(git status --porcelain)" ]] || fail 'server worktree is dirty'

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
git fetch origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
[[ "$(git rev-parse "origin/$BRANCH")" == "$TARGET" ]] || fail 'remote tip mismatch'
git merge-base --is-ancestor "$PREVIOUS_COMMIT" "$TARGET" || fail 'target is not a fast-forward'

for service in "${SERVICES[@]}"; do
  OLD_IMAGES[$service]="$(docker inspect -f '{{.Image}}' "$service")"
  COMPOSE_IMAGES[$service]="$(docker inspect -f '{{.Config.Image}}' "$service")"
  OLD_REVISIONS[$service]="$(
    docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$service"
  )"
  if [[ ! "${OLD_REVISIONS[$service]}" =~ ^[0-9a-f]{40}$ ]]; then
    OLD_REVISIONS[$service]="$PREVIOUS_COMMIT"
  fi
  docker image tag \
    "${OLD_IMAGES[$service]}" \
    "tzl-${service}-rollback:${OLD_REVISIONS[$service]:0:12}"
done

ADMIN_ASSET_SNAPSHOT="$(mktemp -d /var/tmp/tzl-admin-assets.XXXXXX)"
docker cp \
  tzl_admin_web:/usr/share/nginx/html/assets/. \
  "$ADMIN_ASSET_SNAPSHOT/"

git merge --ff-only "$TARGET"
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || fail 'checkout did not reach target'

# Keep runtime telemetry, the container environment, and the immutable image
# label tied to the exact Git target selected for this release.
export RELEASE_VERSION="$TARGET"

PHASE='production-build'
docker compose --profile prod build "${SERVICES[@]}"

PHASE='database-contract'
[[ "$(
  docker compose --profile prod run --rm --no-deps tzl_node \
    sh -lc 'printf %s "${NODE_DB_SYNCHRONIZE:-}"'
)" == 'false' ]]
docker compose --profile prod run --rm --no-deps tzl_node \
  node ./scripts/ensure-conversation-reply-turn-indexes.js --check

PHASE='replace-backends'
DEPLOY_STARTED=1
docker compose --profile prod up -d --no-deps tzl_node tzl_admin_node
wait_for_node_health tzl_node 'http://127.0.0.1:7001/api/system/health'
wait_for_node_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health'

PHASE='voice-runtime'
docker exec tzl_node sh -lc 'command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null'
docker exec tzl_node node -e '
const e=process.env;
const provider=e.NODE_QWEN_VOICE_API_KEY||e.ADMIN_API_QWEN_VOICE_API_KEY||e.DASHSCOPE_API_KEY;
const analysis=e.NODE_VOICE_ANALYSIS_API_KEY||e.DASHSCOPE_API_KEY||e.NODE_QWEN_VOICE_API_KEY;
const cos=e.NODE_TENCENT_COS_SECRET_ID&&e.NODE_TENCENT_COS_SECRET_KEY&&e.NODE_TENCENT_COS_REGION&&e.NODE_TENCENT_COS_BUCKET;
if(!provider||!analysis||!cos) process.exit(1);
'

PHASE='replace-web-and-gateway'
docker compose --profile prod up -d --no-deps tzl_admin_web
docker cp \
  "$ADMIN_ASSET_SNAPSHOT/." \
  tzl_admin_web:/usr/share/nginx/html/assets/
docker exec tzl_admin_web find \
  /usr/share/nginx/html/assets \
  -type f -mtime +30 -delete
check_container tzl_admin_web
docker exec tzl_admin_web wget -q -O /dev/null http://127.0.0.1/health
docker compose --profile prod up -d --no-deps tzl_nginx
docker exec tzl_nginx nginx -t
docker exec tzl_nginx nginx -s reload

PHASE='container-health'
for service in "${SERVICES[@]}"; do
  check_container "$service"
done
check_pm2_processes tzl_node 4 0
check_pm2_processes tzl_admin_node 2 0
[[ "$(docker exec tzl_node printenv RELEASE_VERSION)" == "$TARGET" ]]
[[ "$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' tzl_node)" == "$TARGET" ]]

PHASE='public-health'
wait_for_public_health "$PUBLIC_HEALTH"
wait_for_public_health "$ADMIN_HEALTH"

PHASE='stability-window'
wait_for_release_stability "$STABILITY_SECONDS"
check_public_health_repeated "$PUBLIC_HEALTH"
check_public_health_repeated "$ADMIN_HEALTH"

PHASE='error-scan'
for service in tzl_node tzl_admin_node tzl_nginx; do
  if docker logs --since 5m "$service" 2>&1 | \
    grep -Eiq 'uncaught exception|unhandled rejection|fatal error|heap out of memory|EADDRINUSE|MongoServerError|IndexOptionsConflict|code[^0-9]*85|midway:bootstrap.*exit with code:[^0]'; then
    fail "fatal log detected in $service"
  fi
done

PHASE='final'
[[ -z "$(git status --porcelain)" ]]
[[ "$(git rev-parse HEAD)" == "$TARGET" ]]
DEPLOY_STARTED=0
trap - ERR

printf '[RELEASE_OK]\n'
printf 'branch=%s\ncommit=%s\nprevious_commit=%s\n' "$BRANCH" "$TARGET" "$PREVIOUS_COMMIT"
printf 'release_version=%s\n' "$TARGET"
for service in "${SERVICES[@]}"; do
  docker inspect -f 'service={{.Name}} state={{.State.Status}} restarts={{.RestartCount}} image={{.Image}}' "$service"
  printf 'previous_runtime_%s=%s\n' "$service" "${OLD_REVISIONS[$service]}"
done
printf 'voice_runtime=ready\npublic_health=ok\nadmin_health=ok\n'
printf 'pm2_stability_seconds=%s\n' "$STABILITY_SECONDS"
printf 'admin_legacy_assets=retained_30d\n'
