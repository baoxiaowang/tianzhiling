const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const MESSENGER_AVATAR_KEY = 'weapp/messenger-avatar-20260818-5c48467a.png';

loadLocalEnv();

async function main() {
  const operation = parseOperationArgs(process.argv.slice(2));
  if (
    !operation.activeMembers &&
    !operation.allUsers &&
    operation.identifiers.length === 0
  ) {
    throw new Error(
      'usage: node provision-user-messengers.js [--dry-run] (--all-users|--active-members|<userId|weapp:account> [userId|weapp:account...])'
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
    const targets = operation.allUsers
      ? await resolveAllAgentOwnerTargets(db)
      : operation.activeMembers
      ? await resolveActiveMemberTargets(db, new Date())
      : await resolveUserTargets(db, operation.identifiers);

    if (operation.dryRun) {
      const audit = await auditMessengerProvisioning(db, targets);
      console.log(
        `[provision-user-messengers] done dryRun=true users=${targets.length} agents=${audit.agents} messengersCreated=${audit.messengersMissing} conversationsCreated=${audit.conversationsMissing} greetingsCreated=${audit.greetingsMissing}`
      );
      return;
    }

    if (operation.activeMembers || operation.allUsers) {
      const result = await provisionTargetsInBulk(db, targets);
      console.log(
        `[provision-user-messengers] done dryRun=false users=${targets.length} agents=${result.agents} messengersCreated=${result.messengersCreated} conversationsCreated=${result.conversationsCreated} greetingsCreated=${result.greetingsCreated}`
      );
      return;
    }

    let totalProcessed = 0;
    let totalMessengersCreated = 0;
    let totalConversationsCreated = 0;
    let totalGreetingsCreated = 0;

    for (const { identifier, userId } of targets) {
      const parents = await agents
        .find({ createdUserId: userId, messengerOfAgentId: { $exists: false } })
        .toArray();
      let processed = 0;
      let messengersCreated = 0;
      let conversationsCreated = 0;
      let greetingsCreated = 0;

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
            `你好，我是${messengerName}，可以帮${parentName}找回记忆。`,
            `你最想让${parentName}想起来的是？`,
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
          greetingsCreated += 1;
        }

        processed += 1;
      }

      console.log(
        `[provision-user-messengers] dryRun=${
          operation.dryRun
        } identifier=${identifier} userId=${userId.toHexString()} agents=${processed} messengersCreated=${messengersCreated} conversationsCreated=${conversationsCreated} greetingsCreated=${greetingsCreated}`
      );
      totalProcessed += processed;
      totalMessengersCreated += messengersCreated;
      totalConversationsCreated += conversationsCreated;
      totalGreetingsCreated += greetingsCreated;
    }

    console.log(
      `[provision-user-messengers] done dryRun=${operation.dryRun} users=${targets.length} agents=${totalProcessed} messengersCreated=${totalMessengersCreated} conversationsCreated=${totalConversationsCreated} greetingsCreated=${totalGreetingsCreated}`
    );
  } finally {
    await client.close();
  }
}

