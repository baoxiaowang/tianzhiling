#!/usr/bin/env bash
# 并行跑多个真实用户：每个用户一个独立镜像库槽位，互不覆盖。
# 用法：bash run-parallel-users.sh <name> <userId1> <userId2> <userId3> ...
# 只写本地 tzl_mirror*，不写生产、不发布。
set -euo pipefail

NAME="${1:?usage: run-parallel-users.sh <name> <userId...>}"
shift
if [ "$#" -eq 0 ]; then
  echo "usage: run-parallel-users.sh <name> <userId...>" >&2
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
LOG_DIR="$ROOT/.task-evidence/memory-eval/logs"
mkdir -p "$LOG_DIR"

# 批清单：记录本批使用的代码版本与工作区是否干净。
# 目的是让"批次运行期间改代码"这件事可被发现——同一批用户必须用同一份代码，
# 否则结果不可比（这条曾经踩过坑：一轮内每批各自重编译，批次之间没法比）。
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# 只检查会影响记忆抽取的路径：仓库里还有与本任务无关的改动，
# 用全仓库状态会把每一批都误判成 dirty。
TRACKED_DIRTY="$(git -C "$ROOT" status --porcelain -- \
  apps/node/src/service/agents \
  apps/node/src/service/memory-pipeline-task.service.ts \
  apps/node/src/service/conversation.service.ts \
  apps/node/scripts/rebuild-memory-history.js \
  apps/node/scripts/memory-eval 2>/dev/null)"
if [ -n "$TRACKED_DIRTY" ]; then
  DIRTY="true"
  echo "[parallel $NAME] ⚠ 记忆相关代码未提交：本批数据标记为 dirty，结论需谨慎"
  echo "$TRACKED_DIRTY" | sed 's/^/    /'
else
  DIRTY="false"
fi
USERS_JSON="$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$@")"
printf '{"batch":"%s","commit":"%s","dirty":%s,"startedAt":"%s","users":%s}\n' \
  "$NAME" "$COMMIT" "$DIRTY" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$USERS_JSON" \
  >"$LOG_DIR/${NAME}-manifest.json"

# 编译只做一次，避免多槽位同时写同一份 dist。
# SKIP_BUILD=1 时沿用调用方已编译的产物：整轮必须只用一份代码，
# 否则同一轮里不同批次会用到不同版本的代码，批次之间就不可比了。
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "[parallel $NAME] build skipped (SKIP_BUILD=1) commit=$COMMIT dirty=$DIRTY"
else
  echo "[parallel $NAME] build once commit=$COMMIT dirty=$DIRTY"
  "$ROOT/apps/node/node_modules/.bin/tsc" -p "$ROOT/packages/entities/tsconfig.json"
  "$ROOT/apps/node/node_modules/.bin/tsc" -p "$ROOT/packages/shared/tsconfig.json"
  "$ROOT/apps/node/node_modules/.bin/tsc" -p "$ROOT/apps/node/tsconfig.json"
fi

pids=()
index=0
for user in "$@"; do
  index=$((index + 1))
  slot="s${index}"
  run_id="memory_rebuild_${NAME}_${slot}"
  log="$LOG_DIR/${run_id}.log"
  echo "[parallel $NAME] slot=$slot user=$user log=$log"
  SKIP_BUILD=1 bash "$HERE/run-user-round.sh" "$user" "$run_id" "$slot" \
    >"$log" 2>&1 &
  pids+=("$!:${user}:${slot}:${run_id}")
done

failed=0
for entry in "${pids[@]}"; do
  pid="${entry%%:*}"
  rest="${entry#*:}"
  user="${rest%%:*}"
  if wait "$pid"; then
    echo "[parallel $NAME] OK    user=$user"
  else
    echo "[parallel $NAME] FAIL  user=$user (see log)"
    failed=$((failed + 1))
  fi
done

echo "[parallel $NAME] done, failures=$failed"
[ "$failed" -eq 0 ]
