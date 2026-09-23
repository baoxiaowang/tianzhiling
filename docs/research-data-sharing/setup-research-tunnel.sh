#!/usr/bin/env bash
# 天之灵 · 生产库受限只读 SSH 通道（所有者）—— **一次性安装脚本（非幂等）**
#
# 形态：外部 Agent（所有者本机）
#         └─ 独立 SSH 密钥受限转发（permitopen 仅 127.0.0.1:17271）
#              └─ 生产主机 tzl_mongo:27017
#                   └─ MongoDB 专用只读账号 research_ro_owner_01
#
# 本脚本做什么（只这一次）：
#   1. 全部**只读预检**（root、仓库与 .env、tzl_mongo、管理认证、sshd 能力、目标对象是否已存在）；
#   2. 创建 7 个只读视图 + 1 个专用只读角色 + 1 个只读账号（MongoDB 侧，见 mongo-owner-readonly.js）；
#   3. 创建锁定密码、只允许公钥、仅允许 127.0.0.1:17271 端口转发的专用 Linux 用户；
#   4. 把数据库口令写入 root-only 目录（0700/0600），只打印路径，绝不打印口令。
#
# 本脚本明确不做：
#   - 不幂等：任一目标对象（Linux 用户 / MongoDB 账号 / 角色 / 7 个视图名）已存在就停止并报告；
#   - **不删除任何**已有用户、角色、集合、视图、索引或数据；
#   - 不建分析副本、不建分析 API/MCP 服务、不建通用机构管理系统；
#   - 不开启 profiler、不建索引、不修改任何现有业务 MongoDB 账号；
#   - 不改 docker-compose.yml、不重建容器、不改安全组（见实施单的生产执行顺序）。
#
# 用法（在生产主机上，以 root 执行）：
#   sudo bash /opt/tianzhiling/docs/research-data-sharing/setup-research-tunnel.sh
# 建议把输出留证到 root-only 目录：
#   sudo install -d -m 700 /root/tzl-research-evidence
#   sudo bash .../setup-research-tunnel.sh 2>&1 | sudo tee /root/tzl-research-evidence/install-$(date +%Y%m%d-%H%M%S).log
#   sudo chmod 600 /root/tzl-research-evidence/install-*.log
set -Eeuo pipefail

# ------------------------------------------------------------------ 配置

# 所有者正式公钥（公钥不是秘密；可用 OWNER_PUB_KEY 或 OWNER_PUB_FILE 覆盖）。
OWNER_PUB_DEFAULT='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGAP8rjJiNvJ2It+BuL2uqDw6fnvG1uqUTwVzNws7PbR tzl-research-tunnel-owner-20260923'
OWNER_KEY_COMMENT='tzl-research-tunnel-owner-20260923'

OWNER_LINUX_USER='tzl_research_owner'
OWNER_DB_USER='research_ro_owner_01'
ROLE_NAME='research_ro_owner_role_01'
FORWARD_PORT='17271'

REPO_DIR="${REPO_DIR:-/opt/tianzhiling}"
MONGO_CONTAINER="${MONGO_CONTAINER:-tzl_mongo}"
CREDS_DIR="${CREDS_DIR:-/root/tzl-research-credentials}"
CREDS_FILE="${CREDS_FILE:-${CREDS_DIR}/${OWNER_DB_USER}.txt}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_SCRIPT="${MONGO_SCRIPT:-${SCRIPT_DIR}/mongo-owner-readonly.js}"

log() { printf '[research-db] %s\n' "$*"; }
fail() { printf '[research-db][STOP] %s\n' "$*" >&2; exit 1; }

