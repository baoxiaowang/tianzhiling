#!/usr/bin/env node

'use strict';

const { MongoClient } = require('mongodb');

const days = clamp(readNumber('--days=', 14), 1, 90);
const minimumItems = clamp(readNumber('--minimum-items=', 30), 10, 1000);
const minimumUsed = clamp(readNumber('--minimum-used=', 5), 1, 100);
const targetPrecision = clamp(readNumber('--target-precision=', 0.9), 0.5, 1);

function readNumber(prefix, fallback) {
  const raw = process.argv.find(value => value.startsWith(prefix));
  const value = Number(raw?.slice(prefix.length));
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function buildMongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const host = process.env.NODE_MONGO_HOST || 'tzl_mongo';
  const port = process.env.NODE_MONGO_PORT || '27017';
  const database = process.env.NODE_MONGO_DB || 'tzl';
  const username = process.env.NODE_MONGO_USERNAME || '';
  const password = process.env.NODE_MONGO_PASSWORD || '';
  const authSource = process.env.NODE_MONGO_AUTH_SOURCE || 'admin';
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : '';
  return `mongodb://${auth}${host}:${port}/${database}?authSource=${encodeURIComponent(
    authSource
  )}`;
}

function evaluateThreshold(rows) {
  if (
    rows.length < minimumItems ||
    rows.filter(row => row.used).length < minimumUsed
  ) {
    return {
      ready: false,
      reason: 'insufficient_runtime_evidence',
      itemCount: rows.length,
      usedCount: rows.filter(row => row.used).length,
    };
  }
  const thresholds = Array.from(new Set(rows.map(row => row.score))).sort(
    (a, b) => a - b
  );
  const usedTotal = rows.filter(row => row.used).length;
  const candidates = thresholds.map(threshold => {
    const accepted = rows.filter(row => row.score >= threshold);
    const used = accepted.filter(row => row.used).length;
    const precision = accepted.length ? used / accepted.length : 0;
    const recall = usedTotal ? used / usedTotal : 0;
    return { threshold, precision, recall, accepted: accepted.length, used };
  });
  const selected = candidates
    .filter(
      item => item.precision >= targetPrecision && item.used >= minimumUsed
    )
    .sort((left, right) =>
      right.recall !== left.recall
        ? right.recall - left.recall
        : left.threshold - right.threshold
    )[0];
  return selected
    ? { ready: true, ...selected }
    : {
        ready: false,
        reason: 'target_precision_not_reached',
        itemCount: rows.length,
        usedCount: usedTotal,
      };
}

async function main() {
  const client = new MongoClient(buildMongoUri(), {
    appName: 'tzl-milvus-relevance-calibration-readonly',
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const database = client.db(process.env.NODE_MONGO_DB || 'tzl');
    const since = new Date(Date.now() - days * 86400000);
    const spans = await database
      .collection('chat_span')
      .find(
        {
          operation: 'memory.evidence_item_usage',
          startedAt: { $gte: since },
          'attributes.score': { $type: 'number' },
          'attributes.used': { $type: 'bool' },
        },
        {
          projection: {
            _id: 0,
            'attributes.score': 1,
            'attributes.used': 1,
            'attributes.personScoped': 1,
          },
        }
      )
      .limit(10000)
      .toArray();
    const rows = spans.map(span => ({
      score: Number(span.attributes.score),
      used: Boolean(span.attributes.used),
      personScoped: Boolean(span.attributes.personScoped),
    }));
    const person = rows.filter(row => row.personScoped);
    const raw = rows.filter(row => !row.personScoped);
    console.log(
      JSON.stringify(
        {
          schemaVersion: 'milvus_relevance_calibration_v1',
          source: 'production_runtime_evidence_usage',
          generatedAt: new Date().toISOString(),
          days,
          targetPrecision,
          overall: evaluateThreshold(rows),
          person: evaluateThreshold(person),
          raw: evaluateThreshold(raw),
          interpretation:
            'unused evidence is a conservative negative proxy; apply only when ready=true',
          privacy: 'aggregate_only_no_chat_text_or_identifiers',
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
