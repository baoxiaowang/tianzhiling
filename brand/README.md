# 品牌配置层（Brand Config）

本仓库是多品牌单代码库。**功能、页面、接口、后端完全共用一套代码**，唯一允许存在差异的是"品牌标识性内容"（产品名、公司主体、域名、AppID、协议标题等），全部收敛到 `brand/` 目录。

## 品牌清单

| key | 产品名 | 公司主体 | 主域名 | 管理后台域名 | 小程序 AppID |
|---|---|---|---|---|---|
| `tianzhiling` | 天之灵 | 武汉市天之灵智能技术有限公司 | tianzhiling.chat | admin.tianzhiling.chat | wxb6bcebdb61af0461 |
| `weiliaoyan` | 未了言 | 武汉市未了言智能技术有限公司 | voloian.cn | admin.voloian.cn | wx726227339067c7bb |

## 单一真值源

`brand/<brand>.json` 是每个品牌**唯一的权威定义**，包含所有品牌标识字段。新增/修改品牌标识内容只改这里的 JSON，再按下方流程构建即可。

```jsonc
{
  "key": "tianzhiling",            // 品牌标识，构建时通过 BRAND 传入
  "name": "天之灵",                // 产品名（也是智能体/实体名）
  "companyName": "武汉市天之灵智能技术有限公司",  // 协议与合规主体
  "domain": "tianzhiling.chat",    // 官网/主站域名
  "adminDomain": "admin.tianzhiling.chat",
  "weapp":   { "appid": "wxb6bcebdb61af0461", "navigationBarTitle": "天之灵" },
  "app":     { "androidApplicationId": "com.tianzhiling.app", "androidLabel": "天之灵", "iosBundleId": "com.tianzhiling.app" },
  "adminTitle": "天之灵管理后台",
  "customerService": {
    "phone": "19986943631",
    "wechatQr": "/weapp/service.png",
    "email": "support@tianzhiling.chat",
    "wechatId": ""
  },
  "agreementTitles": { "userAgreement": "天之灵用户服务协议", "privacyPolicy": "天之灵隐私政策", "memberAgreement": "天之灵会员协议" }
}
```

## 各端注入方式

| 端 | 读取位置 | 注入机制 |
|---|---|---|
| Flutter App | `apps/app/lib/config/brand_config.dart` | `--dart-define=BRAND=... --dart-define=BRAND_NAME=...`（编译期常量） |
| 微信小程序 | `apps/weapp/src/config/brand.ts` | Taro `defineConstants`，读取 `process.env.BRAND_*` |
| 管理后台 | `apps/admin/src/config/brand.ts` | Vite `define`，读取 `process.env.BRAND_*` |
| Node / Admin-Node | `apps/node/src/config/brand.ts`、`apps/admin-node/src/config/brand.ts` | `.env` 中的 `BRAND_NAME` 等（`brandName()` 助手读取 process.env，各服务/提示词引用） |
| 共享包 | `packages/shared/src/agent.ts` | 用户可见问候语改为 `getAgentCreateMessengerGreeting(brandName)` 函数，由各端传入品牌名 |
| 网关官网落地页 | `apps/gateway/static/site/index.template.html` | `build-brand.sh gateway` 按品牌渲染出 `index.html`（含品牌名/域名/Logo 首字） |

> 代码内默认值均为 `天之灵`，因此不注入品牌参数开发/构建时即产出天之灵版。

## 品牌化范围（已收敛）

用户可见文案中的品牌词已全部改为引用品牌配置，覆盖：

- **weapp**：约 30 个页面/组件、协议母版（`agreement-documents.ts` 用 `localize()` 运行时替换公司名与品牌名）、声音提示词（`voice-service-prompts.ts`，原 JSON 已改写为 TS 以引用品牌）
- **admin**：导航栏/页脚/登录页/后台标题
- **node / admin-node**：用户默认名（`xx用户`）、帖子作者名兜底、声音服务/音色库提示词、创建流程/记忆访谈/意图分类/场景路由/静默声明等提示词、动态/逝者 prompt、注销提示
- **Flutter App**：17 个页面/组件的产品名文案；Android 桌面图标名走 `BRAND_APP_ANDROID_LABEL` manifestPlaceholders；iOS 桌面图标名需提审前手动改 `Info.plist` 的 `CFBundleDisplayName`（见部署侧差异）
- **客服信息**：weapp 客服页面/声音客服卡片、Flutter 会员成功页/协议页的客服电话、邮箱、微信二维码，统一从 `brand.customerService` 读取（两品牌可分别配置）
- **网关官网落地页**：模板化渲染

