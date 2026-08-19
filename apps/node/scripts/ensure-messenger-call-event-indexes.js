const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

loadLocalEnv();

const INDEXES = [
  [{ createdAt: -1 }, { name: 'idx_messenger_call_time' }],
  [{ userId: 1, createdAt: -1 }, { name: 'idx_messenger_call_user_time' }],
  [
    { messengerAgentId: 1, createdAt: -1 },
    { name: 'idx_messenger_call_agent_time' },
  ],
  [
    { conversationId: 1, createdAt: -1 },
    { name: 'idx_messenger_call_conversation_time' },
  ],
  [{ status: 1, createdAt: -1 }, { name: 'idx_messenger_call_status_time' }],
];

async function main() {
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const collection = client.db(database).collection('messenger_call_event');
    const created = [];
    for (const [keys, options] of INDEXES) {
      created.push(
        await collection.createIndex(keys, { ...options, background: true })
      );
    }
    console.log(
      `[messenger-call-event-indexes] ready indexes=${created.join(',')}`
    );
  } finally {
    await client.close();
  }
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

  for (const envPath of new Set(envPaths)) {
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
