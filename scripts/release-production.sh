#!/usr/bin/env bash

set -Eeuo pipefail

REPO="${TIANZHILING_REPO_ROOT:-/opt/tianzhiling}"
BRANCH="${1:-}"
TARGET="${2:-}"
PUBLIC_HEALTH="${TIANZHILING_PUBLIC_HEALTH:-https://tianzhiling.chat/api/system/health}"
ADMIN_HEALTH="${TIANZHILING_ADMIN_HEALTH:-https://admin.tianzhiling.chat/admin_api/system/health}"
SERVICES=(tzl_node tzl_admin_node tzl_admin_web tzl_nginx)
DEPLOY_STARTED=0
PREVIOUS_COMMIT=""
ENV_BACKUP=""

declare -A OLD_IMAGES=()
declare -A COMPOSE_IMAGES=()

fail() {
  printf '[RELEASE_FAILED] phase=%s message=%s\n' "${PHASE:-preflight}" "$*" >&2
  exit 1
}

restore_env_file() {
  [[ -n "$ENV_BACKUP" && -f "$ENV_BACKUP" ]] || return 0
  install -m 600 "$ENV_BACKUP" "$REPO/.env"
  rm -f "$ENV_BACKUP"
  ENV_BACKUP=""
}

rollback_runtime() {
  local service

  [[ "$DEPLOY_STARTED" -eq 1 ]] || return 0
  set +e
  printf '[ROLLBACK_BEGIN] previous=%s\n' "${PREVIOUS_COMMIT:-unknown}" >&2
  for service in "${SERVICES[@]}"; do
    if [[ -n "${OLD_IMAGES[$service]:-}" && -n "${COMPOSE_IMAGES[$service]:-}" ]]; then
      docker image tag "${OLD_IMAGES[$service]}" "${COMPOSE_IMAGES[$service]}"
    fi
  done
  docker compose --profile prod up -d --no-deps --force-recreate "${SERVICES[@]}"
  printf '[ROLLBACK_DONE] runtime restored; git remains at %s\n' "$TARGET" >&2
}

on_error() {
  local rc="$?"
  trap - ERR
  restore_env_file
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

check_container() {
  local service="$1"
  local state restarts

  read -r state restarts < <(
    docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$service"
  )
  [[ "$state" == 'running' && "$restarts" == '0' ]]
}

[[ "$EUID" -eq 0 ]] || fail 'run as root'
[[ "$BRANCH" =~ ^[0-9]{8}$ ]] || fail 'branch must be YYYYMMDD'
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || fail 'target must be a full commit hash'

PHASE='preflight'
cd "$REPO"
[[ "$(git symbolic-ref --short HEAD)" == "$BRANCH" ]] || fail 'server branch mismatch'
[[ -z "$(git status --porcelain)" ]] || fail 'server worktree is dirty'
[[ -f "$REPO/.env" ]] || fail 'server .env is missing'

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
git fetch origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
[[ "$(git rev-parse "origin/$BRANCH")" == "$TARGET" ]] || fail 'remote tip mismatch'
git merge-base --is-ancestor "$PREVIOUS_COMMIT" "$TARGET" || fail 'target is not a fast-forward'

for service in "${SERVICES[@]}"; do
  OLD_IMAGES[$service]="$(docker inspect -f '{{.Image}}' "$service")"
  COMPOSE_IMAGES[$service]="$(docker inspect -f '{{.Config.Image}}' "$service")"
  docker image tag \
    "${OLD_IMAGES[$service]}" \
    "tzl-${service}-rollback:${PREVIOUS_COMMIT:0:12}"
done

ENV_BACKUP="$(mktemp /tmp/tianzhiling-env.XXXXXX)"
install -m 600 "$REPO/.env" "$ENV_BACKUP"
git merge --ff-only "$TARGET"
restore_env_file
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || fail 'checkout did not reach target'

# Keep runtime telemetry, the container environment, and the immutable image
# label tied to the exact Git target selected for this release.
export RELEASE_VERSION="$TARGET"

PHASE='production-build'
docker compose --profile prod build "${SERVICES[@]}"

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
check_container tzl_admin_web
docker exec tzl_admin_web wget -q -O /dev/null http://127.0.0.1/health
docker compose --profile prod up -d --no-deps tzl_nginx
docker exec tzl_nginx nginx -t

PHASE='container-health'
for service in "${SERVICES[@]}"; do
  check_container "$service"
done
[[ "$(docker exec tzl_node pm2 jlist | grep -o '"status":"online"' | wc -l | tr -d ' ')" == '4' ]]
[[ "$(docker exec tzl_admin_node pm2 jlist | grep -o '"status":"online"' | wc -l | tr -d ' ')" == '2' ]]
[[ "$(docker exec tzl_node printenv RELEASE_VERSION)" == "$TARGET" ]]
[[ "$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' tzl_node)" == "$TARGET" ]]

PHASE='public-health'
curl -fsS --max-time 20 "$PUBLIC_HEALTH" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'
curl -fsS --max-time 20 "$ADMIN_HEALTH" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'

PHASE='error-scan'
for service in tzl_node tzl_admin_node tzl_nginx; do
  if docker logs --since 5m "$service" 2>&1 | \
    grep -Eiq 'uncaught exception|unhandled rejection|fatal error|heap out of memory|EADDRINUSE'; then
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
done
printf 'voice_runtime=ready\npublic_health=ok\nadmin_health=ok\n'
