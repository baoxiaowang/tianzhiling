#!/bin/sh
# 拉取开发依赖服务镜像
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

exec docker compose pull "$@"
