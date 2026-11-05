#!/usr/bin/env bash
#
# build-brand.sh — 单代码库多品牌构建入口
#
# 用法:
#   sh scripts/build-brand.sh <brand> [target]
#
#   brand   必填: tianzhiling | weiliaoyan（与 brand/<brand>.json 对应）
#   target  可选: weapp | app | admin | admin-node | node | gateway
#           不传则只打印当前品牌环境，不执行构建。
#
# 说明:
#   - 品牌唯一真值源是 brand/<brand>.json，本脚本读取它并把品牌字段导出为
#     环境变量，供各端构建时注入（Flutter --dart-define / Taro defineConstants /
#     Vite define / Node .env）。
#   - 未传入 target 时，用于查看某品牌会注入哪些值（dry-run）。
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRAND="${1:-}"
TARGET="${2:-}"

if [ -z "$BRAND" ]; then
  echo "用法: sh scripts/build-brand.sh <brand> [target]" >&2
  echo "  brand: tianzhiling | weiliaoyan" >&2
  exit 1
fi

CONFIG_FILE="$ROOT/brand/$BRAND.json"
if [ ! -f "$CONFIG_FILE" ]; then
  echo "错误: 找不到品牌配置 $CONFIG_FILE" >&2
  exit 1
fi

# 用 node 读取 JSON 并导出为 shell 变量
eval "$(node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const kv = {
    BRAND: cfg.key,
    BRAND_NAME: cfg.name,
    BRAND_COMPANY: cfg.companyName,
    BRAND_DOMAIN: cfg.domain,
    BRAND_ADMIN_DOMAIN: cfg.adminDomain,
    BRAND_WEAPP_APPID: cfg.weapp.appid,
    BRAND_WEAPP_NAV_TITLE: cfg.weapp.navigationBarTitle,
    BRAND_APP_ANDROID_LABEL: cfg.app.androidLabel,
    BRAND_ADMIN_TITLE: cfg.adminTitle,
    BRAND_CUSTOMER_SERVICE_PHONE: cfg.customerService?.phone || "",
    BRAND_CUSTOMER_SERVICE_WECHAT_QR: cfg.customerService?.wechatQr || "",
    BRAND_CUSTOMER_SERVICE_EMAIL: cfg.customerService?.email || "",
    BRAND_CUSTOMER_SERVICE_WECHAT_ID: cfg.customerService?.wechatId || "",
    // 官网落地页 Logo 首字标记（品牌名首字，如 天 / 未）
    BRAND_MARK: cfg.name.slice(0, 1),
  };
  for (const [k, v] of Object.entries(kv)) {
    console.log(`export ${k}=${JSON.stringify(v)}`);
  }
' "$CONFIG_FILE")"

if [ -z "$TARGET" ]; then
  echo "== 品牌环境（dry-run）: $BRAND =="
  env | grep -E "^BRAND" | sed 's/^/  /'
  exit 0
fi

echo "== 构建品牌 [$BRAND] 目标 [$TARGET] =="

case "$TARGET" in
  weapp)
    # 小程序包里的接口地址/资源地址必须跟着品牌走：
    # apps/weapp/.env.production 里的默认值是「天之灵」，dotenv 不会覆盖已存在的
    # 环境变量，所以这里显式 export，保证未了言构建出来的包指向 voloian.cn。
    export TARO_APP_API_BASE_URL="https://${BRAND_DOMAIN}"
    export TARO_APP_ASSET_BASE_URL="https://${BRAND_DOMAIN}"
    export TARO_APP_MEDIA_BASE_URL="https://oss.${BRAND_DOMAIN}"
    export BRAND_DOMAIN
    # 注意：这里直接调 taro build，不走 package.json 的 build:weapp
    # （那个脚本会在构建后立刻校验 appid，而 appid 需要先按品牌改写）。
    pnpm --filter ./apps/weapp exec taro build --type weapp
    # Taro 只是原样拷贝 project.config.json，appid 不会随品牌变，这里构建后改写，
    # 否则未了言的包会带着天之灵的 appid，上传时没有权限。
    node - "$BRAND_WEAPP_APPID" <<'NODE'
const fs = require('fs')
const appid = process.argv[2]
const files = [
  'apps/weapp/dist/weapp/project.config.json',
  'apps/weapp/dist/weapp/project.private.config.json',
]
for (const file of files) {
  if (!fs.existsSync(file)) continue
  const config = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (config.appid !== appid) {
    config.appid = appid
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
    console.log(`[brand] ${file} appid -> ${appid}`)
  }
}
NODE
    node apps/weapp/scripts/verify-weapp-release.mjs
    ;;
  app)
    # Flutter 编译注入品牌；如需出 Android 包:
    #   flutter build apk --dart-define=BRAND=$BRAND --dart-define=BRAND_NAME="$BRAND_NAME" ...
    echo "Flutter 端请使用 --dart-define 注入，示例:" >&2
    echo "  cd apps/app && flutter build apk --dart-define=BRAND=$BRAND --dart-define=BRAND_NAME=$BRAND_NAME --dart-define=BRAND_COMPANY=$BRAND_COMPANY" >&2
    ;;
  admin)
    pnpm --filter ./apps/admin build
    ;;
  admin-node)
    pnpm build:admin-node
    ;;
  node)
    pnpm build:node
    ;;
  gateway)
    # 官网落地页由模板按品牌渲染（品牌 token 见 site/index.template.html）
    TEMPLATE="$ROOT/apps/gateway/static/site/index.template.html"
    OUTPUT="$ROOT/apps/gateway/static/site/index.html"
    if [ ! -f "$TEMPLATE" ]; then
      echo "错误: 找不到落地页模板 $TEMPLATE" >&2
      exit 1
    fi
    sed \
      -e "s/{{BRAND_NAME}}/$BRAND_NAME/g" \
      -e "s/{{BRAND_DOMAIN}}/$BRAND_DOMAIN/g" \
      -e "s/{{BRAND_MARK}}/$BRAND_MARK/g" \
      "$TEMPLATE" > "$OUTPUT"
    echo "已按品牌 [$BRAND] 渲染官网落地页 → $OUTPUT"
    echo "网关反向代理/SSL 按部署环境使用 conf.d 与 ssl 下对应品牌配置，无需品牌注入。"
    ;;
  *)
    echo "未知目标: $TARGET" >&2
    exit 1
    ;;
esac
