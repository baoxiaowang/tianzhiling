#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLASSIFY_COMPOSE="${SCRIPT_DIR}/classify-compose-services.sh"

SERVICES=(tzl_node tzl_memory_worker tzl_admin_node tzl_admin_web tzl_nginx)
SELECTED_tzl_node=0
SELECTED_tzl_memory_worker=0
SELECTED_tzl_admin_node=0
SELECTED_tzl_admin_web=0
SELECTED_tzl_nginx=0

select_service() {
  case "$1" in
    tzl_node) SELECTED_tzl_node=1 ;;
    tzl_memory_worker) SELECTED_tzl_memory_worker=1 ;;
    tzl_admin_node) SELECTED_tzl_admin_node=1 ;;
    tzl_admin_web) SELECTED_tzl_admin_web=1 ;;
    tzl_nginx) SELECTED_tzl_nginx=1 ;;
    *) printf 'unknown service: %s\n' "$1" >&2; exit 2 ;;
  esac
}

select_all() {
  local service
  for service in "${SERVICES[@]}"; do
    select_service "$service"
  done
}

classify_path() {
  local path="$1"

  case "$path" in
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
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml|.npmrc|.dockerignore)
      select_service tzl_node
      select_service tzl_memory_worker
      select_service tzl_admin_node
      select_service tzl_admin_web
      ;;
    docker-compose.yml)
      select_all
      ;;
    docs/*|.github/*|AGENTS.md|README.md|scripts/*|task-adapters/*|tools/task-protocol/*)
      ;;
    apps/app/*|apps/weapp/*|apps/transfer/*|apps/ai-deceased-server/*)
      ;;
    *)
      # Unknown production paths fail safe: rebuild every runtime service.
      select_all
      ;;
  esac
}

# 两个提交之间需要按内容判断 compose 的服务归属；--stdin 只有路径，保守走全部。
classify_compose_file() {
  local prev="$1"
  local target="$2"
  local path="$3"
  local compose_tmp diff_tmp classified=''

  if [[ ! -f "$CLASSIFY_COMPOSE" ]]; then
    select_all
    return
  fi

  compose_tmp="$(mktemp)"
  diff_tmp="$(mktemp)"
  if git show "$target:$path" >"$compose_tmp" 2>/dev/null \
    && git -c core.quotepath=false diff -U0 "$prev" "$target" -- "$path" >"$diff_tmp" 2>/dev/null; then
    classified="$(bash "$CLASSIFY_COMPOSE" "$compose_tmp" "$diff_tmp" 2>/dev/null || true)"
  fi
  rm -f -- "$compose_tmp" "$diff_tmp"

  if [[ -z "$classified" || "$classified" == 'ALL' ]]; then
    select_all
    return
  fi
  while IFS= read -r service; do
    [[ -n "$service" ]] && select_service "$service"
  done <<< "$classified"
}

if [[ "${1:-}" == '--stdin' ]]; then
  while IFS= read -r path; do
    [[ -n "$path" ]] && classify_path "$path"
  done
else
  [[ "$#" -eq 2 ]] || {
    printf 'usage: %s PREVIOUS_COMMIT TARGET_COMMIT\n' "$0" >&2
    printf '   or: %s --stdin < changed-paths.txt\n' "$0" >&2
    exit 2
  }
  CHANGED_PATHS="$(git -c core.quotepath=false diff --name-only "$1" "$2")"
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      docker-compose*.yml) classify_compose_file "$1" "$2" "$path" ;;
      *) classify_path "$path" ;;
    esac
  done <<< "$CHANGED_PATHS"
fi

for service in "${SERVICES[@]}"; do
  case "$service" in
    tzl_node) selected="$SELECTED_tzl_node" ;;
    tzl_memory_worker) selected="$SELECTED_tzl_memory_worker" ;;
    tzl_admin_node) selected="$SELECTED_tzl_admin_node" ;;
    tzl_admin_web) selected="$SELECTED_tzl_admin_web" ;;
    tzl_nginx) selected="$SELECTED_tzl_nginx" ;;
  esac
  if [[ "$selected" -eq 1 ]]; then
    printf '%s\n' "$service"
  fi
done
