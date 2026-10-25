# 官网 SEO 与 GEO 说明

> 适用范围：`apps/gateway/site-src`、`apps/gateway/static/site`、`scripts/render-site.mjs`、`scripts/check-site.mjs`、`apps/gateway/conf.d/*.conf`。
> 最后更新：2026-10-25。

## 1. 这次优化解决了什么

原官网是单页落地页，只有品牌主张、三张能力卡和三步流程；同时 nginx 对未知路径回退 `index.html`，导致 `/robots.txt`、`/sitemap.xml` 等地址返回 200 HTML（SEO 上是典型的软 404）。

现在官网是一个可维护的多页面静态站，具备：

- **项目基本信息**：产品定义、适用人群、核心能力、使用流程、适用场景、隐私与安全、会员权益、常见问题、运营主体、客服电话/邮箱、备案号、协议与隐私摘要。
- **SEO**：独立 title/description、canonical、hreflang、Open Graph/Twitter Card、JSON-LD（Organization / WebSite / Service / WebPage / FAQPage / BreadcrumbList）、`sitemap.xml`、`robots.txt`、语义化标题、真实 404、移动端适配。
- **GEO（Generative Engine Optimization）**：`llms.txt` 摘要、`llms-full.txt` 可引用全文、answer-first 段落、结构化 FAQ、AI 爬虫显式 allow、引用署名说明、Markdown alternate。
- **多品牌不串场**：同一套模板按 `brand/<brand>.json` 渲染；校验脚本会分别渲染天之灵/未了言并检查品牌词、域名、客服、备案不互相泄漏。
- **无 JS 依赖**：内容、导航、FAQ 折叠与表单链接均不依赖 JavaScript；页面底部只有一段极小的原生脚本，用于修正 `/#anchor` 在首屏不滚动的问题。

## 2. 页面与文件

### 页面

| 路由 | 产物 | 作用 |
|---|---|---|
| `/` | `index.html` | 产品定义、能力、流程、场景、隐私、会员、首页 FAQ、关于、联系方式 |
| `/faq/` | `faq/index.html` | 17 个常见问题，含 FAQPage JSON-LD |
| `/about/` | `about/index.html` | 产品理念、边界、品牌名由来、运营主体与联系方式 |
| `/legal/` | `legal/index.html` | 服务协议/隐私政策/会员协议摘要、数据权利、注销路径 |
| `/404.html` | `404.html` | 真实 404 页面，`noindex` |
| `/robots.txt` | `robots.txt` | 搜索引擎与 AI 爬虫规则、sitemap 地址 |
| `/sitemap.xml` | `sitemap.xml` | 4 个可索引页面，`lastmod` 与内容更新日期一致 |
| `/llms.txt` | `llms.txt` | 给 AI 搜索/问答产品的品牌事实与页面索引 |
| `/llms-full.txt` | `llms-full.txt` | 更完整的可引用全文（与页面口径一致） |
| `/manifest.webmanifest` | `manifest.webmanifest` | 站点图标、名称、主题色 |

### 源文件与产物

```
apps/gateway/site-src/
  templates/
    index.html / faq.html / about.html / legal.html / 404.html
    partials/head.html / header.html / footer.html / icons.html
  assets/
    styles.css, star-girl.svg, soft-stars.svg, favicon.svg
    icon-192.png, icon-512.png, apple-touch-icon.png, favicon-32.png
    og-cover-tianzhiling.png, og-cover-weiliaoyan.png
  llms.txt.template
  llms-full.txt.template
apps/gateway/static/site/        # 生成产物，网关镜像直接拷贝；不要手改
```

渲染器负责：

