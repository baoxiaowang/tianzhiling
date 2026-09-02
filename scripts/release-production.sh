#!/usr/bin/env bash
#
# release-production-slim.sh — 精简版生产发布脚本
#
# 定位：执行者是 AI。脚本只做「确定性执行 + 状态上报」，
# 健康验证 / 稳定性观察 / 错误扫描 / 回滚决策全部由 AI 外层兜底。
#
# 用法：
#   release-production-slim.sh plan   <YYYYMMDD> <commit>  # 预览范围，不改状态
#   release-production-slim.sh        <YYYYMMDD> <commit>  # 执行发布（root）
#   release-production-slim.sh progress                    # 查进度
#
# AI 外层职责：发布前核对 RELEASE_SCOPE；发布中监听事件/进度，SSH 断了用 nohup 重跑；
# 发布后自行做健康检查、稳定性观察、日志扫描；失败时依据 RELEASE_FAILED + previous_* 自行回滚。

set -Eeuo pipefail

REPO="${TIANZHILING_REPO_ROOT:-/opt/tianzhiling}"
COMMAND="${1:-release}"
PROGRESS_FILE="${TIANZHILING_RELEASE_PROGRESS_FILE:-/var/tmp/tianzhiling-release-progress.env}"

if [[ "$COMMAND" == 'progress' ]]; then
  [[ -f "$PROGRESS_FILE" ]] && cat "$PROGRESS_FILE" || printf 'state=idle\n'
  exit 0
elif [[ "$COMMAND" == 'plan' ]]; then
  BRANCH="${2:-}"; TARGET="${3:-}"; PLAN_ONLY=1
else
  BRANCH="$COMMAND"; TARGET="${2:-}"; COMMAND='release'; PLAN_ONLY=0
fi

ALL_SERVICES=(tzl_node tzl_admin_node tzl_admin_web tzl_nginx)
SERVICES=()
DEPLOY_STARTED=0
PREVIOUS_COMMIT=""
PHASE=""
declare -A OLD_IMAGES=()
declare -A OLD_REVISIONS=()
declare -A SELECTED_SERVICES=()

# ---------- 事件与进度 ----------

