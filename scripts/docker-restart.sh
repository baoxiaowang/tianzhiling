#!/usr/bin/env bash
# 重启服务；不传参数则重启全部，如: ./docker-restart.sh tzl_redis
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec docker compose restart "$@"