if [[ $# -gt 0 ]]; then
  printf 'usage: sudo bash %s   (no arguments; see the header comment)\n' "$(basename "$0")" >&2
  exit 2
fi

log '=== 一次性安装：生产库受限只读 SSH 通道（所有者） ==='
log "host=$(hostname) date=$(date -Is) script=${BASH_SOURCE[0]}"

# ------------------------------------------------- 阶段 1：只读预检（先全部完成）

log '[1/6] 只读预检：身份、仓库、环境文件'

[[ "${EUID}" -eq 0 ]] || fail 'must run as root (sudo)'
for tool in docker sshd openssl useradd install; do
  command -v "${tool}" >/dev/null 2>&1 || fail "required command not found: ${tool}"
done

NOLOGIN_SHELL="$(command -v nologin || true)"
[[ -n "${NOLOGIN_SHELL}" ]] || fail 'nologin shell not found (needed for the port-forward-only user)'

[[ -f "${REPO_DIR}/docker-compose.yml" ]] || fail "not the expected repo: ${REPO_DIR}/docker-compose.yml not found"
[[ -f "${REPO_DIR}/.env" ]] || fail "expected env file not found: ${REPO_DIR}/.env"
grep -q 'tzl_mongo' "${REPO_DIR}/docker-compose.yml" || fail "tzl_mongo not found in ${REPO_DIR}/docker-compose.yml"

log '[1/6] 只读预检：业务 Mongo 管理凭据（值不打印）'
set +u
set -a
# shellcheck disable=SC1090
source "${REPO_DIR}/.env"
set +a
set -u

MONGO_AUTH_SOURCE="${MONGO_AUTH_SOURCE:-admin}"
DB_NAME="${MONGO_DB:-tzl}"
: "${MONGO_USERNAME:?MONGO_USERNAME missing in ${REPO_DIR}/.env}"
: "${MONGO_PASSWORD:?MONGO_PASSWORD missing in ${REPO_DIR}/.env}"
log "  admin user=${MONGO_USERNAME} authSource=${MONGO_AUTH_SOURCE} db=${DB_NAME} (password not printed)"

log '[1/6] 只读预检：tzl_mongo 运行状态与转发端口'
docker inspect -f '{{.State.Running}}' "${MONGO_CONTAINER}" 2>/dev/null | grep -q '^true$' \
  || fail "container ${MONGO_CONTAINER} is not running"
docker exec "${MONGO_CONTAINER}" mongosh --version >/dev/null 2>&1 \
  || fail "mongosh not available inside ${MONGO_CONTAINER}"

EFFECTIVE_PORT="${MONGO_PORT:-${FORWARD_PORT}}"
if [[ "${EFFECTIVE_PORT}" != "${FORWARD_PORT}" ]]; then
  fail "tzl_mongo is published on host port ${EFFECTIVE_PORT} but this script permits only 127.0.0.1:${FORWARD_PORT}; align MONGO_PORT or the script before installing"
fi
grep -qE "\{[[:space:]]*MONGO_PORT:-${FORWARD_PORT}[[:space:]]*\}|:${FORWARD_PORT}:27017" "${REPO_DIR}/docker-compose.yml" \
  || fail "could not confirm that docker-compose.yml publishes tzl_mongo on ${FORWARD_PORT}"

log '[1/6] 只读预检：管理认证可用'
docker exec "${MONGO_CONTAINER}" mongosh \
  -u "${MONGO_USERNAME}" -p "${MONGO_PASSWORD}" \
  --authenticationDatabase "${MONGO_AUTH_SOURCE}" --quiet \
  --eval 'if (db.adminCommand({ ping: 1 }).ok !== 1) { quit(2) }' >/dev/null \
  || fail 'MongoDB admin authentication failed (check MONGO_USERNAME/MONGO_PASSWORD)'

log '[1/6] 只读预检：sshd 支持公钥认证与本地转发'
SSHD_CONFIG="$(sshd -T 2>/dev/null)" || fail 'sshd -T failed; cannot verify sshd capabilities'
printf '%s\n' "${SSHD_CONFIG}" | grep -qiE '^pubkeyauthentication yes' \
  || fail 'sshd: PubkeyAuthentication is not enabled'

# AllowTcpForwarding 只接受 yes 或 local（local 才允许 -L 本地转发；no/remote 都不行）。
CURRENT_FORWARD="$(printf '%s\n' "${SSHD_CONFIG}" | awk 'tolower($1)=="allowtcpforwarding" {print tolower($2)}' | tail -1)"
case "${CURRENT_FORWARD}" in
  yes|local) : ;;
  *) fail "sshd: AllowTcpForwarding=${CURRENT_FORWARD:-unset} is not 'yes' or 'local'; the restricted local-forward tunnel cannot work" ;;
esac

# AuthorizedKeysFile 必须实际包含 .ssh/authorized_keys，否则本脚本写的密钥不会被读取。
AK_FILE_SETTING="$(printf '%s\n' "${SSHD_CONFIG}" | awk 'tolower($1)=="authorizedkeysfile" {print $2, $3, $4}')"
if ! printf '%s' "${AK_FILE_SETTING}" | grep -q '\.ssh/authorized_keys'; then
  fail "sshd: AuthorizedKeysFile='${AK_FILE_SETTING:-unset}' does not include .ssh/authorized_keys; keys cannot be installed"
