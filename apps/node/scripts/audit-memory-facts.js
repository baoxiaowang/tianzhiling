#!/usr/bin/env node
/**
 * 天之灵记忆数据审计脚本
 *
 * 生成三张审计表：
 *   audit_1_extracted_facts.csv — confidence=extracted 且 value 在 sourceText 中无逐字依据
 *   audit_2_stale_facts.csv      — 超过指定天数未更新
 *   audit_3_emotion_as_fact.csv  — memory fact key 以 grief_trigger./safety_signal. 开头的
 *
 * 用法：
 *   node audit-memory-facts.js [--stale-days=180] [--output-dir=./audit]
 *
 * 环境变量：
 *   MONGO_URI — MongoDB 连接串（必填）
 *   例如：mongodb://admin:qwerasdf@127.0.0.1:17271/tzl?authSource=admin
 */

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const path = require('path');

// ── 配置 ──────────────────────────────────────────────

const MONGO_URI =
  process.env.MONGO_URI || 'mongodb://admin:qwerasdf@127.0.0.1:17271/tzl?authSource=admin';
const STALE_DAYS = parseInt(process.argv.find(a => a.startsWith('--stale-days='))?.split('=')[1] || '180', 10);
const OUTPUT_DIR = process.argv.find(a => a.startsWith('--output-dir='))?.split('=')[1] || './audit_output';
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// ── 工具 ──────────────────────────────────────────────

function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvLine(fields) {
  return fields.map(csvEscape).join(',') + '\n';
}

function valueOverlapRatio(value, sourceText) {
  if (!value || !sourceText) return 0;
  // 检查 value 中的连续子串是否在 sourceText 中出现
  const v = value.replace(/\s+/g, '');
  const s = sourceText.replace(/\s+/g, '');
  if (!v || !s) return 0;

  let maxLen = 0;
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 2; j <= v.length; j++) {
      const sub = v.slice(i, j);
      if (s.includes(sub) && sub.length > maxLen) {
        maxLen = sub.length;
      }
    }
  }
  return maxLen / Math.max(v.length, 1);
}

// ── 审计 1: extracted 事实 ─────────────────────────────

async function auditExtractedFacts(db) {
  console.log('\n=== 审计 1: extracted 置信度事实 ===');

  const facts = await db.collection('agent_profile_fact')
    .find({ confidence: 'extracted', status: { $ne: 'archived' } })
    .toArray();

  console.log(`  候选: ${facts.length} 条`);

  const issues = [];
  for (const f of facts) {
    const ratio = valueOverlapRatio(f.value, f.sourceText || '');
    // 判断标准：value 在 sourceText 中的覆盖率低于 30% 视为可疑
    const isSuspicious = ratio < 0.3;
    if (isSuspicious || VERBOSE) {
      issues.push({
        _id: String(f._id),
        agentId: String(f.agentId),
        userId: String(f.userId),
        key: f.key,
        type: f.type,
        value: f.value,
        sourceText: f.sourceText || '',
        overlapRatio: ratio.toFixed(2),
        confidence: f.confidence,
        updatedAt: f.updatedAt?.toISOString() || '',
        risk: ratio < 0.15 ? 'high' : ratio < 0.3 ? 'medium' : 'low',
      });
    }
  }

  console.log(`  问题: ${issues.filter(i => i.risk !== 'low').length} 条 (高:${issues.filter(i => i.risk === 'high').length} 中:${issues.filter(i => i.risk === 'medium').length})`);

  return issues;
}

// ── 审计 2: 过期事实 ───────────────────────────────────

async function auditStaleFacts(db) {
  console.log(`\n=== 审计 2: 超过 ${STALE_DAYS} 天未更新的事实 ===`);

  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000);

  const facts = await db.collection('agent_profile_fact')
    .find({
      updatedAt: { $lt: cutoff },
      status: { $ne: 'archived' },
      confidence: { $ne: 'confirmed' }, // 已确认的不标记为过期
    })
    .toArray();

  console.log(`  候选: ${facts.length} 条`);

  const issues = facts.map(f => ({
    _id: String(f._id),
    agentId: String(f.agentId),
    userId: String(f.userId),
    key: f.key,
    type: f.type,
    value: (f.value || '').slice(0, 120),
    confidence: f.confidence,
    updatedAt: f.updatedAt?.toISOString() || '',
    daysStale: Math.floor((Date.now() - new Date(f.updatedAt).getTime()) / 86400000),
  }));

  return issues;
}

// ── 审计 3: 情绪当事实 ─────────────────────────────────

