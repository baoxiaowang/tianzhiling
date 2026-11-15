#!/usr/bin/env bash
#
# 一条命令发布到生产（天之灵）
#
#   ./scripts/release-production.sh                 # 发布当前 HEAD
#   ./scripts/release-production.sh --dry-run       # 只打印计划，不动线上
#   ./scripts/release-production.sh --approve       # 受保护文件变更时自动加白名单
#   ./scripts/release-production.sh --branch 20261006 --services tzl_admin_node,tzl_admin_web
#
# 它做了什么：
#   1. 检查工作区干净，取当前提交（必须是 40 位 sha）
#   2. 推送到 origin/<branch>；本地到 GitHub 不通时，自动用 git bundle
#      把提交送到服务器、在服务器上 rebase 到 origin 最新提交后由服务器推送
#   3. 调 /usr/local/sbin/tzl-deploy-release 发布（重建 tzl_node 并替换）
#   4. 根据改动范围自动判断要补齐哪些后台服务（admin-node / admin-web），
#      用 recover 重建并替换（不重建 node）
#   5. 校验线上健康与版本，打印汇总
#
# 环境变量（一般不用改）：
#   RELEASE_HOST     默认 root@1.13.18.200
#   RELEASE_KEY      默认 ~/.ssh/id_ed25519_tianzhiling_deploy_20260802
#   RELEASE_BRANCH   默认 20261006
#   RELEASE_SERVICES 覆盖自动判断，如 tzl_admin_node,tzl_admin_web
#
# 退出码：0 成功；非 0 失败（失败时会打印失败阶段）。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${RELEASE_HOST:-root@1.13.18.200}"
KEY="${RELEASE_KEY:-$HOME/.ssh/id_ed25519_tianzhiling_deploy_20260802}"
BRANCH="${RELEASE_BRANCH:-20261006}"
SERVICES_OVERRIDE="${RELEASE_SERVICES:-}"

SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=15)
SSH=(ssh "${SSH_OPTS[@]}" "$HOST")
SCP=(scp -q "${SSH_OPTS[@]}")

DRY_RUN=0
APPROVE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --approve) APPROVE=1 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg（--help 查看用法）" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
run_ssh() { "${SSH[@]}" "$@"; }
scp_to() { "${SCP[@]}" "$1" "$HOST:$2"; }

cd "$ROOT"

# ---------------------------------------------------------------------------
# 1. 本地预检
# ---------------------------------------------------------------------------
step "本地预检"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "不在 git 仓库内"
if [[ -n "$(git status --porcelain)" ]]; then
  die "工作区不干净，请先提交或 stash：
$(git status --short | head -20)"
fi

TARGET="$(git rev-parse HEAD)"
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || die "无法解析当前提交"
SHORT="${TARGET:0:8}"
ok "本地 HEAD = $SHORT（$BRANCH）"

if ! run_ssh 'test -x /usr/local/sbin/tzl-deploy-release'; then
  die "服务器不可达或发布脚本不存在：$HOST"
fi
PREV="$(run_ssh "cd /opt/tianzhiling && git rev-parse HEAD")"
PREV_SHORT="${PREV:0:8}"
ok "线上当前 = $PREV_SHORT"

if [[ "$PREV" == "$TARGET" ]]; then
  warn "线上已经是 $SHORT，本次发布将是空操作（仍会做健康检查）"
fi

# ---------------------------------------------------------------------------
# 2. 同步提交到 origin（直连失败时走服务器中转）
# ---------------------------------------------------------------------------
step "同步提交到 origin/$BRANCH"
PUSH_MODE=""
if [[ "$DRY_RUN" == "1" ]]; then
  PUSH_MODE="direct（dry-run 不执行）"
elif git push origin "$TARGET:refs/heads/$BRANCH" >/dev/null 2>&1; then
  PUSH_MODE="direct"
  ok "已直接推送到 origin/$BRANCH"
else
  warn "直接推送失败（本地到 GitHub 不通），改用服务器中转"
  BUNDLE="/tmp/tzl-release-$$.bundle"
  git bundle create "$BUNDLE" HEAD >/dev/null 2>&1 || die "创建 git bundle 失败"
  scp_to "$BUNDLE" "/tmp/tzl-release.bundle" || die "bundle 上传失败"
  NEW_TARGET="$(run_ssh "bash -s" <<REMOTE
