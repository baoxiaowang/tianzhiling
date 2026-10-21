#!/usr/bin/env node
/** 规则门 shadow 日志聚合（只读）。 */
const fs = require('fs');
const PREFIXES = ['[rule-gate]', '[rule-gate-shadow]'];

function parseLines(lines) {
  const records = [];
  for (const line of lines) {
    const prefix = PREFIXES.find(value => line.includes(value));
    if (!prefix) continue;
    const index = line.indexOf(prefix);
    try {
      const record = JSON.parse(line.slice(index + prefix.length).trim());
      if (record && record.gate) records.push(record);
    } catch {}
  }
  return records;
}

function aggregate(records, limit = 10) {
  const byGate = {};
  const byReason = {};
  for (const record of records) {
    byGate[record.gate] = (byGate[record.gate] || 0) + 1;
    byReason[record.reason] = (byReason[record.reason] || 0) + 1;
  }
  return {
    total: records.length,
    byGate,
    byReason,
    samples: records.slice(-Math.max(1, limit)),
  };
}

function parseArgs(argv) {
  const args = { input: '', samples: 10 };
  for (const raw of argv.slice(2)) {
    if (raw.startsWith('--input=')) args.input = raw.slice(8);
    else if (raw.startsWith('--samples=')) args.samples = Number(raw.slice(10)) || args.samples;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const text = args.input ? fs.readFileSync(args.input, 'utf8') : fs.readFileSync(0, 'utf8');
  console.log(JSON.stringify(aggregate(parseLines(text.split(/\r?\n/)), args.samples), null, 2));
}
module.exports = { parseLines, aggregate };
if (require.main === module) main();
