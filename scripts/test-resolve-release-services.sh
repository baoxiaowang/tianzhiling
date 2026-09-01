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
  'tzl_node tzl_admin_node tzl_admin_web' \
  'packages/shared/src/index.ts'
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
  'tzl_node tzl_admin_node tzl_admin_web tzl_nginx' \
  'infrastructure/new-runtime.conf'

printf 'release service resolver tests passed\n'
