#!/usr/bin/env node
/**
 * 天之灵记忆噪声归档脚本
 *
 * 安全归档审计中确定的高风险 extracted 事实。
 * 归档 = 设置 status='archived'（不物理删除），同时生成回滚 JSON。
 *
 * 用法：
 *   node archive-memory-noise.js --dry-run [--risk-level=high|medium|all]
 *   node archive-memory-noise.js --risk-level=high  # 正式归档
 *
 * 环境变量：
 *   MONGO_URI — MongoDB 连接串
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const MONGO_URI =
  process.env.MONGO_URI ||
  'mongodb://admin:qwerasdf@127.0.0.1:17271/tzl?authSource=admin';

const DRY_RUN = process.argv.includes('--dry-run');
const RISK_LEVEL = process.argv.find(a => a.startsWith('--risk-level='))?.split('=')[1] || 'high';
const BACKUP_DIR = './memory_archive_backup';

function valueOverlapRatio(value, sourceText) {
  if (!value || !sourceText) return 0;
  const v = value.replace(/\s+/g, '');
  const s = sourceText.replace(/\s+/g, '');
  if (!v || !s) return 0;
  let maxLen = 0;
  for (let i = 0; i < v.length; i++) {
    for (let j = i + 2; j <= v.length; j++) {
      const sub = v.slice(i, j);
      if (s.includes(sub) && sub.length > maxLen) maxLen = sub.length;
    }
  }
  return maxLen / Math.max(v.length, 1);
}

function classifyRisk(ratio) {
  return ratio < 0.15 ? 'high' : ratio < 0.3 ? 'medium' : 'low';
}

async function main() {
  console.log('天 之 灵 记 忆 噪 声 归 档');
  console.log('═══════════════════════');
  console.log(`MongoDB: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
  console.log(`风险等级: ${RISK_LEVEL}`);
  console.log(`模式: ${DRY_RUN ? 'DRY RUN (不执行归档)' : '正式归档'}`);
  console.log(`备份目录: ${BACKUP_DIR}`);

  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const collection = db.collection('agent_profile_fact');

    // 1. 找出所有候选
    const candidates = await collection
      .find({ confidence: 'extracted', status: { $ne: 'archived' } })
      .project({
        key: 1, value: 1, sourceText: 1, type: 1,
        agentId: 1, userId: 1, confidence: 1, updatedAt: 1,
      })
      .toArray();

    // 2. 分类
    const classified = [];
    for (const f of candidates) {
      const ratio = valueOverlapRatio(f.value, f.sourceText || '');
      const risk = classifyRisk(ratio);
      if (RISK_LEVEL === 'all' || risk === RISK_LEVEL) {
        classified.push({ _id: f._id, risk, ratio: ratio.toFixed(2), key: f.key, value: (f.value||'').slice(0, 80), sourceText: (f.sourceText||'').slice(0, 80) });
      }
    }

    console.log(`\n候选: ${candidates.length} 条 (confidence=extracted, 未归档)`);
    console.log(`匹配风险=${RISK_LEVEL}: ${classified.length} 条`);

    if (classified.length === 0) {
      console.log('无需归档。');
      return;
    }

    // 3. DRY RUN 打样
    if (DRY_RUN) {
      console.log('\n[DRY RUN] 将归档以下前 10 条样本：');
      classified.slice(0, 10).forEach(f => {
        console.log(`  ratio=${f.ratio} key=${f.key}`);
        console.log(`    value=${f.value}`);
        console.log(`    source=${f.sourceText}`);
      });
      console.log(`  ... 共 ${classified.length} 条`);
      return;
    }

    // 4. 备份
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const ids = classified.map(f => f._id);
    const backupDocs = await collection.find({ _id: { $in: ids } }).toArray();
    const backupFile = path.join(BACKUP_DIR, `rollback_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backupDocs, null, 2));
    console.log(`\n备份写入: ${backupFile} (${backupDocs.length} 条)`);

    // 5. 归档（设置 status=archived）
    const now = new Date();
    const result = await collection.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'archived', updatedAt: now } }
    );
    console.log(`归档完成: ${result.modifiedCount} 条已归档`);
    console.log(`回滚: db.agent_profile_fact.updateMany({status:'archived',updatedAt:ISODate("${now.toISOString()}")}, {$set:{status:'active'}})`);
  } catch (error) {
    console.error('归档失败:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
