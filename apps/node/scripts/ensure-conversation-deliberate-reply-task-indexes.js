const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

const INDEXES = {
  conversation_deliberate_reply_task: [
    [
      { conversationId: 1, status: 1, scheduledAt: 1 },
      { name: 'idx_conversation_deliberate_reply_task_due' },
    ],
    [
      { userId: 1, scheduledAt: 1 },
      { name: 'idx_conversation_deliberate_reply_task_user_due' },
    ],
    [{ taskKey: 1 }, { name: 'uniq_conversation_deliberate_reply_task_key', unique: true }],
  ],
};

async function main() {
  loadLocalEnv();
  const mode = readMode(process.argv.slice(2));
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();
  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const db = client.db(database);
    const ready = [];
    const missing = [];
    for (const [collectionName, definitions] of Object.entries(INDEXES)) {
      const collection = db.collection(collectionName);
      for (const [keys, options] of definitions) {
        const result = await ensureIndex(
          collection,
          keys,
          { ...options, background: true },
          { apply: mode === 'apply' }
        );
        const qualifiedName = `${collectionName}.${options.name}`;
        if (result === 'missing') missing.push(qualifiedName);
        else ready.push(`${qualifiedName}:${result}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `[conversation-deliberate-reply-task-indexes] missing=${missing.join(',')} ` +
          'no changes made; rerun with --apply after explicit authorization'
      );
    }
    console.log(
      `[conversation-deliberate-reply-task-indexes] mode=${mode} ready=${ready.join(',')}`
    );
  } finally {
    await client.close();
  }
}

function readMode(args) {
  const allowed = new Set(['--check', '--apply']);
  const unknown = args.filter(arg => !allowed.has(arg));
  if (unknown.length > 0) {
    throw new Error(`unknown arguments: ${unknown.join(',')}`);
  }
  if (args.includes('--check') && args.includes('--apply')) {
    throw new Error('choose either --check or --apply');
  }
  return args.includes('--apply') ? 'apply' : 'check';
}

async function ensureIndex(collection, keys, options, { apply = false } = {}) {
  let indexes = [];
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (error) {
    if (error?.codeName !== 'NamespaceNotFound') throw error;
  }
  const expectedKeys = JSON.stringify(keys);
  const exact = indexes.find(index => {
    const sameName = index.name === options.name;
    const sameKeys = JSON.stringify(index.key) === expectedKeys;
    const sameUnique = Boolean(index.unique) === Boolean(options.unique);
    const sameSparse = Boolean(index.sparse) === Boolean(options.sparse);
    return sameName && sameKeys && sameUnique && sameSparse;
  });
  if (exact) return 'existing';

  const conflicts = indexes.filter(index => {
    if (index.name === '_id_') return false;
    const sameName = index.name === options.name;
    const sameKeys = JSON.stringify(index.key) === expectedKeys;
    return sameName || sameKeys;
  });
  if (conflicts.length > 0) {
    const found = conflicts.map(index => ({
      name: index.name,
      key: index.key,
      unique: Boolean(index.unique),
      sparse: Boolean(index.sparse),
    }));
    throw new Error(
      `[conversation-deliberate-reply-task-indexes] conflict collection=${
        collection.collectionName
      } expected=${JSON.stringify({ keys, options })} found=${JSON.stringify(
        found
      )}; no changes made`
    );
  }

  if (!apply) return 'missing';
  await collection.createIndex(keys, options);
  return 'created';
}

function buildMongoConnectionString() {
  const host = readEnv(['NODE_MONGO_HOST', 'MONGO_HOST'], '127.0.0.1');
  const port = readEnv(['NODE_MONGO_PORT', 'MONGO_PORT'], '17271');
  const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
  const authSource = readEnv(
    ['NODE_MONGO_AUTH_SOURCE', 'MONGO_AUTH_SOURCE'],
    'admin'
  );
  const username = encodeURIComponent(
    readEnv(['NODE_MONGO_USERNAME', 'MONGO_USERNAME'], 'admin')
  );
  const password = encodeURIComponent(
    readEnv(['NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'], 'qwerasdf')
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

module.exports = { INDEXES, ensureIndex, readMode };

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