async function auditEmotionAsFact(db) {
  console.log('\n=== 审计 3: 情绪/安全信号标记为事实 ===');

  const SUSPICIOUS_KEYS = /^(grief_trigger\.|safety_signal\.)/;

  const memFacts = await db.collection('agent_memory_fact')
    .find({
      key: { $regex: '^(grief_trigger\\.|safety_signal\\.)' },
      isArchived: { $ne: true },
    })
    .toArray();

  const profileFacts = await db.collection('agent_profile_fact')
    .find({
      key: { $regex: '^(grief_trigger\\.|safety_signal\\.)' },
      status: { $ne: 'archived' },
    })
    .toArray();

  console.log(`  memory_fact: ${memFacts.length} 条`);
  console.log(`  profile_fact: ${profileFacts.length} 条`);

  const issues = [
    ...memFacts.map(f => ({
      source: 'memory_fact',
      _id: String(f._id),
      agentId: String(f.agentId),
      userId: String(f.userId),
      key: f.key,
      value: (f.value || '').slice(0, 120),
      type: f.type,
      updatedAt: f.updatedAt?.toISOString() || '',
    })),
    ...profileFacts.map(f => ({
      source: 'profile_fact',
      _id: String(f._id),
      agentId: String(f.agentId),
      userId: String(f.userId),
      key: f.key,
      value: (f.value || '').slice(0, 120),
      type: f.type,
      confidence: f.confidence,
      updatedAt: f.updatedAt?.toISOString() || '',
    })),
  ];

  return issues;
}

// ── 写入 ──────────────────────────────────────────────

async function writeCsv(filename, headers, rows) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const filePath = path.join(OUTPUT_DIR, filename);
  const stream = fs.createWriteStream(filePath, 'utf8');
  stream.write(csvLine(headers));
  for (const row of rows) {
    stream.write(csvLine(headers.map(h => row[h] ?? '')));
  }
  stream.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      console.log(`  写入: ${filePath} (${rows.length} 行)`);
      resolve();
    });
    stream.on('error', reject);
  });
}

// ── 主流程 ─────────────────────────────────────────────

async function main() {
  console.log('天 之 灵 记 忆 数 据 审 计');
  console.log('═══════════════════════');
  console.log(`MongoDB: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
  console.log(`过期阈值: ${STALE_DAYS} 天`);
  console.log(`输出目录: ${OUTPUT_DIR}`);
  console.log(`模式: ${DRY_RUN ? 'DRY RUN (不写文件)' : '正式运行'}`);

  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();

    const [extractedIssues, staleIssues, emotionIssues] = await Promise.all([
      auditExtractedFacts(db),
      auditStaleFacts(db),
      auditEmotionAsFact(db),
    ]);

    const total = extractedIssues.length + staleIssues.length + emotionIssues.length;
    console.log(`\n═══════════════════════`);
    console.log(`总计: ${total} 条需审查`);
    console.log(`  extracted 可疑: ${extractedIssues.length}`);
    console.log(`  过期事实: ${staleIssues.length}`);
    console.log(`  情绪信号: ${emotionIssues.length}`);

    if (DRY_RUN) {
      console.log('\n[DRY RUN] 跳过文件写入。');
      // 打印少量样本
      if (extractedIssues.filter(i => i.risk === 'high').length > 0) {
        console.log('\n高危 extracted 样本 (前3条):');
        extractedIssues.filter(i => i.risk === 'high').slice(0, 3).forEach(i => {
          console.log(`  key=${i.key} value=${i.value.slice(0,60)} source=${i.sourceText.slice(0,60)} ratio=${i.overlapRatio}`);
        });
      }
      return;
    }

    await Promise.all([
      writeCsv('audit_1_extracted_facts.csv',
        ['_id', 'agentId', 'userId', 'key', 'type', 'value', 'sourceText', 'overlapRatio', 'confidence', 'updatedAt', 'risk'],
        extractedIssues
      ),
      writeCsv('audit_2_stale_facts.csv',
        ['_id', 'agentId', 'userId', 'key', 'type', 'value', 'confidence', 'updatedAt', 'daysStale'],
        staleIssues
      ),
      writeCsv('audit_3_emotion_as_fact.csv',
        ['source', '_id', 'agentId', 'userId', 'key', 'value', 'type', 'confidence', 'updatedAt'],
        emotionIssues
      ),
    ]);

    // 生成汇总 JSON
    const summary = {
      generatedAt: new Date().toISOString(),
      staleDays: STALE_DAYS,
      counts: {
        extractedTotal: extractedIssues.length,
        extractedHighRisk: extractedIssues.filter(i => i.risk === 'high').length,
        extractedMediumRisk: extractedIssues.filter(i => i.risk === 'medium').length,
        staleTotal: staleIssues.length,
        emotionAsFactTotal: emotionIssues.length,
      },
    };
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'audit_summary.json'),
      JSON.stringify(summary, null, 2)
    );
    console.log(`\n汇总写入: ${path.join(OUTPUT_DIR, 'audit_summary.json')}`);

  } catch (error) {
    console.error('审计失败:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
