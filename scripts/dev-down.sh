#!/bin/sh
# 停止并移除开发环境容器
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

exec docker compose down "$@"
