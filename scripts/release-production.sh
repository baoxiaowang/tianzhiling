#!/usr/bin/env bash

set -Eeuo pipefail

REPO="${TIANZHILING_REPO_ROOT:-/opt/tianzhiling}"
COMMAND="${1:-release}"
PROGRESS_FILE="${TIANZHILING_RELEASE_PROGRESS_FILE:-/var/tmp/tianzhiling-release-progress.env}"
if [[ "$COMMAND" == 'progress' ]]; then
  if [[ -f "$PROGRESS_FILE" ]]; then cat "$PROGRESS_FILE"; else printf 'state=idle\n'; fi
  exit 0
elif [[ "$COMMAND" == 'plan' ]]; then
  BRANCH="${2:-}"
  TARGET="${3:-}"
  PLAN_ONLY=1
else
  BRANCH="$COMMAND"
  TARGET="${2:-}"
  COMMAND='release'
  PLAN_ONLY=0
fi
PUBLIC_HEALTH="${TIANZHILING_PUBLIC_HEALTH:-https://tianzhiling.chat/api/system/health}"
ADMIN_HEALTH="${TIANZHILING_ADMIN_HEALTH:-https://admin.tianzhiling.chat/admin_api/system/health}"
STABILITY_SECONDS="${TIANZHILING_STABILITY_SECONDS:-120}"
ALL_SERVICES=(tzl_node tzl_memory_worker tzl_admin_node tzl_admin_web tzl_nginx)
SERVICES=()
DEPLOY_STARTED=0
PREVIOUS_COMMIT=""
ADMIN_ASSET_SNAPSHOT=""
PROTECTED_DIRTY_BASELINE=""
PHASE=""
PHASE_STARTED_AT=0

declare -A OLD_IMAGES=()
declare -A COMPOSE_IMAGES=()
declare -A OLD_REVISIONS=()
declare -A SELECTED_SERVICES=()
declare -A SERVICE_EXISTED=()

