#!/usr/bin/env node
/**
 * prompt-size 采样日志聚合（只读）。
 *
 * docker logs tzl_node --since 24h 2>&1 \
 *   | node prompt-size-report.js --samples=10
 */
const fs = require('fs');

const PREFIX = '[prompt-size]';

function parsePromptSizeLines(lines) {
  const records = [];
  for (const line of lines) {
    const index = line.indexOf(PREFIX);
    if (index < 0) continue;
    try {
      const record = JSON.parse(line.slice(index + PREFIX.length).trim());
      if (record && Number.isFinite(record.totalChars)) records.push(record);
    } catch {
      // ignore truncated lines
    }
  }
  return records;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function aggregate(records, limit = 10) {
  const average = values =>
    values.length
      ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
      : 0;
  const totalChars = records.map(item => item.totalChars);
  const stableChars = records.map(item => item.stableChars);
  const taskChars = records.map(item => item.taskChars);
  const tokens = records.map(item => item.estimatedTokens);
  return {
    total: records.length,
    avg: {
      stableChars: average(stableChars),
      taskChars: average(taskChars),
      totalChars: average(totalChars),
      estimatedTokens: average(tokens),
      evidenceCount: average(records.map(item => item.evidenceCount || 0)),
      stableShare: records.length
        ? Number(
            (
              records.reduce((sum, item) => sum + (item.stableShare || 0), 0) /
              records.length
            ).toFixed(3)
          )
        : 0,
    },
    p50: {
      totalChars: percentile(totalChars, 0.5),
      estimatedTokens: percentile(tokens, 0.5),
    },
    p90: {
      totalChars: percentile(totalChars, 0.9),
      estimatedTokens: percentile(tokens, 0.9),
    },
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
  console.log(
    JSON.stringify(
      aggregate(parsePromptSizeLines(text.split(/\r?\n/)), args.samples),
      null,
      2
    )
  );
}

module.exports = { parsePromptSizeLines, aggregate };
if (require.main === module) main();
