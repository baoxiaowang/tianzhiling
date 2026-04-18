#!/usr/bin/env bash
# 停止并移除 compose 管理的容器（可加 -v 删卷，见 docker compose down --help）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec docker compose down "$@"
