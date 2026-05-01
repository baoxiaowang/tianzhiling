#!/bin/sh
# 初始化 admin 超级管理员；需要通过 ADMIN_INIT_* 环境变量传入账号信息
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f apps/admin-node/dist/scripts/init-admin.js ]; then
  npx -y pnpm@9 build:admin-node
fi

exec npx -y pnpm@9 --filter @tzl/admin-node init:admin "$@"
