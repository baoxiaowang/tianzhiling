#!/usr/bin/env node
/**
 * 偏好审计日志聚合（只读）。
 *
 * 用法：
 *   docker logs tzl_node --since 24h 2>&1 \
 *     | node preference-shadow-report.js --samples=20
 *
 * 只解析 [preference-audit] 行，不读取/输出用户原话。
 */

const fs = require('fs');

const PREFIX = '[preference-audit]';

function parseAuditLines(lines) {
  const records = [];
  for (const line of lines) {
    const index = line.indexOf(PREFIX);
    if (index < 0) continue;
    const payload = line.slice(index + PREFIX.length).trim();
    try {
      const record = JSON.parse(payload);
      if (record && record.decision) records.push(record);
    } catch {
      // 忽略被截断/非 JSON 的日志行
    }
  }
  return records;
}

function aggregate(records, limit = 10) {
  const byDecision = {};
  const byKind = {};
  const byKey = {};
  const byUser = {};
  for (const record of records) {
    byDecision[record.decision] = (byDecision[record.decision] || 0) + 1;
    byKind[record.kind] = (byKind[record.kind] || 0) + 1;
    for (const key of record.keys || []) {
      byKey[key] = (byKey[key] || 0) + 1;
    }
    if (record.userId) {
      byUser[record.userId] = (byUser[record.userId] || 0) + 1;
    }
  }
  const top = object =>
    Object.entries(object)
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, count }));
  return {
    total: records.length,
    byDecision,
    byKind,
    topKeys: top(byKey),
    topUsers: top(byUser),
    samples: records.slice(-Math.max(1, limit)),
  };
}

function parseArgs(argv) {
  const args = { input: '', samples: 10 };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith('--input=')) args.input = raw.slice(8);
    else if (raw.startsWith('--samples='))
      args.samples = Number(raw.slice(10)) || args.samples;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const text = args.input
    ? fs.readFileSync(args.input, 'utf8')
    : fs.readFileSync(0, 'utf8');
  const records = parseAuditLines(text.split(/\r?\n/));
  console.log(JSON.stringify(aggregate(records, args.samples), null, 2));
}

module.exports = { parseAuditLines, aggregate };

if (require.main === module) {
  main();
}
