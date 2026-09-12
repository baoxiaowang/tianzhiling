#!/usr/bin/env bash
# 批次闭卡检查：一个批次只有"跑完 + 诊断完 + 优化完"才算结束。
# 下一批开工前必须通过这里；不通过就停下来，不许继续拉新用户。
#
# 判定依据（缺一即未闭环）：
#   1) 3 个用户的结果文件都存在
#   2) 3 个用户的金标准文件都存在（gold-<batch><slot>-<userId>.json 或 gold-*<userId>.json）
#   3) batch-ledger.jsonl 里有本批记录，且 optimization 字段非空
#
# 用法：bash check-batch-closed.sh <batchName>
set -euo pipefail

BATCH="${1:?usage: check-batch-closed.sh <batchName>}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
EVAL="$ROOT/.task-evidence/memory-eval"
LEDGER="$EVAL/batch-ledger.jsonl"

problems=()

results=$(ls "$EVAL"/results-memory_rebuild_"$BATCH"_s*-*.json 2>/dev/null | wc -l | tr -d ' ')
if [ "$results" -lt 3 ]; then
  problems+=("只有 $results/3 个用户跑出了结果")
fi

missing_gold=0
for f in "$EVAL"/results-memory_rebuild_"$BATCH"_s*-*.json; do
  [ -e "$f" ] || continue
  uid=$(basename "$f" | sed 's/.*-\([a-f0-9]\{24\}\)\.json/\1/')
  if ! ls "$EVAL"/gold-*"$uid".json >/dev/null 2>&1; then
    missing_gold=$((missing_gold + 1))
  fi
done
if [ "$missing_gold" -gt 0 ]; then
  problems+=("$missing_gold 个用户没有金标准（未诊断）")
fi

if [ ! -f "$LEDGER" ]; then
  problems+=("没有 batch-ledger.jsonl")
elif ! grep -q "\"batch\":\"$BATCH\"" "$LEDGER" 2>/dev/null; then
  problems+=("台账里没有本批记录")
else
  opt=$(grep "\"batch\":\"$BATCH\"" "$LEDGER" | tail -1 \
    | python3 -c 'import sys,json;print((json.loads(sys.stdin.read()).get("optimization") or "").strip())' 2>/dev/null || echo "")
  if [ -z "$opt" ]; then
    problems+=("台账里本批的 optimization 为空——本批还没做优化")
  fi
fi

if [ "${#problems[@]}" -gt 0 ]; then
  echo "BATCH_NOT_CLOSED batch=$BATCH"
  for p in "${problems[@]}"; do echo "  - $p"; done
  echo "→ 先完成本批的「独立诊断 + 一轮优化」，再开下一批。"
  exit 1
fi

echo "BATCH_CLOSED batch=$BATCH 结果与诊断齐备、优化已记录 ✓"
