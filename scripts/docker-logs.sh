#!/usr/bin/env bash
# 跟踪日志；可传服务名，如: ./docker-logs.sh tzl_mongo
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec docker compose logs -f "$@"
