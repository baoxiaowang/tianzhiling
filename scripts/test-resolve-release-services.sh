#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOLVER="$SCRIPT_DIR/resolve-release-services.sh"

assert_services() {
  local name="$1"
  local expected="$2"
  local paths="$3"
  local actual

  actual="$(printf '%s\n' "$paths" | bash "$RESOLVER" --stdin | paste -sd ' ' -)"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL %s: expected [%s], got [%s]\n' "$name" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'PASS %s\n' "$name"
}

assert_services \
  'admin voice change' \
  'tzl_admin_node tzl_admin_web' \
  $'apps/admin-node/src/service/voice.ts\napps/admin/src/views/voice.vue\ndocs/voice.md'
assert_services \
  'shared package change' \
  'tzl_node tzl_memory_worker tzl_admin_node tzl_admin_web' \
  'packages/shared/src/index.ts'
assert_services \
  'node change includes memory worker' \
  'tzl_node tzl_memory_worker' \
  'apps/node/src/service/conversation.service.ts'
assert_services \
  'gateway-only change' \
  'tzl_nginx' \
  'apps/gateway/nginx.conf'
assert_services \
  'documentation-only change' \
  '' \
  $'docs/release.md\nREADME.md'
assert_services \
  'unknown production path falls back safely' \
  'tzl_node tzl_memory_worker tzl_admin_node tzl_admin_web tzl_nginx' \
  'infrastructure/new-runtime.conf'

# ── compose 变更按内容归属服务（真实临时 git 仓库） ──────────────────────────
TMP_REPO="$(mktemp -d)"
cleanup_tmp_repo() { rm -rf -- "$TMP_REPO"; }
trap cleanup_tmp_repo EXIT

cd "$TMP_REPO"
git init -q
git config user.email test@example.com
git config user.name test
cat > docker-compose.yml <<'YAML'
services:
  tzl_node:
    image: a
  tzl_memory_worker:
    image: a
  tzl_admin_node:
    image: b
  tzl_admin_web:
    image: c
  tzl_nginx:
    image: d
volumes:
  data:
YAML
git add docker-compose.yml
git commit -qm base
BASE_COMPOSE="$(git rev-parse HEAD)"

commit_variant() {
  local branch="$1"
  shift
  git checkout -q "$BASE_COMPOSE"
  git checkout -q -b "$branch"
  "$@"
  git add docker-compose.yml
  git commit -qm "$branch"
  git rev-parse HEAD
}

add_worker_cpus() {
  awk '
    /^  tzl_memory_worker:$/ { print; print "    cpus: \"1.5\""; next }
    { print }
  ' docker-compose.yml > docker-compose.yml.next
  mv docker-compose.yml.next docker-compose.yml
}
add_nginx_restart() {
  awk '
    /^  tzl_nginx:$/ { print; print "    restart: always"; next }
    { print }
  ' docker-compose.yml > docker-compose.yml.next
  mv docker-compose.yml.next docker-compose.yml
}
add_top_level_volume() {
  awk '
    /^  data:$/ { print; print "  extra:"; next }
    { print }
  ' docker-compose.yml > docker-compose.yml.next
  mv docker-compose.yml.next docker-compose.yml
}
add_worker_and_nginx() {
  add_worker_cpus
  add_nginx_restart
}

assert_compose_services() {
  local name="$1"
  local target="$2"
  local expected="$3"
  local actual

  actual="$(bash "$RESOLVER" "$BASE_COMPOSE" "$target" | paste -sd ' ' -)"
  if [[ "$actual" != "$expected" ]]; then
    printf 'FAIL %s: expected [%s], got [%s]\n' "$name" "$expected" "$actual" >&2
    exit 1
  fi
  printf 'PASS %s\n' "$name"
}

WORKER_COMMIT="$(commit_variant worker add_worker_cpus)"
assert_compose_services 'worker-only compose selects only memory worker' \
  "$WORKER_COMMIT" 'tzl_memory_worker'

NGINX_COMMIT="$(commit_variant nginx add_nginx_restart)"
assert_compose_services 'real nginx config change selects nginx' \
  "$NGINX_COMMIT" 'tzl_nginx'

GLOBAL_COMMIT="$(commit_variant global add_top_level_volume)"
assert_compose_services 'top-level compose change falls back to all services' \
  "$GLOBAL_COMMIT" 'tzl_node tzl_memory_worker tzl_admin_node tzl_admin_web tzl_nginx'

MULTI_COMMIT="$(commit_variant multi add_worker_and_nginx)"
assert_compose_services 'multi-service compose change selects both services' \
  "$MULTI_COMMIT" 'tzl_memory_worker tzl_nginx'

# 分类器自身：worker-only 不返回 nginx/admin_web
git checkout -q "$WORKER_COMMIT"
git -c core.quotepath=false diff -U0 "$BASE_COMPOSE" "$WORKER_COMMIT" -- docker-compose.yml > "$TMP_REPO/w.diff"
CLASSIFIED="$(bash "$SCRIPT_DIR/classify-compose-services.sh" docker-compose.yml "$TMP_REPO/w.diff" | paste -sd ' ' -)"
if [[ "$CLASSIFIED" != 'tzl_memory_worker' ]]; then
  printf 'FAIL classifier worker-only: got [%s]\n' "$CLASSIFIED" >&2
  exit 1
fi
printf 'PASS classifier worker-only excludes nginx/admin_web\n'

printf 'release service resolver tests passed\n'
