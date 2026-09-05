const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');
const {
  ensureIndex,
  readMode,
} = require('./ensure-conversation-reply-turn-indexes');

const INDEXES = {
  user_identity_profile: [
    [{ userId: 1 }, { name: 'uniq_user_identity_profile_user', unique: true }],
  ],
  user_known_person: [
    [
      { userId: 1, identityKey: 1 },
      { name: 'uniq_user_known_person_identity', unique: true },
    ],
    [{ userId: 1, status: 1 }, { name: 'idx_user_known_person_active' }],
  ],
  user_relative_profile: [
    [
      { userId: 1, personId: 1 },
      { name: 'uniq_user_relative_profile_person', unique: true },
    ],
    [{ userId: 1, status: 1 }, { name: 'idx_user_relative_profile_active' }],
  ],
  user_relative_fact: [
    [
      { userId: 1, personId: 1, status: 1, updatedAt: -1 },
      { name: 'idx_user_relative_fact_current' },
    ],
    [
      { userId: 1, personId: 1, domain: 1, key: 1, status: 1 },
      { name: 'idx_user_relative_fact_semantic_key' },
    ],
  ],
  person_temporal_assertion: [
    [
      { userId: 1, sourceMessageId: 1, semanticKey: 1 },
      { name: 'uniq_person_temporal_assertion_source', unique: true },
    ],
    [
      { userId: 1, subjectType: 1, subjectId: 1, eventType: 1, status: 1 },
      { name: 'idx_person_temporal_assertion_subject' },
    ],
  ],
  person_temporal_profile: [
    [
      { userId: 1, subjectType: 1, subjectId: 1, eventType: 1 },
      { name: 'uniq_person_temporal_profile_event', unique: true },
    ],
    [
      { userId: 1, eventType: 1, updatedAt: -1 },
      { name: 'idx_person_temporal_profile_recent' },
    ],
  ],
  memory_pipeline_task: [
    [
      { messageId: 1, kind: 1, pipelineVersion: 1 },
      { name: 'uniq_memory_pipeline_task', unique: true },
    ],
    [
      { status: 1, nextAttemptAt: 1, updatedAt: 1 },
      { name: 'idx_memory_pipeline_task_due' },
    ],
    [{ userId: 1, createdAt: -1 }, { name: 'idx_memory_pipeline_task_user' }],
  ],
  message: [
    [
      {
        userId: 1,
        agentId: 1,
        temporalMemorySemanticHash: 1,
        temporalMemoryVersion: 1,
      },
      {
        name: 'idx_message_temporal_semantic_cache',
        partialFilterExpression: {
          temporalMemorySemanticHash: { $exists: true, $type: 'string' },
        },
      },
    ],
  ],
};

async function main() {
  loadLocalEnv();
  const mode = readMode(process.argv.slice(2));
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();
  try {
    const db = client.db(readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl'));
    const missing = [];
    const ready = [];
    for (const [collectionName, definitions] of Object.entries(INDEXES)) {
      for (const [keys, options] of definitions) {
        const result = await ensureIndex(
          db.collection(collectionName),
          keys,
          { ...options, background: true },
          { apply: mode === 'apply' }
        );
        const name = `${collectionName}.${options.name}`;
        if (result === 'missing') missing.push(name);
        else ready.push(`${name}:${result}`);
      }
    }
    if (missing.length) {
      throw new Error(
        `[memory-system-indexes] missing=${missing.join(',')} no changes made; rerun with --apply after approval`
      );
    }
    console.log(`[memory-system-indexes] mode=${mode} ready=${ready.join(',')}`);
  } finally {
    await client.close();
  }
}

function buildMongoConnectionString() {
  const host = readEnv(['NODE_MONGO_HOST', 'MONGO_HOST'], '127.0.0.1');
  const port = readEnv(['NODE_MONGO_PORT', 'MONGO_PORT'], '17271');
  const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
  const authSource = readEnv(['NODE_MONGO_AUTH_SOURCE', 'MONGO_AUTH_SOURCE'], 'admin');
  const username = encodeURIComponent(readEnv(['NODE_MONGO_USERNAME', 'MONGO_USERNAME'], 'admin'));
  const password = encodeURIComponent(readEnv(['NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'], ''));
  if (!username || !password) throw new Error('Mongo credentials are required');
  return `mongodb://${username}:${password}@${host}:${port}/${database}?authSource=${authSource}`;
}

function readEnv(keys, fallback) {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return fallback;
}

function loadLocalEnv() {
  for (const envPath of [
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../../.env.local'),
    resolve(__dirname, '../../../.env'),
  ]) {
    if (!existsSync(envPath)) continue;
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

module.exports = { INDEXES };

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