set -e
cd /opt/tianzhiling
if [[ -n "\$(git status --porcelain)" ]]; then
  echo "DIRTY" >&2
  exit 3
fi
git fetch origin '$BRANCH' >/dev/null 2>&1
git fetch /tmp/tzl-release.bundle HEAD >/dev/null 2>&1
git checkout -q -B tzl-release-tmp FETCH_HEAD
if ! git rebase "origin/$BRANCH" >/tmp/tzl-release-rebase.log 2>&1; then
  git rebase --abort >/dev/null 2>&1 || true
  echo "REBASE_FAILED" >&2
  exit 4
fi
git push origin "HEAD:refs/heads/$BRANCH" >/dev/null 2>&1
NEW=\$(git rev-parse HEAD)
git checkout -q '$BRANCH'
git branch -D tzl-release-tmp >/dev/null 2>&1 || true
echo "\$NEW"
REMOTE
)"
  case "$NEW_TARGET" in
    ""|DIRTY|REBASE_FAILED)
      die "服务器中转失败（$NEW_TARGET），请查看 /tmp/tzl-release-rebase.log"
      ;;
  esac
  [[ "$NEW_TARGET" =~ ^[0-9a-f]{40}$ ]] || die "服务器返回的提交号不合法：$NEW_TARGET"
  TARGET="$NEW_TARGET"
  SHORT="${TARGET:0:8}"
  PUSH_MODE="bundle + 服务器 rebase"
  ok "已在服务器 rebase 并推送：$SHORT"
fi

# ---------------------------------------------------------------------------
# 3. 发布（重建 tzl_node）
# ---------------------------------------------------------------------------
step "发布 $SHORT 到生产（tzl_node）"
if [[ "$DRY_RUN" == "1" ]]; then
  warn "dry-run：跳过 tzl-deploy-release"
else
  RELEASE_LOG="/tmp/tzl-release-$$.log"
  run_ssh "cd /opt/tianzhiling && LC_ALL=en_US.utf8 LANG=en_US.utf8 /usr/local/sbin/tzl-deploy-release $BRANCH $TARGET" >"$RELEASE_LOG" 2>&1
  RELEASE_RC=$?
  if [[ "$RELEASE_RC" == "77" ]]; then
    warn "目标提交包含受保护文件变更，需要审批"
    grep -A 40 'APPROVAL_REQUIRED' "$RELEASE_LOG" | head -40 || true
    if [[ "$APPROVE" == "1" ]]; then
      warn "--approve 已开启：把 $SHORT 加入发布白名单后重试"
      run_ssh "python3 -" <<PY
import io, re, shutil, datetime
p = '/usr/local/sbin/tzl-deploy-release'
shutil.copy2(p, p + '.bak-' + datetime.datetime.now().strftime('%Y%m%d%H%M%S'))
s = io.open(p, encoding='utf-8').read()
T = '$TARGET'
m = re.search(r"RELEASE_APPROVED_TARGETS='([^']*)'", s)
items = m.group(1).split()
if T not in items:
    items.append(T)
    s = s[:m.start(1)] + ' '.join(items) + s[m.end(1):]
    io.open(p, 'w', encoding='utf-8').write(s)
print('whitelisted', T)
PY
      run_ssh "cd /opt/tianzhiling && LC_ALL=en_US.utf8 LANG=en_US.utf8 /usr/local/sbin/tzl-deploy-release $BRANCH $TARGET" >"$RELEASE_LOG" 2>&1
      RELEASE_RC=$?
    fi
  fi
  if [[ "$RELEASE_RC" != "0" ]]; then
    tail -30 "$RELEASE_LOG" || true
    die "发布失败（rc=$RELEASE_RC），日志：$RELEASE_LOG"
  fi
  ok "发布完成（$(grep -oE 'RELEASE_OK|RELEASE_NOOP' "$RELEASE_LOG" | head -1)）"
fi

# ---------------------------------------------------------------------------
# 4. 自动判断需要补齐的后台服务
# ---------------------------------------------------------------------------
step "检查后台服务是否需要重建"
if [[ "$DRY_RUN" == "1" ]]; then
  CHANGED=""
  warn "dry-run：跳过改动范围分析（真实发布时会自动判断）"
elif [[ "$PREV" == "$TARGET" ]]; then
  CHANGED=""
