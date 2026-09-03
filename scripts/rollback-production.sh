#!/usr/bin/env bash

set -Eeuo pipefail

REPO="${TIANZHILING_REPO_ROOT:-/opt/tianzhiling}"
MODE="${1:-}"
TARGET="${2:-}"
ALL_SERVICES=(tzl_node tzl_admin_node tzl_admin_web tzl_nginx)
SERVICES=()

fail() {
  printf '[ROLLBACK_FAILED] message=%s\n' "$*" >&2
  exit 1
}

check_container() {
  local service="$1" state restarts
  read -r state restarts < <(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$service")
  [[ "$state" == 'running' && "$restarts" == '0' ]]
}

check_health() {
  local service="$1" url="$2"
  docker exec "$service" node -e \
    "fetch('$url').then(async r=>{const j=await r.json();const d=j.data||j;if(!r.ok||d.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))"
}

[[ "$MODE" == 'plan' || "$MODE" == 'execute' ]] || \
  fail 'usage: rollback-production.sh <plan|execute> <40-hex-commit> [service...]'
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || fail 'target must be a full commit hash'
if [[ "$MODE" == 'execute' ]]; then [[ "$EUID" -eq 0 ]] || fail 'run as root'; fi

if [[ "$#" -gt 2 ]]; then
  shift 2
  SERVICES=("$@")
else
  for service in "${ALL_SERVICES[@]}"; do
    if docker image inspect "tzl-${service}-rollback:${TARGET:0:12}" >/dev/null 2>&1; then
      SERVICES+=("$service")
    fi
  done
fi
[[ "${#SERVICES[@]}" -gt 0 ]] || fail 'no rollback images found for target'

for service in "${SERVICES[@]}"; do
  [[ " ${ALL_SERVICES[*]} " == *" $service "* ]] || fail "unknown service: $service"
  docker image inspect "tzl-${service}-rollback:${TARGET:0:12}" >/dev/null || \
    fail "rollback image missing: $service"
done

printf '[ROLLBACK_PLAN_OK]\ntarget=%s\nservices=%s\n' "$TARGET" "${SERVICES[*]}"
[[ "$MODE" == 'execute' ]] || exit 0

cd "$REPO"
declare -A CURRENT_IMAGES=()
declare -A COMPOSE_IMAGES=()

restore_current() {
  local service
  set +e
  for service in "${SERVICES[@]}"; do
    docker image tag "${CURRENT_IMAGES[$service]}" "${COMPOSE_IMAGES[$service]}"
  done
  docker compose --profile prod up -d --no-deps --force-recreate "${SERVICES[@]}"
  printf '[ROLLBACK_REVERTED] restored_pre_rollback_runtime=true\n' >&2
}
trap restore_current ERR

for service in "${SERVICES[@]}"; do
  CURRENT_IMAGES[$service]="$(docker inspect -f '{{.Image}}' "$service")"
  COMPOSE_IMAGES[$service]="$(docker inspect -f '{{.Config.Image}}' "$service")"
  docker image tag \
    "tzl-${service}-rollback:${TARGET:0:12}" \
    "${COMPOSE_IMAGES[$service]}"
done

printf '[ROLLBACK_EVENT] phase=replace status=begin\n'
docker compose --profile prod up -d --no-deps --force-recreate "${SERVICES[@]}"

if [[ " ${SERVICES[*]} " == *' tzl_node '* || " ${SERVICES[*]} " == *' tzl_admin_node '* ]]; then
  docker exec tzl_nginx nginx -t
  docker exec tzl_nginx nginx -s reload
fi
for service in "${SERVICES[@]}"; do check_container "$service"; done
if [[ " ${SERVICES[*]} " == *' tzl_node '* ]]; then
  check_health tzl_node 'http://127.0.0.1:7001/api/system/health'
fi
if [[ " ${SERVICES[*]} " == *' tzl_admin_node '* ]]; then
  check_health tzl_admin_node 'http://127.0.0.1:7101/admin_api/system/health'
fi

trap - ERR
printf '[ROLLBACK_OK]\ntarget=%s\nservices=%s\n' "$TARGET" "${SERVICES[*]}"
