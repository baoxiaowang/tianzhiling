const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

const OLD_AVATAR_KEY = 'weapp/messenger-avatar-20260817.png';
const NEW_AVATAR_KEY = 'weapp/messenger-avatar-20260818-5c48467a.png';

loadLocalEnv();

async function main() {
  const operation = parseOperation(process.argv.slice(2));
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const agents = client.db(database).collection('agent');
    const filter = {
      messengerOfAgentId: { $exists: true },
      avatar: OLD_AVATAR_KEY,
    };
    const matched = await agents.countDocuments(filter);

    if (operation.dryRun) {
      console.log(
        `[migrate-messenger-avatar] done dryRun=true matched=${matched} oldKey=${OLD_AVATAR_KEY} newKey=${NEW_AVATAR_KEY}`
      );
      return;
    }

    const result = await agents.updateMany(filter, {
      $set: { avatar: NEW_AVATAR_KEY, updatedAt: new Date() },
    });
    const remaining = await agents.countDocuments(filter);

    console.log(
      `[migrate-messenger-avatar] done dryRun=false matched=${
        result.matchedCount || 0
      } modified=${
        result.modifiedCount || 0
      } remaining=${remaining} oldKey=${OLD_AVATAR_KEY} newKey=${NEW_AVATAR_KEY}`
    );
  } finally {
    await client.close();
  }
}

function parseOperation(args) {
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  const unknown = args.filter(
    value => !['--dry-run', '--apply'].includes(value)
  );

  if (unknown.length || Number(dryRun) + Number(apply) !== 1) {
    throw new Error(
      'usage: node migrate-messenger-avatar.js (--dry-run|--apply)'
    );
  }

  return { dryRun };
}

function buildMongoConnectionString() {
  const host = requireEnv(['NODE_MONGO_HOST', 'MONGO_HOST']);
  const port = readEnv(['NODE_MONGO_PORT', 'MONGO_PORT'], '27017');
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

function requireEnv(keys) {
  const value = readEnv(keys, '');
  if (!value) {
    throw new Error(`missing env: ${keys.join(' or ')}`);
  }
  return value;
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

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { parseOperation };