function parseOperationArgs(args) {
  const activeMembers = args.includes('--active-members');
  const allUsers = args.includes('--all-users');
  const dryRun = args.includes('--dry-run');
  const identifiers = parseUserIdentifiers(
    args.filter(
      value => !['--active-members', '--all-users', '--dry-run'].includes(value)
    )
  );

  if (
    Number(activeMembers) + Number(allUsers) + Number(identifiers.length > 0) >
    1
  ) {
    throw new Error(
      '--all-users, --active-members, and user identifiers are mutually exclusive'
    );
  }

  return { activeMembers, allUsers, dryRun, identifiers };
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

async function resolveActiveMemberTargets(db, now = new Date()) {
  const memberships = await db
    .collection('user_membership')
    .aggregate([
      {
        $match: {
          status: 'active',
          $or: [{ lifetime: true }, { expiredAt: { $gt: now } }],
        },
      },
      { $group: { _id: '$userId' } },
      { $match: { _id: { $type: 'objectId' } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  return memberships.map(item => ({
    identifier: 'active-membership',
    userId: new ObjectId(item._id),
  }));
}

async function resolveAllAgentOwnerTargets(db) {
  const userIds = await db.collection('agent').distinct('createdUserId', {
    messengerOfAgentId: { $exists: false },
    createdUserId: { $type: 'objectId' },
  });

  return userIds
    .map(userId => new ObjectId(userId))
    .sort((left, right) =>
      left.toHexString().localeCompare(right.toHexString())
    )
    .map(userId => ({ identifier: 'all-users', userId }));
}

async function auditMessengerProvisioning(db, targets) {
  const userIds = targets.map(item => item.userId);
  if (!userIds.length) {
    return {
      agents: 0,
      messengersMissing: 0,
      conversationsMissing: 0,
      greetingsMissing: 0,
    };
  }

  const agents = db.collection('agent');
  const conversations = db.collection('conversation');
  const messages = db.collection('message');
  const parents = await agents
    .find({
      createdUserId: { $in: userIds },
      messengerOfAgentId: { $exists: false },
    })
    .toArray();
  const parentIds = parents.map(parent => parent._id);
  const messengers = parentIds.length
    ? await agents
        .find({
          createdUserId: { $in: userIds },
          messengerOfAgentId: { $in: parentIds },
        })
        .toArray()
    : [];
  const messengerByParent = new Map(
    messengers.map(messenger => [
      `${objectIdKey(messenger.createdUserId)}:${objectIdKey(
        messenger.messengerOfAgentId
      )}`,
      messenger,
    ])
  );
  const messengerIds = messengers.map(messenger => messenger._id);
  const existingConversations = messengerIds.length
    ? await conversations
        .find({
          agentId: { $in: messengerIds },
          userId: { $in: userIds },
        })
        .toArray()
    : [];
  const conversationByMessenger = new Map(
    existingConversations.map(conversation => [
      `${objectIdKey(conversation.userId)}:${objectIdKey(
        conversation.agentId
      )}`,
      conversation,
    ])
  );
  const conversationIds = existingConversations.map(item => item._id);
  const greetingConversationIds = new Set(
    conversationIds.length
      ? (
          await messages
            .find(
              { conversationId: { $in: conversationIds } },
              { projection: { conversationId: 1 } }
            )
            .toArray()
        ).map(message => objectIdKey(message.conversationId))
      : []
  );

  let messengersMissing = 0;
  let conversationsMissing = 0;
  let greetingsMissing = 0;

  for (const parent of parents) {
    const userId = objectIdKey(parent.createdUserId);
    const messenger = messengerByParent.get(
      `${userId}:${objectIdKey(parent._id)}`
    );
    const conversation = messenger
      ? conversationByMessenger.get(`${userId}:${objectIdKey(messenger._id)}`)
      : null;

    if (!messenger) messengersMissing += 1;
    if (!conversation) conversationsMissing += 1;
    if (
      !conversation ||
      !greetingConversationIds.has(objectIdKey(conversation._id))
    ) {
      greetingsMissing += 1;
    }
  }

  return {
    agents: parents.length,
    messengersMissing,
    conversationsMissing,
    greetingsMissing,
  };
}

function objectIdKey(value) {
  return value?.toHexString?.() || String(value || '');
}

async function provisionTargetsInBulk(db, targets, now = new Date()) {
  const userIds = targets.map(item => item.userId);
  if (!userIds.length) {
    return {
      agents: 0,
      messengersCreated: 0,
      conversationsCreated: 0,
      greetingsCreated: 0,
    };
  }

  const agents = db.collection('agent');
  const conversations = db.collection('conversation');
  const messages = db.collection('message');
  const parents = await agents
    .find({
      createdUserId: { $in: userIds },
      messengerOfAgentId: { $exists: false },
    })
    .toArray();
  const messengerResult = parents.length
    ? await agents.bulkWrite(
        parents.map(parent => {
          const parentName = String(parent.name || 'TA').trim();
          const messengerName = `${parentName}的小使者`;
          return {
            updateOne: {
              filter: {
                createdUserId: parent.createdUserId,
                messengerOfAgentId: parent._id,
              },
              update: {
                $set: {
                  name: messengerName,
                  avatar: MESSENGER_AVATAR_KEY,
                  iCallAgent: messengerName,
                  updatedAt: now,
                },
                $setOnInsert: {
                  createdUserId: parent.createdUserId,
                  realName: '',
                  sex: parent.sex ?? 2,
                  agentCallMe: '',
                  description: '',
                  status: 1,
                  isDefault: false,
                  messengerOfAgentId: parent._id,
                  createdAt: now,
                },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false }
      )
    : { upsertedCount: 0 };
  const parentIds = parents.map(parent => parent._id);
  const messengers = parentIds.length
    ? await agents
        .find({
          createdUserId: { $in: userIds },
          messengerOfAgentId: { $in: parentIds },
        })
        .toArray()
    : [];
  const conversationResult = messengers.length
    ? await conversations.bulkWrite(
        messengers.map(messenger => {
          const messengerName = String(messenger.name || '天之灵小使者');
          return {
            updateOne: {
              filter: {
                agentId: messenger._id,
                userId: messenger.createdUserId,
              },
              update: {
                $setOnInsert: {
                  agentId: messenger._id,
                  userId: messenger.createdUserId,
                  accessRole: 'owner',
                  agentCallsUser: '',
                  userCallsAgent: messengerName,
                  createdAt: now,
                  updatedAt: now,
                },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false }
      )
    : { upsertedCount: 0 };
  const messengerIds = messengers.map(messenger => messenger._id);
  const existingConversations = messengerIds.length
    ? await conversations
        .find({
          agentId: { $in: messengerIds },
          userId: { $in: userIds },
        })
        .toArray()
    : [];
  const conversationIds = existingConversations.map(item => item._id);
  const greetingConversationIds = new Set(
    conversationIds.length
      ? (
          await messages
            .find(
              { conversationId: { $in: conversationIds } },
              { projection: { conversationId: 1 } }
            )
            .toArray()
        ).map(message => objectIdKey(message.conversationId))
      : []
  );
  const messengerById = new Map(
    messengers.map(messenger => [objectIdKey(messenger._id), messenger])
  );
  const conversationsMissingGreetings = existingConversations.filter(
    conversation => !greetingConversationIds.has(objectIdKey(conversation._id))
  );
  const greetingMessages = conversationsMissingGreetings.flatMap(
    conversation => {
      const messenger = messengerById.get(objectIdKey(conversation.agentId));
      const messengerName = String(messenger?.name || '天之灵小使者');
      const parentName = messengerName.endsWith('的小使者')
        ? messengerName.slice(0, -4)
        : 'TA';
      return [
        `你好，我是${messengerName}，可以帮${parentName}找回记忆。`,
        `你最想让${parentName}想起来的是？`,
      ].map((content, index) => ({
        conversationId: conversation._id,
        userId: conversation.userId,
        agentId: conversation.agentId,
        role: 'assistant',
        type: 'text',
        content,
        status: 'sent',
        createdAt: new Date(now.getTime() + index),
        updatedAt: new Date(now.getTime() + index),
      }));
    }
  );

  if (greetingMessages.length) {
    await messages.insertMany(greetingMessages, { ordered: false });
  }

  return {
    agents: parents.length,
    messengersCreated: messengerResult.upsertedCount || 0,
    conversationsCreated: conversationResult.upsertedCount || 0,
    greetingsCreated: conversationsMissingGreetings.length,
  };
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

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  auditMessengerProvisioning,
  parseOperationArgs,
  parseUserIdentifiers,
  resolveActiveMemberTargets,
  resolveAllAgentOwnerTargets,
  resolveUserTargets,
  provisionTargetsInBulk,
};