else
  CHANGED="$(run_ssh "cd /opt/tianzhiling && git diff --name-only $PREV $TARGET")"
fi

SERVICES=""
if [[ -n "$SERVICES_OVERRIDE" ]]; then
  SERVICES="$SERVICES_OVERRIDE"
  ok "使用指定的服务：$SERVICES"
else
  NEED_ADMIN_WEB=0
  NEED_ADMIN_NODE=0
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    case "$file" in
      apps/admin/*) NEED_ADMIN_WEB=1 ;;
      apps/admin-node/*|packages/entities/*|packages/shared/*) NEED_ADMIN_NODE=1 ;;
    esac
  done <<< "$CHANGED"

  [[ "$NEED_ADMIN_NODE" == "1" ]] && SERVICES="tzl_admin_node"
  if [[ "$NEED_ADMIN_WEB" == "1" ]]; then
    [[ -n "$SERVICES" ]] && SERVICES="$SERVICES,tzl_admin_web" || SERVICES="tzl_admin_web"
  fi
  if [[ -z "$SERVICES" ]]; then
    ok "本次改动不涉及后台服务，跳过 recover"
  else
    ok "需要重建：$SERVICES"
  fi
fi

# ---------------------------------------------------------------------------
# 5. recover 重建后台服务
# ---------------------------------------------------------------------------
if [[ -n "$SERVICES" ]]; then
  step "重建并部署 $SERVICES"
  if [[ "$DRY_RUN" == "1" ]]; then
    warn "dry-run：跳过 recover"
  else
    RECOVER_LOG="/tmp/tzl-recover-$$.log"
    run_ssh "cd /opt/tianzhiling && RECOVER_APPROVED_TARGETS=$TARGET RECOVER_DEPLOY_UNVERSIONED=$SERVICES LC_ALL=en_US.utf8 LANG=en_US.utf8 /usr/local/sbin/tzl-deploy-release recover $BRANCH $TARGET $SERVICES" >"$RECOVER_LOG" 2>&1
    RECOVER_RC=$?
    if [[ "$RECOVER_RC" != "0" ]]; then
      tail -30 "$RECOVER_LOG" || true
      die "recover 失败（rc=$RECOVER_RC），日志：$RECOVER_LOG"
    fi
    ok "后台服务已重建"
  fi
fi

# ---------------------------------------------------------------------------
# 6. 线上校验
# ---------------------------------------------------------------------------
step "线上校验"
if [[ "$DRY_RUN" == "1" ]]; then
  warn "dry-run：跳过健康检查"
else
  API_CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://tianzhiling.chat/api/system/health || echo 000)"
  ADMIN_CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' https://admin.tianzhiling.chat/admin_api/system/health || echo 000)"
  NODE_VER="$(run_ssh 'docker exec tzl_node printenv RELEASE_VERSION 2>/dev/null' || true)"
  ADMIN_VER="$(run_ssh 'docker exec tzl_admin_node printenv RELEASE_VERSION 2>/dev/null' || true)"

  printf '  %-14s %s\n' '接口健康' "$API_CODE"
  printf '  %-14s %s\n' '后台健康' "$ADMIN_CODE"
  printf '  %-14s %s\n' 'tzl_node' "$NODE_VER"
  printf '  %-14s %s\n' 'tzl_admin_node' "$ADMIN_VER"

  [[ "$API_CODE" == "200" ]] || die "接口健康检查失败：$API_CODE"
  [[ "$ADMIN_CODE" == "200" ]] || die "后台健康检查失败：$ADMIN_CODE"
  [[ "$NODE_VER" == "$TARGET" ]] || warn "tzl_node 版本不是目标提交（$NODE_VER != $SHORT）"

  printf '\n\033[32m✓ 发布完成：%s（%s）\033[0m\n' "$SHORT" "$PUSH_MODE"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  printf '\n\033[36m发布计划（dry-run）\033[0m\n'
  printf '  %-14s %s\n' '目标提交' "$SHORT"
  printf '  %-14s %s\n' '分支' "$BRANCH"
  printf '  %-14s %s\n' '同步方式' "$PUSH_MODE"
  printf '  %-14s %s\n' '线上当前' "$PREV_SHORT"
  printf '  %-14s %s\n' '后台服务' "${SERVICES:-（自动判断）}"
  printf '\n  去掉 --dry-run 即会真正执行。\n'
fi
