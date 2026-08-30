const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient } = require('mongodb');

const SOURCE_CONFIG = {
  lifeExperience: {
    type: 'memory',
    key: 'profile_source.life_experience',
    valuePrefix: '当前角色生平经历：',
    priority: 3,
    assertionPolicy: 'can_assert',
  },
  personalityTraits: {
    type: 'style',
    key: 'profile_source.personality_traits',
    valuePrefix: '当前角色性格特点：',
    priority: 3,
    assertionPolicy: 'context_only',
  },
  languageHabits: {
    type: 'style',
    key: 'profile_source.language_habits',
    valuePrefix: '当前角色语言习惯：',
    priority: 3,
    assertionPolicy: 'context_only',
  },
  hobbies: {
    type: 'preference',
    key: 'profile_source.hobbies',
    valuePrefix: '当前角色兴趣爱好：',
    priority: 2,
    assertionPolicy: 'can_assert',
  },
  sharedMemories: {
    type: 'memory',
    key: 'profile_source.shared_memories',
    valuePrefix: '用户与当前角色的共同记忆：',
    priority: 3,
    assertionPolicy: 'can_assert',
  },
};

loadLocalEnv();

async function main() {
  const client = new MongoClient(buildMongoConnectionString());

  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const db = client.db(database);
    const agents = db.collection('agent');
    const facts = db.collection('agent_profile_fact');
    const cursor = agents.find(
      {},
      {
        projection: {
          createdUserId: 1,
          lifeExperience: 1,
          personalityTraits: 1,
          languageHabits: 1,
          hobbies: 1,
          sharedMemories: 1,
        },
      }
    );
    let scanned = 0;
    let synchronized = 0;

    while (await cursor.hasNext()) {
      const agent = await cursor.next();

      if (!agent?.createdUserId || !agent?._id) {
        continue;
      }

      scanned += 1;
      const now = new Date();
      const operations = Object.entries(SOURCE_CONFIG).map(
        ([field, config]) => {
          const sourceText = String(agent[field] || '')
            .trim()
            .slice(0, 1000);
          const filter = {
            userId: agent.createdUserId,
            agentId: agent._id,
            key: config.key,
          };

          if (!sourceText) {
            return {
              updateOne: {
                filter,
                update: {
                  $set: {
                    status: 'archived',
                    updatedAt: now,
                  },
                },
                upsert: false,
              },
            };
          }

          return {
            updateOne: {
              filter,
              update: {
                $set: {
                  type: config.type,
                  value: `${config.valuePrefix}${sourceText}`,
                  polarity: 'positive',
                  confidence: 'confirmed',
                  status: 'active',
                  priority: config.priority,
                  sourceText,
                  assertionPolicy: config.assertionPolicy,
                  updatedAt: now,
                },
                $setOnInsert: {
                  userId: agent.createdUserId,
                  agentId: agent._id,
                  key: config.key,
                  supportCount: 1,
                  conflictingValues: [],
                  createdAt: now,
                },
              },
              upsert: true,
            },
          };
        }
      );
      const result = await facts.bulkWrite(operations, { ordered: false });

      synchronized += result.modifiedCount + result.upsertedCount;
    }

    console.log(
      `[profile-memory-sources] completed scanned=${scanned} synchronized=${synchronized}`
    );
  } finally {
    await client.close();
  }
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

main().catch(error => {
  console.error(error);
  process.exit(1);
});
