const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

loadLocalEnv();

const INDEXES = {
  chat_trace: [
    [{ traceId: 1 }, { name: 'uniq_chat_trace_id', unique: true }],
    [
      { conversationId: 1, acceptedAt: -1 },
      { name: 'idx_chat_trace_conversation_time' },
    ],
    [{ status: 1, updatedAt: -1 }, { name: 'idx_chat_trace_status_time' }],
  ],
  chat_span: [
    [{ traceId: 1, startedAt: 1 }, { name: 'idx_chat_span_trace_time' }],
    [{ stage: 1, startedAt: -1 }, { name: 'idx_chat_span_stage_time' }],
    [
      { expiresAt: 1 },
      { name: 'ttl_chat_span_expires_at', expireAfterSeconds: 0 },
    ],
  ],
  message: [[{ traceId: 1, createdAt: 1 }, { name: 'idx_message_trace_time' }]],
};

async function main() {
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const db = client.db(database);
    const created = [];

    for (const [collectionName, definitions] of Object.entries(INDEXES)) {
      const collection = db.collection(collectionName);
      for (const [keys, options] of definitions) {
        const indexName = await ensureIndex(collection, keys, {
          ...options,
          background: true,
        });
        created.push(`${collectionName}.${indexName}`);
      }
    }

    console.log(`[chat-trace-indexes] ready indexes=${created.join(',')}`);
  } finally {
    await client.close();
  }
}

async function ensureIndex(collection, keys, options) {
  let indexes = [];
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.codeName !== 'NamespaceNotFound') {
      throw error;
    }
  }

  const expectedKeys = JSON.stringify(keys);
  const expectedTtl = options.expireAfterSeconds;
  const conflicting = indexes.filter(index => {
    if (index.name === '_id_') {
      return false;
    }
    const sameName = index.name === options.name;
    const sameKeys = JSON.stringify(index.key) === expectedKeys;
    const sameUnique = Boolean(index.unique) === Boolean(options.unique);
    const sameTtl = index.expireAfterSeconds === expectedTtl;
    return (
      (sameName || sameKeys) && !(sameName && sameKeys && sameUnique && sameTtl)
    );
  });

  for (const index of conflicting) {
    await collection.dropIndex(index.name);
  }

  return collection.createIndex(keys, options);
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
    if (value) {
      return value;
    }
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
    if (seen.has(envPath) || !existsSync(envPath)) {
      continue;
    }
    seen.add(envPath);

    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const index = trimmed.indexOf('=');
      if (index <= 0) {
        continue;
      }
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (key && process.env[key] == null) {
        process.env[key] = value;
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