**允许保留"天之灵"的位置**（品牌同步白名单，由 `scripts/check-brand-sync.mjs` 兜底校验）：
1. 品牌配置默认值（注入点）
2. 协议母版文本（运行时 localize）
3. 成语/文化表达"在天之灵""成天之灵"（如"心里陪着你""部分成天之灵"——非品牌名）
4. 模型提示词内部章节标题（如"# 天之灵主回复恢复"，非用户可见文案）
5. 测试用例（默认品牌断言）

## 构建命令

```bash
# 查看某品牌会注入哪些值（dry-run）
sh scripts/build-brand.sh weiliaoyan

# 构建某品牌的小程序 / 管理后台
sh scripts/build-brand.sh weiliaoyan weapp
sh scripts/build-brand.sh weiliaoyan admin

# 渲染某品牌的官网落地页（gateway 静态站）
sh scripts/build-brand.sh weiliaoyan gateway

# Flutter 出包
cd apps/app && flutter build apk \
  --dart-define=BRAND=weiliaoyan \
  --dart-define=BRAND_NAME=未了言 \
  --dart-define=BRAND_COMPANY=武汉市未了言智能技术有限公司 \
  # 桌面图标名另需: 构建时设置 BRAND_APP_ANDROID_LABEL 环境变量
```

## 已合入主仓的未了言独有资产

单代码库合入时，从未了言 fork 归并到主仓、且按品牌保留差异的部署/运维资产：

- `apps/node/scripts/migrate-weiliaoyan-default-user-names.js`（未了言历史数据迁移）
- `apps/node/scripts/ensure-conversation-deliberate-reply-task-indexes.js`（通用索引脚本）
- `apps/gateway/conf.d/{voloian.cn,admin.voloian.cn}.conf`、`apps/gateway/ssl/{voloian.cn,admin.voloian.cn}_nginx/`（未了言网关配置与证书）

> 未了言 fork 的 VIP 星形会员图（`current-member-star.png`）与主仓 `current-member-star.jpg` 经比对为**同一视觉资产**（仅格式差异），不构成品牌差异，统一以主仓 jpg 为准，fork 副本无需保留。

## 部署侧差异（不在代码内）

以下内容按品牌各自部署，本仓库保留两套配置，**不属于品牌同步范围**：

- **网关/域名/SSL**：`apps/gateway/conf.d/`、`apps/gateway/ssl/`（每品牌一套 nginx 配置与证书）；官网落地页已模板化，按品牌渲染
- **小程序 AppID 与支付策略**：两品牌小程序 AppID 不同，微信审核期支付策略不同（见根目录 AGENTS.md），以各自发布配置为准
- **Android/iOS 包名**：当前两品牌均使用 `com.tianzhiling.app`；若未了言需独立上架，需自行更换包名并重新提审，属发布决策
- **iOS 桌面图标名**：Android 已通过 `BRAND_APP_ANDROID_LABEL` 注入，iOS 的 `CFBundleDisplayName` 需在提交审核前手动改为对应品牌名（未自动化，属发布前动作）
- **环境密钥**：API Key、支付商户号等敏感配置一律放各自部署环境的 `.env`，不进品牌 JSON

## 同步纪律

1. 任何新功能只改这一套代码，两品牌自动同步；
2. 新增用户可见文案时，若涉及品牌名，一律引用 `brand` 配置，禁止硬编码；
3. 修改 `brand/*.json` 后，重新构建各端验证两品牌输出；
4. 校验脚本 `scripts/check-brand-sync.mjs` 用于兜底检查用户可见代码中的品牌词漏网。
