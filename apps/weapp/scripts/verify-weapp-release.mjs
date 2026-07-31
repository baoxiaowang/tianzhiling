import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const releaseRoot = path.resolve(scriptDirectory, '../dist/weapp')
const productionOrigin = 'https://voloian.cn'
const forbiddenOrigins = [
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://localhost',
  'https://localhost',
  'http://0.0.0.0',
  'https://0.0.0.0',
  'https://tianzhiling.chat',
  'https://www.tianzhiling.chat',
  'https://oss.tianzhiling.chat',
]
const scannableExtensions = new Set(['.js', '.json', '.wxml'])

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      return entry.isDirectory() ? collectFiles(entryPath) : [entryPath]
    })
  )
  return files.flat()
}

const files = await collectFiles(releaseRoot)
const scannableFiles = files.filter((file) =>
  scannableExtensions.has(path.extname(file))
)
const violations = []
let hasProductionOrigin = false

for (const file of scannableFiles) {
  const content = await readFile(file, 'utf8')
  hasProductionOrigin ||= content.includes(productionOrigin)

  for (const origin of forbiddenOrigins) {
    if (content.includes(origin)) {
      violations.push(`${path.relative(releaseRoot, file)}: ${origin}`)
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `发布包包含禁止地址：\n${violations.map((item) => `- ${item}`).join('\n')}`
  )
}

if (!hasProductionOrigin) {
  throw new Error(`发布包未包含生产接口地址 ${productionOrigin}`)
}

console.log('微信小程序发布包检查通过：未发现本地或天之灵生产地址。')
