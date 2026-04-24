#!/bin/sh
# 启动生产服务：基础设施 + tzl_node + tzl_nginx
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

exec docker compose --profile prod up -d --build "$@"
