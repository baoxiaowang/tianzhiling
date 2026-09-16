#!/usr/bin/env bash
#
# 把一次 docker-compose 文件的改动映射到受影响的服务，避免"Compose 一变就重建全部服务"。
#
# 用法：classify-compose-services.sh <目标 compose 文件> <git diff -U0 输出文件>
# 输出：每行一个受影响的服务名；若改动落在顶层/全局配置（networks、volumes、锚点等）
#       或无法安全归属，则输出 ALL（调用方应据此选中全部服务）。
#
# 只做静态归属，不做运行时假设：服务名必须出现在目标 compose 的 services: 下。

set -Eeuo pipefail

compose_file="${1:-}"
diff_file="${2:-}"

if [[ -z "$compose_file" || ! -f "$compose_file" || -z "$diff_file" || ! -f "$diff_file" ]]; then
  printf 'usage: %s <compose-file> <diff-file>\n' "$0" >&2
  exit 2
fi

awk '
FNR == NR {
  # 目标 compose：记录 行号 -> 服务名 / GLOBAL
  if ($0 ~ /^services:[[:space:]]*(#.*)?$/) {
    mn += 1; mln[mn] = FNR; msvc[mn] = "GLOBAL"; in_services = 1; next
  }
  if (in_services == 1) {
    if ($0 ~ /^  [A-Za-z0-9_.-]+:[[:space:]]*(#.*)?$/) {
      s = $0; sub(/^  /, "", s); sub(/:[[:space:]]*(#.*)?$/, "", s)
      mn += 1; mln[mn] = FNR; msvc[mn] = s; next
    }
    if ($0 ~ /^[^[:space:]#]/) {
      in_services = 0; mn += 1; mln[mn] = FNR; msvc[mn] = "GLOBAL"; next
    }
    next
  }
  if ($0 ~ /^[A-Za-z_][A-Za-z0-9_.-]*:/) {
    mn += 1; mln[mn] = FNR; msvc[mn] = "GLOBAL"
  }
  next
}
/^@@ / {
  # @@ -a,b +c,d @@；目标侧受影响行为 c .. c+d-1（d=0 表示纯删除，取 c 与 c+1）
  if (match($0, /\+[0-9]+(,[0-9]+)?/)) {
    plus = substr($0, RSTART + 1, RLENGTH - 1)
    split(plus, a, ",")
    start = a[1] + 0
    count = (a[2] == "") ? 1 : (a[2] + 0)
    if (count == 0) {
      affected[start] = 1
      if (start + 1 > 0) affected[start + 1] = 1
    } else {
      for (L = start; L <= start + count - 1; L += 1) affected[L] = 1
    }
  }
  next
}
END {
  global = 0
  for (L in affected) {
    Ln = L + 0
    svc = ""
    best = -1
    for (i = 1; i <= mn; i += 1) {
      ln = mln[i] + 0
      if (ln <= Ln && ln > best) { best = ln; svc = msvc[i] }
    }
    if (svc == "" || svc == "GLOBAL") { global = 1; break }
    picked[svc] = 1
  }
  if (global) { print "ALL"; exit 0 }
  for (s in picked) print s
}
' "$compose_file" "$diff_file" | sort -u
