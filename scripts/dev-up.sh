#!/bin/sh
# 启动开发依赖服务：Redis、Mongo、MinIO、Milvus 等基础设施
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"

exec docker compose up -d "$@"
