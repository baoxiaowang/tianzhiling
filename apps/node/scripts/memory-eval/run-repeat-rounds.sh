#!/usr/bin/env bash
# 同一份代码对同一用户重复跑 N 轮（默认 3），用于消除真实模型的单轮随机性。
# 必须串行：所有轮共用本地镜像库 tzl_mirror，并发会互相覆盖。
# 只写本地镜像库，不写生产、不发布。
set -euo pipefail

USER_ID="${1:?usage: run-repeat-rounds.sh <userId> <name> [rounds]}"
NAME="${2:?usage: run-repeat-rounds.sh <userId> <name> [rounds]}"
ROUNDS="${3:-3}"
HERE="$(cd "$(dirname "$0")" && pwd)"

for i in $(seq 1 "$ROUNDS"); do
  RUN_ID="memory_rebuild_${NAME}_r${i}"
  echo "=== [$i/$ROUNDS] $RUN_ID start $(date +%H:%M:%S) ==="
  bash "$HERE/run-user-round.sh" "$USER_ID" "$RUN_ID" 2>&1 | grep -E "DUMP_OK|account_completed|done"
done

echo "=== [$ROUNDS/$ROUNDS] all repeats done $(date +%H:%M:%S) ==="
echo "下一步：用冻结金标准对每一轮独立评测，取中位数（见 LOOP.md 第 8 条）。"
