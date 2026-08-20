const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

const WRONG_DEFAULT_NAME_PATTERN = /^天之灵用户([0-9a-f]{4})$/;
const CORRECT_DEFAULT_NAME_PREFIX = '未了言用户';
const UPDATE_BATCH_SIZE = 500;

loadLocalEnv();

async function main() {
  const operation = parseOperation(process.argv.slice(2));
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const users = client.db(database).collection('user');
    const filter = { name: WRONG_DEFAULT_NAME_PATTERN };
    const matched = await users.countDocuments(filter);
    const timeRange = await readCreatedAtRange(users, filter);

    if (operation.dryRun) {
      printResult({
        dryRun: true,
        matched,
        modified: 0,
        remaining: matched,
        ...timeRange,
      });
      return;
    }

    let modified = 0;
    let operations = [];
    const cursor = users.find(filter, { projection: { name: 1 } });

    for await (const user of cursor) {
      const correctedName = correctDefaultUserName(user.name);
      if (!correctedName) {
        continue;
      }

      operations.push({
        updateOne: {
          filter: { _id: user._id, name: user.name },
          update: { $set: { name: correctedName, updatedAt: new Date() } },
        },
      });

      if (operations.length >= UPDATE_BATCH_SIZE) {
        modified += await flushUpdates(users, operations);
        operations = [];
      }
    }

    modified += await flushUpdates(users, operations);
    const remaining = await users.countDocuments(filter);
    printResult({
      dryRun: false,
      matched,
      modified,
      remaining,
      ...timeRange,
    });

    if (remaining !== 0) {
      throw new Error(`migration incomplete: remaining=${remaining}`);
    }
  } finally {
    await client.close();
  }
}

async function flushUpdates(users, operations) {
  if (!operations.length) {
    return 0;
  }

  const result = await users.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || 0;
}

async function readCreatedAtRange(users, filter) {
  const [earliest, latest] = await Promise.all([
    users.findOne(filter, {
      projection: { createdAt: 1 },
      sort: { createdAt: 1 },
    }),
    users.findOne(filter, {
      projection: { createdAt: 1 },
      sort: { createdAt: -1 },
    }),
  ]);

  return {
    earliestCreatedAt: formatDate(earliest?.createdAt),
    latestCreatedAt: formatDate(latest?.createdAt),
  };
}

function correctDefaultUserName(value) {
  const match = WRONG_DEFAULT_NAME_PATTERN.exec(String(value || '').trim());
  return match ? `${CORRECT_DEFAULT_NAME_PREFIX}${match[1]}` : '';
}

function parseOperation(args) {
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  const unknown = args.filter(
    value => !['--dry-run', '--apply'].includes(value)
  );

  if (unknown.length || Number(dryRun) + Number(apply) !== 1) {
    throw new Error(
      'usage: node migrate-weiliaoyan-default-user-names.js (--dry-run|--apply)'
    );
  }

  return { dryRun };
}

function printResult(result) {
  console.log(
    `[migrate-weiliaoyan-default-user-names] done dryRun=${result.dryRun} matched=${result.matched} modified=${result.modified} remaining=${result.remaining} earliestCreatedAt=${result.earliestCreatedAt} latestCreatedAt=${result.latestCreatedAt}`
  );
}

function formatDate(value) {
  return value instanceof Date ? value.toISOString() : 'none';
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

module.exports = {
  correctDefaultUserName,
  parseOperation,
};
