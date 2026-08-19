const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

loadLocalEnv();

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const generatedAt = new Date();
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const events = await client
      .db(database)
      .collection('messenger_call_event')
      .find(
        { createdAt: { $gte: new Date(generatedAt.getTime() - 7 * DAY_MS) } },
        {
          projection: {
            userId: 1,
            conversationId: 1,
            messengerAgentId: 1,
            status: 1,
            skipReason: 1,
            modelCalled: 1,
            modelSucceeded: 1,
            fallbackUsed: 1,
            model: 1,
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 1,
            durationMs: 1,
            profileSaved: 1,
            changedProfileFields: 1,
            releaseVersion: 1,
            errorCode: 1,
            createdAt: 1,
          },
        }
      )
      .toArray();

    console.log(JSON.stringify(buildUsageReport(events, generatedAt), null, 2));
  } finally {
    await client.close();
  }
}

function buildUsageReport(events, generatedAt = new Date()) {
  return {
    generatedAt: generatedAt.toISOString(),
    collection: 'messenger_call_event',
    note: '滚动窗口；不包含埋点上线前的小使者调用。',
    windows: {
      last24Hours: summarizeWindow(events, generatedAt, DAY_MS),
      last7Days: summarizeWindow(events, generatedAt, 7 * DAY_MS),
    },
  };
}

function summarizeWindow(events, generatedAt, windowMs) {
  const from = new Date(generatedAt.getTime() - windowMs);
  const selected = events.filter(event => {
    const createdAt = new Date(event.createdAt);
    return createdAt >= from && createdAt <= generatedAt;
  });
  const byStatus = countBy(selected, event => event.status || 'unknown');
  const modelCalls = selected.filter(event => event.modelCalled);
  const tokenTaggedCalls = modelCalls.filter(
    event =>
      event.totalTokens != null && Number.isFinite(Number(event.totalTokens))
  );
  const durations = selected
    .map(event => Number(event.durationMs))
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const completed = byStatus.completed || 0;
  const failed = byStatus.failed || 0;
  const reportable = completed + failed;

  return {
    from: from.toISOString(),
    to: generatedAt.toISOString(),
    turns: selected.length,
    completedTurns: completed,
    skippedTurns: byStatus.skipped || 0,
    failedTurns: failed,
    completionRate: ratio(completed, reportable),
    uniqueUsers: uniqueCount(selected, 'userId'),
    uniqueMessengers: uniqueCount(selected, 'messengerAgentId'),
    uniqueConversations: uniqueCount(selected, 'conversationId'),
    modelCalls: modelCalls.length,
    modelSucceededCalls: modelCalls.filter(event => event.modelSucceeded)
      .length,
    modelFailedCalls: modelCalls.filter(event => !event.modelSucceeded).length,
    modelSuccessRate: ratio(
      modelCalls.filter(event => event.modelSucceeded).length,
      modelCalls.length
    ),
    fallbackTurns: selected.filter(event => event.fallbackUsed).length,
    profileSavedTurns: selected.filter(event => event.profileSaved).length,
    changedProfileFields: countArrayValues(
      selected,
      event => event.changedProfileFields
    ),
    tokens: {
      taggedCalls: tokenTaggedCalls.length,
      coverageRate: ratio(tokenTaggedCalls.length, modelCalls.length),
      prompt: sum(selected, 'promptTokens'),
      completion: sum(selected, 'completionTokens'),
      total: sum(selected, 'totalTokens'),
    },
    latencyMs: {
      samples: durations.length,
      average: durations.length
        ? Math.round(
            durations.reduce((sum, value) => sum + value, 0) / durations.length
          )
        : 0,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations.length ? durations[durations.length - 1] : 0,
    },
    models: countBy(modelCalls, event => event.model || 'unknown'),
    skipReasons: countBy(
      selected.filter(event => event.status === 'skipped'),
      event => event.skipReason || 'unknown'
    ),
    errors: countBy(
      selected.filter(event => event.errorCode),
      event => event.errorCode
    ),
    releases: countBy(selected, event => event.releaseVersion || 'unknown'),
  };
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function sum(items, field) {
  return items.reduce((total, item) => {
    const value = Number(item[field]);
    return total + (Number.isFinite(value) && value >= 0 ? value : 0);
  }, 0);
}

function percentile(sorted, quantile) {
  if (!sorted.length) return 0;
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)
  );
  return sorted[index];
}

function uniqueCount(items, field) {
  return new Set(items.map(item => objectIdKey(item[field])).filter(Boolean))
    .size;
}

function countArrayValues(items, selector) {
  const result = {};
  for (const item of items) {
    const values = selector(item);
    if (!Array.isArray(values)) continue;
    for (const value of new Set(values.map(String).filter(Boolean))) {
      result[value] = (result[value] || 0) + 1;
    }
  }
  return sortRecord(result);
}

function countBy(items, selector) {
  const result = {};
  for (const item of items) {
    const key = String(selector(item) || 'unknown');
    result[key] = (result[key] || 0) + 1;
  }
  return sortRecord(result);
}

function sortRecord(record) {
  return Object.fromEntries(
    Object.entries(record).sort(
      ([leftKey, leftValue], [rightKey, rightValue]) =>
        rightValue - leftValue || leftKey.localeCompare(rightKey)
    )
  );
}

function objectIdKey(value) {
  return value?.toHexString?.() || String(value || '');
}

function buildMongoConnectionString() {
  const uri = readEnv(['NODE_MONGO_URI', 'MONGO_URI'], '');
  if (uri) {
    return uri;
  }
  const host = readEnv(['NODE_MONGO_HOST', 'MONGO_HOST'], '127.0.0.1');
  const port = readEnv(['NODE_MONGO_PORT', 'MONGO_PORT'], '17271');
  const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
  const authSource = readEnv(
    ['NODE_MONGO_AUTH_SOURCE', 'MONGO_AUTH_SOURCE'],
    'admin'
  );
  const username = encodeURIComponent(
    requireEnv(['NODE_MONGO_USERNAME', 'MONGO_USERNAME'])
  );
  const password = encodeURIComponent(
    requireEnv(['NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'])
  );
  return `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=${authSource}`;
}

function readEnv(keys, fallback) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return fallback;
}

function requireEnv(keys) {
  const value = readEnv(keys, '');
  if (!value) {
    throw new Error(
      `missing required environment variable: ${keys.join(' or ')}`
    );
  }
  return value;
}

function loadLocalEnv() {
  const envPaths = [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../.env.local'),
    resolve(__dirname, '../../../.env'),
  ];
  const seen = new Set();

  for (const envPath of envPaths) {
    if (seen.has(envPath) || !existsSync(envPath)) continue;
    seen.add(envPath);

    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && process.env[key] == null) process.env[key] = value;
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { buildUsageReport, summarizeWindow };
