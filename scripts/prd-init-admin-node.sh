#!/bin/sh
# 在生产 Docker Compose 环境中初始化 admin 超级管理员。
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

# 初始化操作使用当前已发布镜像，避免一次性管理任务意外触发生产构建。
set -- docker compose --profile prod run --rm --no-deps

if [ "${ADMIN_INIT_NAME+x}" = "x" ]; then
  set -- "$@" -e ADMIN_INIT_NAME
fi

if [ "${ADMIN_INIT_ACCOUNT+x}" = "x" ]; then
  set -- "$@" -e ADMIN_INIT_ACCOUNT
fi

if [ "${ADMIN_INIT_PASSWORD+x}" = "x" ]; then
  set -- "$@" -e ADMIN_INIT_PASSWORD
fi

exec "$@" tzl_admin_node node ./dist/scripts/init-admin.js