fi

GLOBAL_PERMITOPEN="$(printf '%s\n' "${SSHD_CONFIG}" | awk 'tolower($1)=="permitopen" {print $2}' | tr '\n' ' ')"
log "  allowtcpforwarding=${CURRENT_FORWARD} authorizedkeysfile=${AK_FILE_SETTING} permitopen(global)=${GLOBAL_PERMITOPEN:-none}"
log '  说明：permitopen 写在 authorized_keys 的单键选项里，优先于全局 PermitOpen。'
log '  说明：AllowUsers/DenyUsers 等访问列表已不再由本脚本判断，最终以新建 ssh -N 连接实测为准。'

log '[1/6] 只读预检：目标对象是否已存在（任一存在即停止）'
if id -u "${OWNER_LINUX_USER}" >/dev/null 2>&1; then
  fail "linux user already exists: ${OWNER_LINUX_USER} (this script never modifies/removes it; resolve manually)"
fi
if [[ -e "${CREDS_FILE}" ]]; then
  fail "credentials file already exists: ${CREDS_FILE} (refusing to overwrite a password)"
fi
if [[ -d "${CREDS_DIR}" ]] && find "${CREDS_DIR}" -maxdepth 1 -name "${OWNER_DB_USER}.txt" | grep -q .; then
  fail "credentials for ${OWNER_DB_USER} already present in ${CREDS_DIR}"
fi
[[ -f "${MONGO_SCRIPT}" ]] || fail "mongodb provisioning script not found: ${MONGO_SCRIPT}"
grep -q '__OWNER_PWD__' "${MONGO_SCRIPT}" || fail "unexpected ${MONGO_SCRIPT}: placeholder __OWNER_PWD__ missing"

# ------------------------------------------------- 阶段 2：先落盘口令（root-only）

log '[2/6] 先创建 root-only 凭据目录并落盘口令（后续步骤失败也不会丢口令）'
install -d -m 700 "${CREDS_DIR}"
umask 077

# openssl rand -hex 16：32 位十六进制，只用字母数字，且没有管道，避免 pipefail 下 SIGPIPE。
owner_pwd="$(openssl rand -hex 16)"
[[ "${#owner_pwd}" -eq 32 ]] || fail 'failed to generate a 32-char hex password'
printf '%s' "${owner_pwd}" > "${CREDS_FILE}"
chmod 600 "${CREDS_FILE}"
chown root:root "${CREDS_FILE}" 2>/dev/null || true
log "  password file : ${CREDS_FILE} (0600 root:root) — 口令不打印"

# ------------------------------------------------- 阶段 3：MongoDB 侧创建

log '[3/6] MongoDB：只读预检 + 创建 7 视图 / 1 角色 / 1 账号'
log '       （脚本内部先做只读预检：视图名冲突、源集合存在、13 个集合存在、角色与账号是否已存在；任一不满足即整体拒绝）'

mongo_script_text="$(<"${MONGO_SCRIPT}")"
mongo_script_text="${mongo_script_text//__DB_NAME__/${DB_NAME}}"
mongo_script_text="${mongo_script_text//__OWNER_DB_USER__/${OWNER_DB_USER}}"
mongo_script_text="${mongo_script_text//__ROLE_NAME__/${ROLE_NAME}}"
mongo_script_text="${mongo_script_text//__OWNER_PWD__/${owner_pwd}}"

set +e
mongo_output="$(printf '%s' "${mongo_script_text}" | docker exec -i "${MONGO_CONTAINER}" mongosh \
  -u "${MONGO_USERNAME}" -p "${MONGO_PASSWORD}" \
  --authenticationDatabase "${MONGO_AUTH_SOURCE}" --quiet --file /dev/stdin 2>&1)"
mongo_rc=$?
set -e
printf '%s\n' "${mongo_output}"

case "${mongo_rc}" in
  0) log '  MongoDB 侧创建完成' ;;
  3) fail "MongoDB 侧预检未通过（存在同名视图/角色/账号，或批准的集合并未全部存在）：未创建任何 MongoDB 对象，也未改动任何已有对象；口令已落盘于 ${CREDS_FILE}，禁止直接重跑，请按日志人工处理" ;;
  *) fail "MongoDB 侧执行失败（exit=${mongo_rc}）；口令已落盘于 ${CREDS_FILE}，禁止直接重跑，请人工确认并恢复/回滚后再决定是否重新安装" ;;
