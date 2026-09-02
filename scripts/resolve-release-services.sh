#!/usr/bin/env bash

set -Eeuo pipefail

SERVICES=(tzl_node tzl_admin_node tzl_admin_web tzl_nginx)
SELECTED_tzl_node=0
SELECTED_tzl_admin_node=0
SELECTED_tzl_admin_web=0
SELECTED_tzl_nginx=0

select_service() {
  case "$1" in
    tzl_node) SELECTED_tzl_node=1 ;;
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
      select_service tzl_admin_node
      ;;
    packages/shared/*)
      select_service tzl_node
      select_service tzl_admin_node
      select_service tzl_admin_web
      ;;
    package.json|pnpm-lock.yaml|pnpm-workspace.yaml|.npmrc|.dockerignore)
      select_service tzl_node
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
  CHANGED_PATHS="$(git diff --name-only "$1" "$2")"
  while IFS= read -r path; do
    [[ -n "$path" ]] && classify_path "$path"
  done <<< "$CHANGED_PATHS"
fi

for service in "${SERVICES[@]}"; do
  case "$service" in
    tzl_node) selected="$SELECTED_tzl_node" ;;
    tzl_admin_node) selected="$SELECTED_tzl_admin_node" ;;
    tzl_admin_web) selected="$SELECTED_tzl_admin_web" ;;
    tzl_nginx) selected="$SELECTED_tzl_nginx" ;;
  esac
  if [[ "$selected" -eq 1 ]]; then
    printf '%s\n' "$service"
  fi
done
