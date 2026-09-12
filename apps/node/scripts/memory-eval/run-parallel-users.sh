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

# 编译只做一次，避免多槽位同时写同一份 dist。
# SKIP_BUILD=1 时沿用调用方已编译的产物：整轮必须只用一份代码，
# 否则同一轮里不同批次会用到不同版本的代码，批次之间就不可比了。
if [ "${SKIP_BUILD:-0}" = "1" ]; then
  echo "[parallel $NAME] build skipped (SKIP_BUILD=1)"
else
  echo "[parallel $NAME] build once"
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
