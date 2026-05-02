#!/bin/sh
# 初始化 admin 超级管理员；需要通过 ADMIN_INIT_* 环境变量传入账号信息
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return
  fi

  if command -v npx >/dev/null 2>&1; then
    npx -y pnpm@9 "$@"
    return
  fi

  echo "未找到 pnpm/corepack/npx，请先安装 Node.js 20 并启用 pnpm。" >&2
  exit 127
}

run_in_docker() {
  exec sh scripts/prd-init-admin-node.sh "$@"
}

if ! command -v pnpm >/dev/null 2>&1 &&
  ! command -v corepack >/dev/null 2>&1 &&
  ! command -v npx >/dev/null 2>&1 &&
  command -v docker >/dev/null 2>&1; then
  run_in_docker "$@"
fi

if [ ! -f apps/admin-node/dist/scripts/init-admin.js ]; then
  run_pnpm build:admin-node
fi

run_pnpm --filter @tzl/admin-node init:admin "$@"
