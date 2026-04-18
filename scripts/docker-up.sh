#!/usr/bin/env bash
# 后台启动全部服务（在项目根目录执行 docker compose）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec docker compose up -d "$@"
