const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const MESSENGER_AVATAR_KEY = 'weapp/messenger-avatar-20260817.png';

loadLocalEnv();

async function main() {
  const identifiers = parseUserIdentifiers(process.argv.slice(2));
  if (identifiers.length === 0) {
    throw new Error(
      'usage: node provision-user-messengers.js <userId|weapp:account> [userId|weapp:account...]'
    );
  }

  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const db = client.db(database);
    const agents = db.collection('agent');
    const conversations = db.collection('conversation');
    const messages = db.collection('message');
    const targets = await resolveUserTargets(db, identifiers);

    let totalProcessed = 0;
    let totalMessengersCreated = 0;
    let totalConversationsCreated = 0;

    for (const { identifier, userId } of targets) {
      const parents = await agents
        .find({ createdUserId: userId, messengerOfAgentId: { $exists: false } })
        .toArray();
      let processed = 0;
      let messengersCreated = 0;
      let conversationsCreated = 0;

      for (const parent of parents) {
        const parentId = parent._id;
        const parentName = String(parent.name || 'TA').trim();
        const messengerName = `${parentName}的小使者`;
        const now = new Date();

        const messengerResult = await agents.updateOne(
          { createdUserId: userId, messengerOfAgentId: parentId },
          {
            $set: {
              name: messengerName,
              avatar: MESSENGER_AVATAR_KEY,
              iCallAgent: messengerName,
              updatedAt: now,
            },
            $setOnInsert: {
              createdUserId: userId,
              realName: '',
              sex: parent.sex ?? 2,
              agentCallMe: '',
              description: '',
              status: 1,
              isDefault: false,
              messengerOfAgentId: parentId,
              createdAt: now,
            },
          },
          { upsert: true }
        );

        const messenger = await agents.findOne({
          createdUserId: userId,
          messengerOfAgentId: parentId,
        });

        if (!messenger) {
          continue;
        }

        if (messengerResult.upsertedCount) {
          messengersCreated += 1;
        }

        const conversationResult = await conversations.updateOne(
          { agentId: messenger._id, userId },
          {
            $setOnInsert: {
              agentId: messenger._id,
              userId,
              accessRole: 'owner',
              agentCallsUser: '',
              userCallsAgent: messengerName,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true }
        );

        const conversation = await conversations.findOne({
          agentId: messenger._id,
          userId,
        });

        if (!conversation) {
          continue;
        }

        if (conversationResult.upsertedCount) {
          conversationsCreated += 1;
        }

        const hasGreeting = await messages.findOne({
          conversationId: conversation._id,
        });

        if (!hasGreeting) {
          const greetings = [
            `你好，我是${messengerName}。关于${parentName}的事，都可以慢慢跟我讲。`,
            `你最想先让我了解${parentName}的哪一面？`,
          ];
          const greetingMessages = greetings.map((content, index) => ({
            conversationId: conversation._id,
            userId,
            agentId: messenger._id,
            role: 'assistant',
            type: 'text',
            content,
            status: 'sent',
            createdAt: new Date(now.getTime() + index),
            updatedAt: new Date(now.getTime() + index),
          }));
          await messages.insertMany(greetingMessages);
        }

        processed += 1;
      }

      console.log(
        `[provision-user-messengers] identifier=${identifier} userId=${userId.toHexString()} agents=${processed} messengersCreated=${messengersCreated} conversationsCreated=${conversationsCreated}`
      );
      totalProcessed += processed;
      totalMessengersCreated += messengersCreated;
      totalConversationsCreated += conversationsCreated;
    }

    console.log(
      `[provision-user-messengers] done users=${targets.length} agents=${totalProcessed} messengersCreated=${totalMessengersCreated} conversationsCreated=${totalConversationsCreated}`
    );
  } finally {
    await client.close();
  }
}

function parseUserIdentifiers(args) {
  const seen = new Set();
  const identifiers = [];

  for (const raw of args) {
    const value = String(raw).trim();
    if (!value) {
      continue;
    }
    if (!ObjectId.isValid(value) && !/^weapp:.+/.test(value)) {
      throw new Error(`invalid user identifier: ${value}`);
    }
    const key = ObjectId.isValid(value)
      ? new ObjectId(value).toHexString()
      : value;
    if (!seen.has(key)) {
      seen.add(key);
      identifiers.push(value);
    }
  }

  return identifiers;
}

async function resolveUserTargets(db, identifiers) {
  const userAccounts = db.collection('user_account');
  const seenUserIds = new Set();
  const targets = [];

  for (const identifier of identifiers) {
    let userId;
    if (ObjectId.isValid(identifier)) {
      userId = new ObjectId(identifier);
    } else {
      const userAccount = await userAccounts.findOne(
        { account: identifier },
        { projection: { userId: 1 } }
      );
      if (!userAccount?.userId || !ObjectId.isValid(userAccount.userId)) {
        throw new Error(`user account not found or invalid: ${identifier}`);
      }
      userId = new ObjectId(userAccount.userId);
    }

    const key = userId.toHexString();
    if (!seenUserIds.has(key)) {
      seenUserIds.add(key);
      targets.push({ identifier, userId });
    }
  }

  return targets;
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

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  parseUserIdentifiers,
  resolveUserTargets,
};
