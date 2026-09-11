#!/usr/bin/env bash
# 一轮 = 一个真实用户：只读拉取 -> 本地镜像 -> 本地真实模型回放 -> 导出结果。
# 只写本地 tzl_mirror*，不写生产、不发布。
#
# 第 3 个参数是「并行槽位」：给了槽位就用独立的镜像库与临时文件，
# 这样多个用户/多轮可以真正同时跑，而不会互相覆盖数据。
#   bash run-user-round.sh <userId> <roundId> [slot]
set -euo pipefail

USER_ID="${1:?usage: run-user-round.sh <userId> [roundId] [slot]}"
ROUND_ID="${2:-memory_user_$(date +%Y%m%d_%H%M%S)}"
SLOT="${3:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
SUFFIX="${SLOT:+-$SLOT}"
DB="tzl_mirror${SUFFIX//-/_}"
MIRROR_JSON="$ROOT/.task-evidence/memory-eval/mirror-${ROUND_ID}.json"
REMOTE_JSON="/tmp/memory-eval-mirror${SUFFIX}.json"
KEY="${TZL_DEPLOY_IDENTITY:-$HOME/.ssh/id_ed25519_tianzhiling_deploy_20260802}"
SSH_HOST="${TZL_SSH_HOST:-root@tianzhiling.chat}"
TSC="$ROOT/apps/node/node_modules/.bin/tsc"

echo "[round $ROUND_ID slot=${SLOT:-none} db=$DB] pull user=$USER_ID (read-only)"
scp -q -i "$KEY" -o BatchMode=yes "$HERE/export-mirror.js" "$SSH_HOST:/tmp/export-mirror.js"
ssh -i "$KEY" -o BatchMode=yes "$SSH_HOST" \
  "set -e; docker cp /tmp/export-mirror.js tzl_node:/workspace/apps/node/export-mirror.js >/dev/null; docker exec -w /workspace/apps/node -e MIRROR_USER_IDS='$USER_ID' -e MIRROR_OUT='$REMOTE_JSON' tzl_node node export-mirror.js; docker cp tzl_node:$REMOTE_JSON $REMOTE_JSON >/dev/null"
scp -q -i "$KEY" -o BatchMode=yes "$SSH_HOST:$REMOTE_JSON" "$MIRROR_JSON"

echo "[round $ROUND_ID] import local mirror into $DB"
MIRROR_DB="$DB" node "$HERE/import-mirror.js" "$MIRROR_JSON"

echo "[round $ROUND_ID] build current code"
# 编译产物是共享的，多槽位并行时只需一个槽位编译；用锁避免同时写同一个 dist。
BUILD_LOCK="${TMPDIR:-/tmp}/tzl-memory-eval-build.lock"
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "[round $ROUND_ID] build skipped (SKIP_BUILD=1)"
else
  while ! mkdir "$BUILD_LOCK" 2>/dev/null; do sleep 3; done
  trap 'rmdir "$BUILD_LOCK" 2>/dev/null || true' EXIT
  "$TSC" -p "$ROOT/packages/entities/tsconfig.json"
  "$TSC" -p "$ROOT/packages/shared/tsconfig.json"
  "$TSC" -p "$ROOT/apps/node/tsconfig.json"
  rmdir "$BUILD_LOCK" 2>/dev/null || true
  trap - EXIT
fi

echo "[round $ROUND_ID] local replay (real model, local mirror only)"
cd "$ROOT/apps/node"
export NODE_MONGO_DB="$DB"
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
MIRROR_DB="$DB" node -r dotenv/config scripts/memory-eval/dump-eval.js "$USER_ID" "$ROUND_ID"
echo "[round $ROUND_ID] done"
