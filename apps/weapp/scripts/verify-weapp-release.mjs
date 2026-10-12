import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 小程序发布包校验（分品牌）
 *
 * 背景：单代码库多品牌构建时，最容易出的事故是「未了言的包用了天之灵的
 * 接口域名 / appid / 支付链路」，或反过来。2026-09 的未了言支付事故就是
 * 这么来的，因此这里把品牌约束固化成发布前的硬校验：
 *
 * 1. 必须包含本品牌的域名（api/asset/media 同域）；
 * 2. 不允许出现任何其他品牌的域名，也不要本地/内网地址；
 * 3. dist/project.config.json 的 appid 必须等于本品牌 appid（防止上传错小程序）；
 * 4. 虚拟支付 + 普通微信支付两条链路必须都在（全品牌统一按平台路由）；
 * 5. 不允许出现「虚拟支付失败回退普通支付」的兜底实现。
 *
 * 品牌由 BRAND 环境变量指定（scripts/build-brand.sh weapp 会导出），
 * 输出目录由 TARO_BUILD_OUTPUT_ROOT 指定（默认 dist/weapp）。
 */
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(scriptDirectory, '..')
const repoRoot = path.resolve(appRoot, '..', '..')
const brandDirectory = path.join(repoRoot, 'brand')

const brandKey = (process.env.BRAND || 'tianzhiling').trim()
const outputRoot = process.env.TARO_BUILD_OUTPUT_ROOT || 'dist/weapp'
const releaseRoot = path.resolve(appRoot, outputRoot)

const forbiddenOrigins = [
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://localhost',
  'https://localhost',
  'http://0.0.0.0',
  'https://0.0.0.0',
]
const forbiddenPaymentPatterns = [
  {
    label: '虚拟支付失败回退普通支付的兜底实现',
    pattern: /fallback to wechat payment/,
  },
]
/** 全品牌统一支付路由：两条链路都必须在发布包里出现。 */
const requiredPaymentFragments = [
  {
    label: '会员虚拟支付接口',
    fragment: '/api/orders/vip-plan/virtual-payment',
  },
  {
    label: '会员普通微信支付接口',
    pattern: /\/api\/orders\/vip-plan(?!\/virtual-payment)/,
  },
  {
    label: '声音套餐虚拟支付接口',
    fragment: '/api/orders/voice-package/virtual-payment',
  },
  {
    label: '声音套餐普通微信支付接口',
    pattern: /\/api\/orders\/voice-package(?!\/virtual-payment)/,
  },
  {
    label: '小程序虚拟支付调用',
    fragment: 'requestVirtualPayment',
  },
  {
    label: '普通微信支付调用',
    fragment: 'requestPayment',
  },
]
const scannableExtensions = new Set(['.js', '.json', '.wxml'])

async function loadBrands() {
  const entries = await readdir(brandDirectory, { withFileTypes: true })
  const files = entries.filter(
    entry => entry.isFile() && entry.name.endsWith('.json')
  )

  return Promise.all(
    files.map(async entry =>
      JSON.parse(await readFile(path.join(brandDirectory, entry.name), 'utf8'))
    )
  )
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async entry => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? collectFiles(entryPath) : [entryPath]
    })
  )
  return files.flat()
}

const brands = await loadBrands()
const brand = brands.find(item => item.key === brandKey)

if (!brand) {
  throw new Error(
    `未知品牌 BRAND=${brandKey}，可选：${brands.map(item => item.key).join(' / ')}`
  )
}

const otherBrandDomains = brands
  .filter(item => item.key !== brandKey)
  .map(item => item.domain)
const scannableFiles = (await collectFiles(releaseRoot)).filter(file =>
  scannableExtensions.has(path.extname(file))
)

let releaseContent = ''
for (const file of scannableFiles) {
  releaseContent += `\n${await readFile(file, 'utf8')}`
}
// 压缩后的正则/字符串里域名会带转义（如 admin\.tianzhiling\.chat），
// 去掉反斜杠再比对，避免另一个品牌的域名从转义写法漏过校验。
releaseContent = releaseContent.replace(/\\/g, '')

const violations = []
for (const origin of forbiddenOrigins) {
  if (releaseContent.includes(origin)) {
    violations.push(origin)
  }
}
for (const domain of otherBrandDomains) {
  if (releaseContent.includes(domain)) {
    violations.push(`${domain}（其他品牌域名）`)
  }
}
for (const { label, pattern } of forbiddenPaymentPatterns) {
  if (pattern.test(releaseContent)) {
    violations.push(label)
  }
}

if (violations.length > 0) {
  throw new Error(
    `[${brand.name}] 发布包包含禁止内容：\n${violations
      .map(item => `- ${item}`)
      .join('\n')}`
  )
}

if (!releaseContent.includes(brand.domain)) {
  throw new Error(
    `[${brand.name}] 发布包未包含本品牌域名 ${brand.domain}，疑似漏注入品牌参数`
  )
}

const projectConfigPath = path.join(releaseRoot, 'project.config.json')
let projectConfig
try {
  projectConfig = JSON.parse(await readFile(projectConfigPath, 'utf8'))
} catch {
  throw new Error(`[${brand.name}] 读取不到 ${outputRoot}/project.config.json`)
}
if (projectConfig.appid !== brand.weapp.appid) {
  throw new Error(
    `[${brand.name}] 发布包 appid=${projectConfig.appid}，应为 ${brand.weapp.appid}（会上传到错误的小程序）`
  )
}

const missingPaymentFragments = requiredPaymentFragments
  .filter(({ fragment, pattern }) =>
    fragment ? !releaseContent.includes(fragment) : !pattern.test(releaseContent)
  )
  .map(({ label }) => label)

if (missingPaymentFragments.length > 0) {
  throw new Error(
    `[${brand.name}] 发布包缺少支付链路：\n${missingPaymentFragments
      .map(item => `- ${item}`)
      .join('\n')}`
  )
}

console.log(
  `[${brand.name}] 小程序发布包检查通过：域名 ${brand.domain}、appid ${brand.weapp.appid}、虚拟支付 + 普通微信支付双链路。`
)
