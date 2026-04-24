#!/bin/sh
# 拉取生产环境远程镜像；tzl_node 是本地构建服务，不会被 pull
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

exec docker compose --profile prod pull --ignore-buildable "$@"
