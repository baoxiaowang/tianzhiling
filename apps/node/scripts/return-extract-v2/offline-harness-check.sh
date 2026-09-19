#!/usr/bin/env bash
# 离线验证：用假客户端跑全部协议分支与失败路径，确认"真正发送的请求"都被留档。
# 不访问网络。用法：bash scripts/return-extract-v2/offline-harness-check.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT_ROOT=".task-evidence/return-extraction-v2/narrow/runs/offline-check-$(date +%s)"
ROOT="$(cd ../.. && pwd)/$OUT_ROOT"
rm -rf "$OUT_ROOT"
run_case() {
  local name="$1"; shift
  npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
    scripts/return-extract-v2/harness.ts run --mode "offline-$name" "$@" \
    --dataset scenarios --limit 2 --concurrency 1 --fake-model \
    --out "$OUT_ROOT/$name" >/dev/null 2>&1
  echo "ran $name"
}
run_case v1 --protocol v1
run_case v2 --protocol v2 --input v2
run_case narrow --protocol narrow --input v2
run_case concrete --protocol concrete --input v2
run_case two-step --protocol two-step --input v2
run_case two-step-fail --protocol two-step --input v2 --fail-step 2
python3 ../../.task-evidence/return-extraction-v2/tools/check_offline_requests.py "$ROOT" || exit 1
python3 ../../.task-evidence/return-extraction-v2/tools/check_offline_requests.py "$ROOT" --selftest || exit 1