write_progress() {
  local state="$1"
  local temporary="${PROGRESS_FILE}.$$"
  {
    printf 'state=%s\n' "$state"
    printf 'phase=%s\n' "${PHASE:-none}"
    printf 'branch=%s\n' "${BRANCH:-}"
    printf 'target=%s\n' "${TARGET:-}"
    printf 'previous_commit=%s\n' "${PREVIOUS_COMMIT:-}"
    printf 'services=%s\n' "${SERVICES[*]:-}"
    printf 'updated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$temporary"
  mv "$temporary" "$PROGRESS_FILE"
}

release_event() {
  local status="$1"
  shift
  printf '[RELEASE_EVENT] time=%s phase=%s status=%s %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${PHASE:-none}" "$status" "$*"
}

set_phase() {
  local next="$1"
  local now
  now="$(date +%s)"
  if [[ -n "$PHASE" && "$PHASE_STARTED_AT" -gt 0 ]]; then
    release_event complete "elapsed_seconds=$((now - PHASE_STARTED_AT))"
  fi
  PHASE="$next"
  PHASE_STARTED_AT="$now"
  write_progress running
  release_event begin
}

select_service() {
  SELECTED_SERVICES["$1"]=1
}

service_selected() {
  [[ "${SELECTED_SERVICES[$1]:-0}" == '1' ]]
}

select_release_services() {
  local path service

  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      apps/node/test/*|apps/admin-node/test/*|apps/admin/test/*|apps/weapp/*|*/test/*|*/tests/*|*.md|AGENTS.md|docs/*|reports/*|.github/*|release-state/*)
        ;;
      scripts/init-admin-node.sh|scripts/prd-init-admin-node.sh)
        select_service tzl_admin_node
        ;;
      scripts/backfill-*.js)
        select_service tzl_node
        ;;
      scripts/release-production.sh|scripts/dev-*|scripts/docker-*|scripts/prd-*|scripts/check-brand-sync.mjs)
        ;;
      apps/node/*)
        select_service tzl_node
        select_service tzl_memory_worker
        ;;
      apps/admin-node/*)
        select_service tzl_admin_node
        ;;
      apps/admin/*)
        select_service tzl_admin_web
        ;;
      apps/gateway/*)
        select_service tzl_nginx
        ;;
      packages/entities/*)
        select_service tzl_node
        select_service tzl_memory_worker
        select_service tzl_admin_node
        ;;
      packages/shared/*)
        select_service tzl_node
        select_service tzl_memory_worker
        select_service tzl_admin_node
        select_service tzl_admin_web
        ;;
      package.json|pnpm-lock.yaml|pnpm-workspace.yaml|docker-compose*.yml|.dockerignore|tsconfig*.json)
        for service in "${ALL_SERVICES[@]}"; do select_service "$service"; done
        ;;
      *)
        printf '[RELEASE_SCOPE_FALLBACK] unclassified_path=%s action=build_all\n' "$path" >&2
        for service in "${ALL_SERVICES[@]}"; do select_service "$service"; done
        ;;
    esac
  done < <(git -c core.quotepath=false diff --name-only "$PREVIOUS_COMMIT" "$TARGET")

  for service in "${ALL_SERVICES[@]}"; do
    if service_selected "$service"; then SERVICES+=("$service"); fi
  done
  [[ "${#SERVICES[@]}" -gt 0 ]] || fail 'target has no production runtime changes'
}

cleanup_admin_asset_snapshot() {
  if [[ -n "$ADMIN_ASSET_SNAPSHOT" && \
    "$ADMIN_ASSET_SNAPSHOT" == /var/tmp/tzl-admin-assets.* && \
    -d "$ADMIN_ASSET_SNAPSHOT" ]]; then
    rm -rf -- "$ADMIN_ASSET_SNAPSHOT"
  fi
  if [[ -n "$PROTECTED_DIRTY_BASELINE" && \
    "$PROTECTED_DIRTY_BASELINE" == /var/tmp/tzl-protected-dirty.* && \
    -f "$PROTECTED_DIRTY_BASELINE" ]]; then
    rm -f -- "$PROTECTED_DIRTY_BASELINE"
  fi
}

trap cleanup_admin_asset_snapshot EXIT

fail() {
  release_event failed "message=$*" >&2
  write_progress failed
  printf '[RELEASE_FAILED] phase=%s message=%s\n' "${PHASE:-preflight}" "$*" >&2
  exit 1
}

capture_protected_dirty_manifest() {
  local output="$1"
  local line status path digest

  : >"$output"
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    status="${line:0:2}"
    path="${line:3}"
    case "$status" in
      ' M'|'??') ;;
      *) fail "unsupported production worktree change: $status $path" ;;
    esac
    case "$path" in
      apps/gateway/ssl/admin.tianzhiling.chat_nginx/admin.tianzhiling.chat.key|\
      apps/gateway/ssl/admin.tianzhiling.chat_nginx/admin.tianzhiling.chat_bundle.crt|\
      apps/gateway/ssl/admin.tianzhiling.chat_nginx/admin.tianzhiling.chat.key.bak.[0-9]*|\
      apps/gateway/ssl/admin.tianzhiling.chat_nginx/admin.tianzhiling.chat_bundle.crt.bak.[0-9]*|\
      apps/gateway/ssl/tianzhiling.chat_nginx/tianzhiling.chat.key|\
      apps/gateway/ssl/tianzhiling.chat_nginx/tianzhiling.chat_bundle.crt|\
      apps/gateway/ssl/tianzhiling.chat_nginx/tianzhiling.chat.key.bak.[0-9]*|\
      apps/gateway/ssl/tianzhiling.chat_nginx/tianzhiling.chat_bundle.crt.bak.[0-9]*) ;;
      *) fail "production worktree has a non-certificate change: $path" ;;
    esac
    [[ -f "$path" ]] || fail "protected production file is missing: $path"
    digest="$(sha256sum "$path" | awk '{print $1}')"
    printf '%s\t%s\t%s\n' "$status" "$path" "$digest" >>"$output"
  done < <(git -c core.quotepath=false status --porcelain --untracked-files=all)
  sort -o "$output" "$output"
}

verify_protected_dirty_unchanged() {
  local current

  [[ -n "$PROTECTED_DIRTY_BASELINE" ]] || return 0
  current="$(mktemp /var/tmp/tzl-protected-dirty-current.XXXXXX)"
  capture_protected_dirty_manifest "$current"
  if ! cmp -s "$PROTECTED_DIRTY_BASELINE" "$current"; then
    rm -f -- "$current"
    fail 'protected certificate worktree state changed during release'
  fi
  rm -f -- "$current"
}

rollback_runtime() {
  local service
  local rollback_ok=1
  local rollback_services=()

  [[ "$DEPLOY_STARTED" -eq 1 ]] || return 0
  set +e
  printf '[ROLLBACK_BEGIN] previous=%s\n' "${PREVIOUS_COMMIT:-unknown}" >&2
  for service in "${SERVICES[@]}"; do
    if [[ "${SERVICE_EXISTED[$service]:-0}" == '1' ]]; then
      rollback_services+=("$service")
    fi
    if [[ -n "${OLD_IMAGES[$service]:-}" && -n "${COMPOSE_IMAGES[$service]:-}" ]]; then
      docker image tag "${OLD_IMAGES[$service]}" "${COMPOSE_IMAGES[$service]}"
    fi
  done
  if [[ "${#rollback_services[@]}" -gt 0 ]]; then
    docker compose --profile prod up -d --no-deps --force-recreate "${rollback_services[@]}"
  fi
  for service in "${SERVICES[@]}"; do
    if [[ "${SERVICE_EXISTED[$service]:-0}" != '1' ]]; then
      docker compose --profile prod rm -sf "$service"
    fi
  done
  if service_selected tzl_node || service_selected tzl_admin_node; then
    docker exec tzl_nginx nginx -t || rollback_ok=0
    docker exec tzl_nginx nginx -s reload || rollback_ok=0
  fi
  for service in "${SERVICES[@]}"; do
    if [[ "${SERVICE_EXISTED[$service]:-0}" != '1' ]]; then continue; fi
    check_container "$service" || rollback_ok=0
  done
  if service_selected tzl_node; then
    wait_for_node_health tzl_node 'http://127.0.0.1:7001/api/system/health' || rollback_ok=0
    check_pm2_processes tzl_node 4 0 || rollback_ok=0
  fi
  if service_selected tzl_memory_worker && [[ "${SERVICE_EXISTED[tzl_memory_worker]:-0}" == '1' ]]; then
    wait_for_node_health tzl_memory_worker 'http://127.0.0.1:7001/api/system/health' || rollback_ok=0
    check_pm2_processes tzl_memory_worker 1 0 || rollback_ok=0
  fi
  if service_selected tzl_admin_node; then
    wait_for_node_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health' || rollback_ok=0
    check_pm2_processes tzl_admin_node 2 0 || rollback_ok=0
  fi
  if [[ "$rollback_ok" -eq 1 ]]; then
    printf '[ROLLBACK_DONE] runtime restored and verified; git remains at %s\n' "$TARGET" >&2
  else
    printf '[ROLLBACK_VERIFY_FAILED] manual recovery required; git remains at %s\n' "$TARGET" >&2
  fi
}

on_error() {
  local rc="$?"
  trap - ERR
  release_event failed "exit=$rc" >&2
  write_progress failed
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
  local maximum_restart_time="${4:-5}"

  docker exec "$service" node -e '
const { execFileSync } = require("child_process");
const expected = Number(process.argv[1]);
const minimumUptimeMs = Number(process.argv[2]);
const maximumRestartTime = Number(process.argv[3]);
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
  if (env.status !== "online" || restartTime > maximumRestartTime || unstableRestarts !== 0 || uptimeMs < minimumUptimeMs) {
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
' "$expected" "$minimum_uptime_ms" "$maximum_restart_time"
}

pm2_restart_signature() {
  local service="$1"

  docker exec "$service" node -e '
const { execFileSync } = require("child_process");
const processes = JSON.parse(execFileSync("pm2", ["jlist"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
}));
console.log(processes
  .map(processInfo => `${processInfo.pm_id}:${Number(processInfo.pm2_env?.restart_time || 0)}`)
  .sort()
  .join(","));
'
}

check_internal_health() {
  local service="$1"
  local url="$2"

  docker exec "$service" node -e \
    "fetch('$url').then(async r=>{const j=await r.json();const d=j.data||j;if(!r.ok||d.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
}

check_node_runtime_contract() {
  local service="$1"
  local expected_role="$2"
  local expected_memory_workers="$3"
  local expected_reply_workers="$4"
  local expected_concurrency="$5"

  docker exec "$service" node -e '
const [url, expectedRole, expectedMemory, expectedReply, expectedConcurrency] = process.argv.slice(1);
fetch(url).then(async response => {
  const body = await response.json();
  const data = body.data || body;
  const runtime = data.runtime || {};
  const workers = runtime.workers || {};
  const actual = {
    role: runtime.role,
    memoryWorkers: Number(workers.memoryPipeline || 0),
    replyWorkers: Number(workers.conversationReply || 0),
    concurrency: Number(runtime.memoryWorkerConcurrency || 0),
  };
  if (!response.ok ||
      actual.role !== expectedRole ||
      actual.memoryWorkers !== Number(expectedMemory) ||
      actual.replyWorkers !== Number(expectedReply) ||
      actual.concurrency !== Number(expectedConcurrency)) {
    console.error(JSON.stringify({ expected: {
      role: expectedRole,
      memoryWorkers: Number(expectedMemory),
      replyWorkers: Number(expectedReply),
      concurrency: Number(expectedConcurrency),
    }, actual }));
    process.exit(1);
  }
}).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
' 'http://127.0.0.1:7001/api/system/health' \
    "$expected_role" "$expected_memory_workers" "$expected_reply_workers" \
    "$expected_concurrency"
}

wait_for_release_stability() {
  local required_seconds="$1"
  local elapsed=0
  local node_restart_baseline='' memory_restart_baseline='' admin_restart_baseline=''

  if service_selected tzl_node; then node_restart_baseline="$(pm2_restart_signature tzl_node)"; fi
  if service_selected tzl_memory_worker; then memory_restart_baseline="$(pm2_restart_signature tzl_memory_worker)"; fi
  if service_selected tzl_admin_node; then admin_restart_baseline="$(pm2_restart_signature tzl_admin_node)"; fi
  if ! service_selected tzl_node && ! service_selected tzl_memory_worker && ! service_selected tzl_admin_node; then return 0; fi

  while (( elapsed < required_seconds )); do
    if service_selected tzl_node; then
      check_container tzl_node
      check_pm2_processes tzl_node 4 0
      check_internal_health tzl_node 'http://127.0.0.1:7001/api/system/health'
    fi
    if service_selected tzl_memory_worker; then
      check_container tzl_memory_worker
      check_pm2_processes tzl_memory_worker 1 0
      check_internal_health tzl_memory_worker 'http://127.0.0.1:7001/api/system/health'
    fi
    if service_selected tzl_admin_node; then
      check_container tzl_admin_node
      check_pm2_processes tzl_admin_node 2 0
      check_internal_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health'
    fi
    sleep 10
    elapsed=$((elapsed + 10))
    release_event progress "elapsed_seconds=$elapsed total_seconds=$required_seconds"
    write_progress running
  done
  if service_selected tzl_node; then
    check_pm2_processes tzl_node 4 "$((required_seconds * 1000))"
    [[ "$(pm2_restart_signature tzl_node)" == "$node_restart_baseline" ]]
    check_internal_health tzl_node 'http://127.0.0.1:7001/api/system/health'
  fi
  if service_selected tzl_memory_worker; then
    check_pm2_processes tzl_memory_worker 1 "$((required_seconds * 1000))"
    [[ "$(pm2_restart_signature tzl_memory_worker)" == "$memory_restart_baseline" ]]
    check_internal_health tzl_memory_worker 'http://127.0.0.1:7001/api/system/health'
  fi
  if service_selected tzl_admin_node; then
    check_pm2_processes tzl_admin_node 2 "$((required_seconds * 1000))"
    [[ "$(pm2_restart_signature tzl_admin_node)" == "$admin_restart_baseline" ]]
    check_internal_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health'
  fi
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

if [[ "$PLAN_ONLY" -eq 0 ]]; then [[ "$EUID" -eq 0 ]] || fail 'run as root'; fi
[[ "$BRANCH" =~ ^[0-9]{8}$ ]] || fail 'branch must be YYYYMMDD'
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || fail 'target must be a full commit hash'
[[ "$STABILITY_SECONDS" =~ ^[0-9]+$ && "$STABILITY_SECONDS" -ge 60 ]] || \
  fail 'stability window must be at least 60 seconds'

set_phase preflight
cd "$REPO"
[[ "$(git symbolic-ref --short HEAD)" == "$BRANCH" ]] || fail 'server branch mismatch'
if [[ -n "$(git status --porcelain)" ]]; then
  [[ "${TIANZHILING_ALLOW_PROTECTED_CERT_DIRTY:-0}" == '1' ]] || \
    fail 'server worktree is dirty'
  PROTECTED_DIRTY_BASELINE="$(mktemp /var/tmp/tzl-protected-dirty.XXXXXX)"
  capture_protected_dirty_manifest "$PROTECTED_DIRTY_BASELINE"
  printf '[PROTECTED_DIRTY_ACCEPTED] certificate files=%s\n' \
    "$(wc -l <"$PROTECTED_DIRTY_BASELINE" | tr -d ' ')"
fi

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
git fetch --force origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
[[ "$(git rev-parse "origin/$BRANCH")" == "$TARGET" ]] || fail 'remote tip mismatch'
git merge-base --is-ancestor "$PREVIOUS_COMMIT" "$TARGET" || fail 'target is not a fast-forward'
select_release_services
printf '[RELEASE_SCOPE] services=%s\n' "${SERVICES[*]}"
if [[ "$PLAN_ONLY" -eq 1 ]]; then
  printf '[RELEASE_PLAN_OK]\n'
  printf 'branch=%s\ntarget=%s\nprevious_commit=%s\nservices=%s\n' \
    "$BRANCH" "$TARGET" "$PREVIOUS_COMMIT" "${SERVICES[*]}"
  git diff --name-only "$PREVIOUS_COMMIT" "$TARGET" | sed 's/^/changed_file=/'
  write_progress planned
  release_event complete "services=${SERVICES[*]}"
  exit 0
fi

for service in "${SERVICES[@]}"; do
  if ! docker inspect "$service" >/dev/null 2>&1; then
    SERVICE_EXISTED[$service]=0
    continue
  fi
  SERVICE_EXISTED[$service]=1
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

if service_selected tzl_admin_web; then
  ADMIN_ASSET_SNAPSHOT="$(mktemp -d /var/tmp/tzl-admin-assets.XXXXXX)"
  docker cp \
    tzl_admin_web:/usr/share/nginx/html/assets/. \
    "$ADMIN_ASSET_SNAPSHOT/"
fi

git merge --ff-only "$TARGET"
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || fail 'checkout did not reach target'

# Keep runtime telemetry, the container environment, and the immutable image
# label tied to the exact Git target selected for this release.
export RELEASE_VERSION="$TARGET"

set_phase production-build
for service in "${SERVICES[@]}"; do
  if [[ "$service" == 'tzl_memory_worker' ]]; then continue; fi
  BUILD_STARTED_AT="$(date +%s)"
  release_event service_begin "service=$service"
  if [[ "$service" == 'tzl_admin_web' || "$service" == 'tzl_admin_node' ]]; then
    # The admin bundle and admin-node previously remained stale under Docker layer caching.
    docker compose --profile prod build --no-cache "$service"
  else
    docker compose --profile prod build "$service"
  fi
  release_event service_complete "service=$service elapsed_seconds=$(($(date +%s) - BUILD_STARTED_AT))"
done

if service_selected tzl_node; then
  set_phase database-contract
  [[ "$(
    docker compose --profile prod run --rm --no-deps tzl_node \
      sh -lc 'printf %s "${NODE_DB_SYNCHRONIZE:-}"'
  )" == 'false' ]]
  docker compose --profile prod run --rm --no-deps tzl_node \
    node ./scripts/ensure-conversation-reply-turn-indexes.js --check
  docker compose --profile prod run --rm --no-deps tzl_node \
    node ./scripts/ensure-memory-system-indexes.js --check
  docker compose --profile prod run --rm --no-deps tzl_node \
    node ./scripts/ensure-milvus-v2-collection.js --check
fi

set_phase replace-backends
DEPLOY_STARTED=1
BACKEND_SERVICES=()
if service_selected tzl_node; then BACKEND_SERVICES+=(tzl_node); fi
if service_selected tzl_memory_worker; then BACKEND_SERVICES+=(tzl_memory_worker); fi
if service_selected tzl_admin_node; then BACKEND_SERVICES+=(tzl_admin_node); fi
if [[ "${#BACKEND_SERVICES[@]}" -gt 0 ]]; then
  docker compose --profile prod up -d --no-deps "${BACKEND_SERVICES[@]}"
fi
if service_selected tzl_node; then
  wait_for_node_health tzl_node 'http://127.0.0.1:7001/api/system/health'
  check_node_runtime_contract tzl_node web 0 1 1
fi
if service_selected tzl_memory_worker; then
  wait_for_node_health tzl_memory_worker 'http://127.0.0.1:7001/api/system/health'
  check_node_runtime_contract tzl_memory_worker memory-worker 1 0 1
fi
if service_selected tzl_admin_node; then
  wait_for_node_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health'
fi

if service_selected tzl_node; then
  set_phase voice-runtime
  docker exec tzl_node sh -lc 'command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null'
  docker exec tzl_node node -e '
const e=process.env;
const provider=e.NODE_QWEN_VOICE_API_KEY||e.ADMIN_API_QWEN_VOICE_API_KEY||e.DASHSCOPE_API_KEY;
const analysis=e.NODE_VOICE_ANALYSIS_API_KEY||e.DASHSCOPE_API_KEY||e.NODE_QWEN_VOICE_API_KEY;
const cos=e.NODE_TENCENT_COS_SECRET_ID&&e.NODE_TENCENT_COS_SECRET_KEY&&e.NODE_TENCENT_COS_REGION&&e.NODE_TENCENT_COS_BUCKET;
if(!provider||!analysis||!cos) process.exit(1);
'
fi

set_phase replace-web-and-gateway
if service_selected tzl_admin_web; then
  docker compose --profile prod up -d --no-deps tzl_admin_web
  docker cp \
    "$ADMIN_ASSET_SNAPSHOT/." \
    tzl_admin_web:/usr/share/nginx/html/assets/
  docker exec tzl_admin_web find \
    /usr/share/nginx/html/assets \
    -type f -mtime +30 -delete
  check_container tzl_admin_web
  docker exec tzl_admin_web wget -q -O /dev/null http://127.0.0.1/health
fi
if service_selected tzl_nginx; then
  docker compose --profile prod up -d --no-deps tzl_nginx
  docker exec tzl_nginx nginx -t
  docker exec tzl_nginx nginx -s reload
elif [[ "${#BACKEND_SERVICES[@]}" -gt 0 ]]; then
  # Re-resolve backend container addresses without rebuilding the gateway image.
  docker exec tzl_nginx nginx -t
  docker exec tzl_nginx nginx -s reload
fi

set_phase container-health
for service in "${SERVICES[@]}"; do
  check_container "$service"
done
if service_selected tzl_node; then check_pm2_processes tzl_node 4 0; fi
if service_selected tzl_memory_worker; then check_pm2_processes tzl_memory_worker 1 0; fi
if service_selected tzl_node; then check_node_runtime_contract tzl_node web 0 1 1; fi
if service_selected tzl_memory_worker; then check_node_runtime_contract tzl_memory_worker memory-worker 1 0 1; fi
if service_selected tzl_admin_node; then check_pm2_processes tzl_admin_node 2 0; fi
for service in "${SERVICES[@]}"; do
  [[ "$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$service")" == "$TARGET" ]]
done

set_phase public-health
wait_for_public_health "$PUBLIC_HEALTH"
wait_for_public_health "$ADMIN_HEALTH"

set_phase stability-window
wait_for_release_stability "$STABILITY_SECONDS"
check_public_health_repeated "$PUBLIC_HEALTH"
check_public_health_repeated "$ADMIN_HEALTH"

set_phase error-scan
LOG_SERVICES=("${SERVICES[@]}")
if [[ "${#BACKEND_SERVICES[@]}" -gt 0 ]] && ! service_selected tzl_nginx; then
  LOG_SERVICES+=(tzl_nginx)
fi
for service in "${LOG_SERVICES[@]}"; do
  if docker logs --since 5m "$service" 2>&1 | \
    grep -Eiq 'uncaught exception|unhandled rejection|fatal error|heap out of memory|EADDRINUSE|MongoServerError|IndexOptionsConflict|code[^0-9]*85|midway:bootstrap.*exit with code:[^0]'; then
    fail "fatal log detected in $service"
  fi
done

set_phase final
if [[ -n "$PROTECTED_DIRTY_BASELINE" ]]; then
  verify_protected_dirty_unchanged
else
  [[ -z "$(git status --porcelain)" ]]
fi
[[ "$(git rev-parse HEAD)" == "$TARGET" ]]
DEPLOY_STARTED=0
trap - ERR
release_event complete "elapsed_seconds=$(($(date +%s) - PHASE_STARTED_AT))"
write_progress complete

printf '[RELEASE_OK]\n'
printf 'branch=%s\ncommit=%s\nprevious_commit=%s\n' "$BRANCH" "$TARGET" "$PREVIOUS_COMMIT"
printf 'release_version=%s\n' "$TARGET"
printf 'services=%s\n' "${SERVICES[*]}"
for service in "${SERVICES[@]}"; do
  docker inspect -f 'service={{.Name}} state={{.State.Status}} restarts={{.RestartCount}} image={{.Image}}' "$service"
  printf 'previous_runtime_%s=%s\n' "$service" "${OLD_REVISIONS[$service]:-none}"
done
if service_selected tzl_node; then printf 'voice_runtime=ready\n'; fi
if service_selected tzl_memory_worker; then printf 'memory_worker=ready concurrency=1\n'; fi
printf 'public_health=ok\nadmin_health=ok\n'
if [[ "${#BACKEND_SERVICES[@]}" -gt 0 ]]; then printf 'pm2_stability_seconds=%s\n' "$STABILITY_SECONDS"; fi
if service_selected tzl_admin_web; then printf 'admin_legacy_assets=retained_30d\n'; fi
