#!/usr/bin/env bash
# 拉取 compose 中镜像的最新版本
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec docker compose pull "$@"
