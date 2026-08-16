const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const MESSENGER_KIND = 'messenger';

loadLocalEnv();

async function main() {
  const client = new MongoClient(buildMongoConnectionString());
  await client.connect();

  try {
    const database = readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl');
    const db = client.db(database);
    const agents = db.collection('agent');
    const subs = db.collection('agent_sub');
    const conversations = db.collection('conversation');
    const messages = db.collection('message');

    const agentCursor = agents.find({});
    let createdMessengers = 0;
    let createdConversations = 0;

    for await (const agent of agentCursor) {
      const agentId = agent._id;
      const userId = agent.createdUserId;
      if (!agentId || !userId) {
        continue;
      }

      const messengerName = `${String(agent.name || 'TA').trim()}的小使者`;
      const now = new Date();

      const messengerResult = await subs.updateOne(
        { agentId, kind: MESSENGER_KIND },
        {
          $setOnInsert: {
            agentId,
            kind: MESSENGER_KIND,
            name: messengerName,
            avatar: '',
            status: 1,
            agentCallMe: '',
            iCallAgent: messengerName,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );

      const messenger = await subs.findOne({ agentId, kind: MESSENGER_KIND });
      if (!messenger) {
        continue;
      }

      if (messengerResult.upsertedCount) {
        createdMessengers += 1;
      }

      const conversationResult = await conversations.updateOne(
        { agentId, subAgentId: messenger._id, userId },
        {
          $setOnInsert: {
            agentId,
            subAgentId: messenger._id,
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
        agentId,
        subAgentId: messenger._id,
        userId,
      });

      if (!conversation) {
        continue;
      }

      if (conversationResult.upsertedCount) {
        createdConversations += 1;
        const hasGreeting = await messages.findOne({ conversationId: conversation._id });
        if (!hasGreeting) {
          await messages.insertOne({
            conversationId: conversation._id,
            userId,
            agentId,
            role: 'assistant',
            type: 'text',
            content: `你好，我是${messengerName}。关于他/她的故事，你都可以慢慢告诉我，我会帮你整理进资料里。`,
            status: 'sent',
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    console.log(
      `[agent-messengers] ready createdMessengers=${createdMessengers} createdConversations=${createdConversations}`
    );
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
  const password = encodeURIComponent(readEnv(['NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'], 'qwerasdf'));
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