write_progress() {
  local state="$1"
  local tmp="${PROGRESS_FILE}.$$"
  {
    printf 'state=%s\nphase=%s\nbranch=%s\ntarget=%s\nprevious_commit=%s\nservices=%s\nupdated_at=%s\n' \
      "$state" "${PHASE:-none}" "${BRANCH:-}" "${TARGET:-}" "${PREVIOUS_COMMIT:-}" \
      "${SERVICES[*]:-}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"$tmp"
  mv "$tmp" "$PROGRESS_FILE"
}

release_event() {
  local status="$1"; shift
  printf '[RELEASE_EVENT] time=%s phase=%s status=%s %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${PHASE:-none}" "$status" "$*"
}

set_phase() {
  PHASE="$1"
  write_progress running
  release_event begin
}

# ---------- 失败上报（不回滚，只给 AI 回滚提示） ----------

fail() {
  local message="$*"
  trap - ERR
  release_event failed "message=$message" >&2
  write_progress failed
  printf '[RELEASE_FAILED] phase=%s target=%s message=%s\n' "${PHASE:-unknown}" "${TARGET:-}" "$message" >&2
  if [[ "$DEPLOY_STARTED" -eq 1 ]]; then
    printf '[ROLLBACK_HINT] services=%s\n' "${SERVICES[*]}" >&2
    for service in "${SERVICES[@]}"; do
      printf '[ROLLBACK_HINT] previous_%s=%s image=%s\n' \
        "$service" "${OLD_REVISIONS[$service]:-}" "${OLD_IMAGES[$service]:-}" >&2
    done
  fi
  exit 1
}

on_error() {
  local rc="$?"
  fail "exit=$rc"
}
trap on_error ERR

# ---------- 增量服务范围选择 ----------

select_service() { SELECTED_SERVICES["$1"]=1; }
service_selected() { [[ "${SELECTED_SERVICES[$1]:-0}" == '1' ]]; }

select_release_services() {
  local path service
  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    case "$path" in
      apps/node/test/*|apps/admin-node/test/*|apps/admin/test/*|apps/weapp/*|*/test/*|*/tests/*|*.md|AGENTS.md|docs/*|reports/*|.github/*|release-state/*) ;;
      scripts/init-admin-node.sh|scripts/prd-init-admin-node.sh) select_service tzl_admin_node ;;
      scripts/backfill-*.js) select_service tzl_node ;;
      scripts/release-production*.sh|scripts/dev-*|scripts/docker-*|scripts/prd-*|scripts/check-brand-sync.mjs) ;;
      apps/node/*) select_service tzl_node ;;
      apps/admin-node/*) select_service tzl_admin_node ;;
      apps/admin/*) select_service tzl_admin_web ;;
      apps/gateway/*) select_service tzl_nginx ;;
      packages/entities/*) select_service tzl_node; select_service tzl_admin_node ;;
      packages/shared/*) select_service tzl_node; select_service tzl_admin_node; select_service tzl_admin_web ;;
      package.json|pnpm-lock.yaml|pnpm-workspace.yaml|docker-compose*.yml|.dockerignore|tsconfig*.json)
        for service in "${ALL_SERVICES[@]}"; do select_service "$service"; done ;;
      *)
        printf '[RELEASE_SCOPE_FALLBACK] unclassified_path=%s action=build_all\n' "$path" >&2
        for service in "${ALL_SERVICES[@]}"; do select_service "$service"; done ;;
    esac
  done < <(git -c core.quotepath=false diff --name-only "$PREVIOUS_COMMIT" "$TARGET")
  for service in "${ALL_SERVICES[@]}"; do
    service_selected "$service" && SERVICES+=("$service")
  done
  [[ "${#SERVICES[@]}" -gt 0 ]] || fail 'target has no production runtime changes'
}

# ---------- preflight ----------

[[ "$PLAN_ONLY" -eq 0 ]] && [[ "$EUID" -ne 0 ]] && fail 'run as root'
[[ "$BRANCH" =~ ^[0-9]{8}$ ]] || fail 'branch must be YYYYMMDD'
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || fail 'target must be a full commit hash'

set_phase preflight
cd "$REPO"
[[ "$(git symbolic-ref --short HEAD)" == "$BRANCH" ]] || fail 'server branch mismatch'
[[ -z "$(git status --porcelain)" ]] || fail 'server worktree is dirty'

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
git fetch origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
[[ "$(git rev-parse "origin/$BRANCH")" == "$TARGET" ]] || fail 'remote tip mismatch'
git merge-base --is-ancestor "$PREVIOUS_COMMIT" "$TARGET" || fail 'target is not a fast-forward'

select_release_services
printf '[RELEASE_SCOPE] services=%s\n' "${SERVICES[*]}"

if [[ "$PLAN_ONLY" -eq 1 ]]; then
  printf '[RELEASE_PLAN_OK]\n'
  printf 'branch=%s\ntarget=%s\nprevious_commit=%s\nservices=%s\n' \
    "$BRANCH" "$TARGET" "$PREVIOUS_COMMIT" "${SERVICES[*]}"
  git -c core.quotepath=false diff --name-only "$PREVIOUS_COMMIT" "$TARGET" | sed 's/^/changed_file=/'
  write_progress planned
  release_event complete "services=${SERVICES[*]}"
  exit 0
fi

# ---------- 记录旧状态（供 AI 回滚参考） ----------

for service in "${SERVICES[@]}"; do
  OLD_IMAGES[$service]="$(docker inspect -f '{{.Image}}' "$service")"
  OLD_REVISIONS[$service]="$(docker inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$service")"
  [[ "${OLD_REVISIONS[$service]}" =~ ^[0-9a-f]{40}$ ]] || OLD_REVISIONS[$service]="$PREVIOUS_COMMIT"
done

# ---------- 快进 + 构建 + 替换 ----------

git merge --ff-only "$TARGET"
[[ "$(git rev-parse HEAD)" == "$TARGET" ]] || fail 'checkout did not reach target'
export RELEASE_VERSION="$TARGET"

set_phase build
for service in "${SERVICES[@]}"; do
  release_event service_begin "service=$service"
  if [[ "$service" == 'tzl_admin_web' ]]; then
    docker compose --profile prod build --no-cache "$service"
  else
    docker compose --profile prod build "$service"
  fi
  release_event service_complete "service=$service"
done

set_phase deploy
DEPLOY_STARTED=1
docker compose --profile prod up -d --no-deps "${SERVICES[@]}"

# 后端或网关变更后刷新 nginx upstream（重新解析容器地址）
if service_selected tzl_node || service_selected tzl_admin_node || service_selected tzl_nginx; then
  docker exec tzl_nginx nginx -t
  docker exec tzl_nginx nginx -s reload
fi

# ---------- 基础验证：容器 running（健康/稳定性由 AI 外层验证） ----------

set_phase verify
for service in "${SERVICES[@]}"; do
  docker inspect -f '{{.State.Status}}' "$service" | grep -qx 'running' \
    || fail "$service not running after deploy"
done

# ---------- 完成 ----------

DEPLOY_STARTED=0
release_event complete
write_progress complete

printf '[RELEASE_OK]\n'
printf 'branch=%s\ncommit=%s\nprevious_commit=%s\nservices=%s\n' \
  "$BRANCH" "$TARGET" "$PREVIOUS_COMMIT" "${SERVICES[*]}"
for service in "${SERVICES[@]}"; do
  docker inspect -f 'service={{.Name}} state={{.State.Status}} image={{.Image}}' "$service"
  printf 'previous_runtime_%s=%s\n' "$service" "${OLD_REVISIONS[$service]}"
done
printf 'note=health/stability/error_scan/rollback delegated to AI\n'
