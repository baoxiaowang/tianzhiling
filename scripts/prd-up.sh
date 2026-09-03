#!/bin/sh
# 启动已有的生产镜像；构建和发布统一由 release-production.sh 负责。
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

exec docker compose --profile prod up -d --no-build "$@"