- 把 `brand/<brand>.json` 展开成 `{{BRAND_NAME}}`、`{{BRAND_COMPANY}}`、`{{SITE_URL}}`、`{{BRAND_EMAIL}}`、`{{BRAND_PHONE}}`、`{{ICP_LINK}}`、`{{AGREEMENT_*}}` 等变量；
- 渲染 `{{> partial.html}}`；
- 生成 `sitemap.xml`、`robots.txt`、`manifest.webmanifest`；
- 按品牌只拷贝对应的 `og-cover-<brand>.png`；
- 清理旧版 `index.template.html`，避免继续被网关发布。

## 3. 常用命令

```bash
# 渲染天之灵官网（默认写入 apps/gateway/static/site）
node scripts/render-site.mjs --brand tianzhiling

# 用统一入口渲染（与品牌构建流程一致）
sh scripts/build-brand.sh tianzhiling gateway

# 渲染未了言到临时目录（不覆盖当前仓库产物）
SITE_OUT_DIR=/tmp/site-weiliaoyan sh scripts/build-brand.sh weiliaoyan gateway
node scripts/render-site.mjs --brand weiliaoyan --out /tmp/site-weiliaoyan

# 校验：双品牌渲染 + SEO/GEO + 站内链接 + 品牌不串场 + 已提交产物是否最新
node scripts/check-site.mjs

# 重新生成 PNG 图标与分享图（需要 Pillow；模板中的 SVG 图标直接改 partials/icons.html）
python3 scripts/generate-site-assets.py
```

`check-site.mjs` 会检查：

- 每页 title（≤60 字）、description（50–160 字）、canonical、OG 图绝对地址与文件存在；
- 每页恰好一个 H1、`lang="zh-CN"`、图片 alt；
- JSON-LD 可解析且包含期望类型；FAQ 页 FAQPage 至少 12 条；
- sitemap 4 个 URL、域名正确、不含 404；
- robots 含 sitemap 与 GPTBot / ClaudeBot / PerplexityBot / Google-Extended / Baiduspider；
- llms.txt / llms-full.txt 含品牌、公司、域名、客服、更新日期；
- 站内链接与锚点存在；
- 未了言输出不含“天之灵”，天之灵输出不含“未了言”；
- `apps/gateway/static/site` 与天之灵模板渲染结果逐字节一致（防止忘记重新生成）。

## 4. 品牌配置

官网新增字段在 `brand/<brand>.json` 的 `site`：

```jsonc
"site": {
  "icp": "鄂ICP备2025121696号-3",     // 为空则不渲染备案号
  "icpUrl": "https://beian.miit.gov.cn/",
  "contentUpdatedAt": "2026-10-25",   // 页面、sitemap、JSON-LD 共用
  "brandOrigin": "“天之灵”取自“在天之灵”……" // 关于页“名字的由来”
}
```

客服电话/邮箱仍来自 `customerService.phone` / `customerService.email`；协议标题来自 `agreementTitles`；域名来自 `domain`。

> **发布前必须确认**：`weiliaoyan` 当前 `site.icp` 为空，渲染结果不会展示备案号，也不会借用天之灵的备案号。请补上未了言自己的备案信息后再发布。

## 5. SEO 清单（发布前）

- [ ] `node scripts/check-site.mjs` 通过
- [ ] 用 nginx 实际配置验证 `/robots.txt`、`/sitemap.xml` 返回正确 Content-Type，而不是 HTML
- [ ] `/nonexistent` 返回 HTTP 404 且展示自定义 404，不再回退首页 200
- [ ] `curl -I` 检查 `Content-Type: text/html; charset=utf-8`、安全响应头
- [ ] 在百度搜索资源平台/Google Search Console/Bing Webmaster 提交 `https://<domain>/sitemap.xml`
- [ ] 若更换域名，更新 `brand/<brand>.json` 的 `domain` 后重新渲染，并同步 nginx/证书
- [ ] 内容有实质更新时，修改 `brand/<brand>.json` 的 `site.contentUpdatedAt`（或 `scripts/render-site.mjs` 的 `CONTENT_UPDATED_AT`），再重新渲染
- [ ] 新增页面时在 `scripts/render-site.mjs` 的 `PAGES` 登记，sitemap 会自动包含

