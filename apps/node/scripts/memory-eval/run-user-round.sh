#!/usr/bin/env bash
# 一轮 = 一个真实用户：只读拉取 -> 本地镜像 -> 本地真实模型回放 -> 导出结果。
# 只写本地 tzl_mirror，不写生产、不发布。
set -euo pipefail

USER_ID="${1:?usage: run-user-round.sh <userId> [roundId]}"
ROUND_ID="${2:-memory_user_$(date +%Y%m%d_%H%M%S)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
MIRROR_JSON="$ROOT/.task-evidence/memory-eval/mirror.json"
KEY="${TZL_DEPLOY_IDENTITY:-$HOME/.ssh/id_ed25519_tianzhiling_deploy_20260802}"
SSH_HOST="${TZL_SSH_HOST:-root@tianzhiling.chat}"
TSC="$ROOT/apps/node/node_modules/.bin/tsc"

echo "[round $ROUND_ID] pull user=$USER_ID (read-only)"
scp -q -i "$KEY" -o BatchMode=yes "$HERE/export-mirror.js" "$SSH_HOST:/tmp/export-mirror.js"
ssh -i "$KEY" -o BatchMode=yes "$SSH_HOST" \
  "set -e; docker cp /tmp/export-mirror.js tzl_node:/workspace/apps/node/export-mirror.js >/dev/null; docker exec -w /workspace/apps/node -e MIRROR_USER_IDS='$USER_ID' tzl_node node export-mirror.js; docker cp tzl_node:/tmp/memory-eval-mirror.json /tmp/memory-eval-mirror.json >/dev/null"
scp -q -i "$KEY" -o BatchMode=yes "$SSH_HOST:/tmp/memory-eval-mirror.json" "$MIRROR_JSON"

echo "[round $ROUND_ID] import local mirror"
node "$HERE/import-mirror.js" "$MIRROR_JSON"

echo "[round $ROUND_ID] build current code"
"$TSC" -p "$ROOT/packages/entities/tsconfig.json"
"$TSC" -p "$ROOT/packages/shared/tsconfig.json"
"$TSC" -p "$ROOT/apps/node/tsconfig.json"

echo "[round $ROUND_ID] local replay (real model, local mirror only)"
cd "$ROOT/apps/node"
export NODE_MONGO_DB=tzl_mirror
export NODE_MONGO_HOST=127.0.0.1
export NODE_MONGO_PORT="${MONGO_PORT:-17271}"
export NODE_MEMORY_VALUE_MODE=active
export NODE_MEMORY_VALUE_USER_IDS="$USER_ID"
# 本地评测机（macOS）的 freemem 只统计空闲页，口径与生产 Linux 不同：
# 用极低门槛关闭该可用内存前置检查，仅影响本地评测。
export NODE_MEMORY_MIN_AVAILABLE_MB="${NODE_MEMORY_MIN_AVAILABLE_MB:-1}"
export NODE_MEMORY_MAX_RSS_MB="${NODE_MEMORY_MAX_RSS_MB:-8192}"
export DOTENV_CONFIG_PATH="$ROOT/.env"
node -r dotenv/config scripts/rebuild-memory-history.js --run="$ROUND_ID" --mode=plan --apply=yes
# account-limit=1：处理完这一个用户即结束，跳过收尾的等待循环。
node -r dotenv/config scripts/rebuild-memory-history.js --run="$ROUND_ID" --mode=run --apply=yes --account-limit=1

echo "[round $ROUND_ID] dump results"
node -r dotenv/config scripts/memory-eval/dump-eval.js "$USER_ID" "$ROUND_ID"
echo "[round $ROUND_ID] done"
