#!/usr/bin/env bash
# 跑完整一轮：5 批 × 3 个用户 = 15 个真实用户。
# 批内 3 个用户并行（各自独立镜像库槽位），批与批之间串行。
# 只写本地 tzl_mirror*，不写生产、不发布。
#
# 用法：
#   bash run-round.sh <roundName> \
#     <u1> <u2> <u3> <u4> <u5> <u6> ... （15 个 userId，按 3 个一批）
set -euo pipefail

ROUND="${1:?usage: run-round.sh <roundName> <15 userIds>}"
shift
if [ "$#" -lt 3 ]; then
  echo "at least one batch (3 userIds) is required" >&2
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$HERE/../../../.task-evidence/memory-eval/logs"
mkdir -p "$LOG_DIR"
SUMMARY="$LOG_DIR/${ROUND}-round.log"

: >"$SUMMARY"
# 整轮只编译一次：同一轮的所有批次必须用同一份代码，否则批次之间不可比。
ROOT="$(cd "$HERE/../../../.." && pwd)"
echo "=== [$ROUND] build once $(date +%H:%M:%S)" | tee -a "$SUMMARY"
"$ROOT/apps/node/node_modules/.bin/tsc" -p "$ROOT/packages/entities/tsconfig.json"
"$ROOT/apps/node/node_modules/.bin/tsc" -p "$ROOT/packages/shared/tsconfig.json"
"$ROOT/apps/node/node_modules/.bin/tsc" -p "$ROOT/apps/node/tsconfig.json"
export SKIP_BUILD=1
users=("$@")
batch=0
for ((i = 0; i < ${#users[@]}; i += 3)); do
  batch=$((batch + 1))
  trio=("${users[@]:i:3}")
  if [ "${#trio[@]}" -lt 3 ]; then
    echo "[$ROUND] batch $batch skipped: need 3 users, got ${#trio[@]}" | tee -a "$SUMMARY"
    break
  fi
  echo "=== [$ROUND] batch $batch start $(date +%H:%M:%S) users=${trio[*]}" | tee -a "$SUMMARY"
  if bash "$HERE/run-parallel-users.sh" "${ROUND}_b${batch}" "${trio[@]}" 2>&1 |
    grep -E "OK |FAIL |failures=|done" | tee -a "$SUMMARY"; then
    echo "=== [$ROUND] batch $batch ok $(date +%H:%M:%S)" | tee -a "$SUMMARY"
  else
    echo "=== [$ROUND] batch $batch FAILED $(date +%H:%M:%S)" | tee -a "$SUMMARY"
  fi
done
echo "=== [$ROUND] round done $(date +%H:%M:%S), batches=$batch" | tee -a "$SUMMARY"