## 6. GEO 清单（发布前）

- [ ] `llms.txt` 的“核心事实”与产品内实际信息一致（尤其是费用、声音版素材要求、删除路径）
- [ ] `llms-full.txt` 与 FAQ/协议摘要口径一致；协议实质变化时同步更新
- [ ] `robots.txt` 未被 CDN/WAF 覆盖；AI 爬虫可访问 `/llms.txt`、`/llms-full.txt`
- [ ] 首页首段用“是什么/适合谁/不是什么”回答，避免只有情绪文案
- [ ] FAQ 的问题与答案在页面上可见（`<details>` 内容在 HTML 中，不依赖 JS）
- [ ] 引用规范写明“注明来源并链接回原文”，不承诺付费排名或保证被 AI 引用
- [ ] 重点事实（公司主体、客服、备案、更新日期）在页面、JSON-LD、llms 文件中保持一致

## 7. nginx 变更与部署

`apps/gateway/conf.d/tianzhiling.chat.conf` / `voloian.cn.conf`：

- 新增 `includes/security-headers.conf`：`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options`、`Permissions-Policy`；
- `/assets/` 保留 7 天缓存，并显式带上安全头（避免 `add_header` 覆盖导致丢失）；
- `location /` 从 `try_files $uri $uri/ /index.html` 改为 `=404`；`error_page 404 /404.html`，`/404.html` 仅内部访问；
- `/manifest.webmanifest` 用 `default_type application/manifest+json`，避免 `application/octet-stream`；
- `nginx.conf` 增加 `charset utf-8` 与 `application/manifest+json` gzip。

部署流程：

1. `node scripts/check-site.mjs`
2. `sh scripts/build-brand.sh <brand> gateway`（默认天之灵会覆盖 `apps/gateway/static/site`）
3. 重新构建 gateway 镜像（`apps/gateway/Dockerfile` 直接 `COPY apps/gateway/static/site`）
4. 发布后验证：
   ```bash
   curl -I https://<domain>/
   curl -I https://<domain>/robots.txt
   curl -I https://<domain>/sitemap.xml
   curl -I https://<domain>/llms.txt
   curl -I https://<domain>/manifest.webmanifest
   curl -I https://<domain>/no-such-page   # 期望 404
   ```

> 本次修改包含 nginx 配置与静态产物；未执行生产发布。生产发布需走 `tianzhiling-production-release` 流程。

## 8. 已知边界

- **同容器双品牌部署**：`apps/gateway/static/site` 默认只放一个品牌的产物（当前为天之灵）。仓库按品牌分别部署；若要在同一个 nginx 容器同时服务两个域名，请为每个品牌渲染到独立目录（`SITE_OUT_DIR`）并修改 `conf.d` 的 `root`，不要共用 `site/`。
- **完整协议文本不在官网托管**：官网提供摘要、数据权利和入口说明，完整文本以产品内「我的 → 服务协议」为准，避免官网与协议母版双份维护产生偏差。若后续需要独立的法律页面，建议从 `apps/weapp/src/legal/agreement-documents.ts` 生成，而不是手抄。
- **未了言备案号缺失**：见第 4 节。补配置后重新渲染即可，无需改模板。
- **价格不写死**：会员套餐/价格来自后台并会随活动变化，官网只写权益与“以产品内为准”，避免过期价格伤害信任与 SEO。
- **客服邮箱**：统一取 `brand.customerService.email`（当前 `support@<domain>`）。发布前建议确认该邮箱可收信；若不可用，改品牌 JSON 后重新渲染。
- **分享图不含实时数据**：`og-cover-<brand>.png` 是静态图；品牌名或主张变化时运行 `scripts/generate-site-assets.py` 重新生成。
- **本页不是法律意见**：`/legal/` 的摘要用于帮助理解，不替代完整协议。
