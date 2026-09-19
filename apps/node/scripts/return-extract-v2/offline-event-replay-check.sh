#!/usr/bin/env bash
# P02 离线验证：用假客户端顺序回放 4 条轨迹（12 个检查点），校验回放与状态应用。
# 另跑一遍"第二点失败"的模拟，证明已完成的证据保留、后续不补假快照。
# 不访问网络。用法：bash scripts/return-extract-v2/offline-event-replay-check.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="../../.task-evidence/return-extraction-v2/pilot/p02-prototype-v2"
npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
  scripts/return-extract-v2/event-replay/run.ts --mode fake --out "$OUT"
