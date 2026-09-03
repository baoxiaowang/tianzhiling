#!/usr/bin/env node
/**
 * check-brand-sync.mjs — 品牌同步兜底检查
 *
 * 在"单代码库多品牌"架构下，用户可见代码里不应出现硬编码品牌词（"天之灵"），
 * 除非属于以下白名单：
 *   - config 默认值（品牌配置注入点，默认即天之灵）
 *   - 协议母版（agreement-documents.ts，运行时按品牌 localize）
 *   - 成语/文化表达"在天之灵"（非品牌名）
 *   - 模型提示词内部章节标题（"# 天之灵主回复恢复"等，非用户可见文案）
 *   - 测试用例（默认品牌断言）
 *   - 注释与文档
 *
 * 用法：
 *   node scripts/check-brand-sync.mjs            # 检查并列出所有命中
 *   node scripts/check-brand-sync.mjs --strict   # 含注释/测试也报（排查用）
 * 退出码：0=通过，1=存在漏网品牌词
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC_DIRS = [
  'apps/weapp/src',
  'apps/admin/src',
  'apps/node/src',
  'apps/admin-node/src',
  'apps/app/lib',
  'packages/shared/src',
];
const EXT_RE = /\.(ts|tsx|vue|dart|js|jsx)$/;

// 整文件白名单（命中文件路径即整体放行）
const ALLOW_PATHS = [
  /config\/brand\.(ts|dart)$/,     // 品牌配置模块（默认值即天之灵）
  /agreement-documents\.ts$/,      // 协议母版（运行时按品牌 localize）
];

// 行级白名单：用户可见代码中允许保留"天之灵"的模式
const ALLOW_PATTERNS = [
  /在天之灵/,                              // 成语/文化表达（在心里陪着等）
  /成天之灵/,                              // 成语（部分转世、部分成天之灵）
  /# 天之灵/,                              // 模型提示词内部章节标题
  /^\/\//,                                 // 单行注释
  /BRAND_NAME.*天之灵/,                    // 品牌注入默认值
  /BRAND_COMPANY.*天之灵/,
  /BRAND_WEAPP_NAV_TITLE.*天之灵/,
  /BRAND_ADMIN_TITLE.*天之灵/,
  /BRAND_APP_ANDROID_LABEL.*天之灵/,
  /navigationBarTitle.*天之灵/,
  /companyName.*天之灵/,
];

const strict = process.argv.includes('--strict');
const hits = [];

function walk(dir) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (ent === 'node_modules' || ent === 'dist' || ent === 'test' || ent === 'tests') continue;
      walk(p);
    } else if (EXT_RE.test(ent)) {
      const rel = relative(ROOT, p);
      const wholeFileAllowed = ALLOW_PATHS.some((re) => re.test(rel));
      if (wholeFileAllowed) continue;
      const content = readFileSync(p, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('天之灵')) return;
        if (!strict && /^\s*(\/\/|#|\*)/.test(line)) return; // 注释行
        if (
          line.includes('武汉市天之灵智能技术有限公司') &&
          lines[i - 1]?.includes('BRAND_COMPANY')
        ) return;
        const allowed = ALLOW_PATTERNS.some((re) => re.test(line));
        if (!allowed) {
          hits.push(`${relative(ROOT, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
}

for (const d of SRC_DIRS) walk(join(ROOT, d));

if (hits.length === 0) {
  console.log('✅ 未发现漏网品牌词（"天之灵"）');
  process.exit(0);
} else {
  console.log(`❌ 发现 ${hits.length} 处可能需要品牌化的"天之灵"：`);
  for (const h of hits) console.log('  ' + h);
  process.exit(1);
}
