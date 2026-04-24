#!/bin/sh
# 查看生产环境日志；可传服务名，如：sh scripts/prd-logs.sh tzl_nginx
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

exec docker compose --profile prod logs -f "$@"