esac
unset mongo_script_text mongo_output

# ------------------------------------------------- 阶段 4：Linux 用户与密钥

log '[4/6] Linux：创建仅端口转发的受限用户'
useradd --create-home --shell "${NOLOGIN_SHELL}" "${OWNER_LINUX_USER}"
passwd -l "${OWNER_LINUX_USER}" >/dev/null
chmod 700 "/home/${OWNER_LINUX_USER}"
install -d -m 700 -o "${OWNER_LINUX_USER}" -g "${OWNER_LINUX_USER}" "/home/${OWNER_LINUX_USER}/.ssh"

if [[ -n "${OWNER_PUB_FILE:-}" ]]; then
  OWNER_PUB="$(<"${OWNER_PUB_FILE}")"
else
  OWNER_PUB="${OWNER_PUB_KEY:-${OWNER_PUB_DEFAULT}}"
fi

# 选项顺序很重要：restrict 会隐含 no-port-forwarding，必须在它之后再显式打开 port-forwarding。
AUTHORIZED_KEY_LINE="restrict,port-forwarding,permitopen=\"127.0.0.1:${FORWARD_PORT}\",no-agent-forwarding,no-x11-forwarding,no-pty,no-user-rc,command=\"/bin/false\" ${OWNER_PUB}"
AK="/home/${OWNER_LINUX_USER}/.ssh/authorized_keys"
printf '%s\n' "${AUTHORIZED_KEY_LINE}" > "${AK}"
chmod 600 "${AK}"
chown "${OWNER_LINUX_USER}:${OWNER_LINUX_USER}" "${AK}"
log "  user=${OWNER_LINUX_USER} shell=${NOLOGIN_SHELL} password=locked keys=1"
log "  authorized_keys: restrict + port-forwarding + permitopen=127.0.0.1:${FORWARD_PORT} + no-pty/no-agent/no-x11/no-user-rc + command=/bin/false"

# ------------------------------------------------- 阶段 5：记录元数据（不含口令）

log '[5/6] 记录元数据（不含口令）'
unset owner_pwd

META_FILE="${CREDS_DIR}/${OWNER_DB_USER}.meta"
cat > "${META_FILE}" <<META
created_at=$(date -Is)
host=$(hostname)
repo=${REPO_DIR}
db=${DB_NAME}
mongodb_user=${OWNER_DB_USER}
mongodb_role=${ROLE_NAME}
views=user_ro,message_ro,conversation_ro,agent_ro,post_ro,post_comment_ro,user_membership_ro
direct_collections=13
linux_user=${OWNER_LINUX_USER}
permitopen=127.0.0.1:${FORWARD_PORT}
password_file=${CREDS_FILE}
META
chmod 600 "${META_FILE}"
log "  metadata file : ${META_FILE} (0600, 不含口令)"

# ------------------------------------------------- 阶段 6：完成提示

log '[6/6] 完成。下一步（生产执行顺序，需人工执行）'
log "  0) 若任一步骤以非零退出：禁止直接重跑。先看日志与 ${CREDS_FILE}，人工恢复或回滚（§6）后再决定。"
log '  1) 所有者本机建立隧道（口令经安全渠道取自 root-only 文件）：'
log "     ssh -N -L 17017:127.0.0.1:${FORWARD_PORT} ${OWNER_LINUX_USER}@<生产主机> -i <所有者私钥>"
log "     mongosh 'mongodb://${OWNER_DB_USER}@127.0.0.1:17017/${DB_NAME}?authSource=admin'"
log '  2) 实际读取已批准数据并核验权限（拒绝原始敏感集合、越权集合与写操作）'
log '  3) 隧道稳定后，在云安全组关闭公网 17271，并从外部确认 <生产主机>:17271 不可直连'
log '  4) 低峰期把 docker-compose.yml 改为 127.0.0.1:${MONGO_PORT:-17271}:27017 并只重建 tzl_mongo'
log '  5) 检查聊天、后台、记忆服务与三个业务容器；外部机构确定后另建其独立 Linux/MongoDB 身份'
log ''
log '  仍未验证（必须在生产主机上完成）：sshd 实际接受该 authorized_keys 选项、真实隧道可建立、'
log '  安全组与 compose 绑定生效、业务容器在容器重建后正常。'
