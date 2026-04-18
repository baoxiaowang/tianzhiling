#!/usr/bin/env bash
# 查看 compose 服务状态
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec docker compose ps "$@"
