const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { Queue } = require('bullmq');
const crypto = require('crypto');

loadLocalEnv();

const USER_ID = '6aa2823f7ba14c4a0c135743';
const AGENT_ID = '6aa2827d9b8de2feffcb6b6c';
const CONVERSATION_ID = '6aa285577ba14c4a0c135b21';
const SOURCE_MESSAGE_ID = '6aa28e0862e3f394d7e5e63d';
const IMAGE_OBJECT_KEY = 'conversation-images/2026/09/10/tmp_afff5d2d2c4bb057be541b986ea2aa769142-dfc04796d82d4277.jpg';
const QUEUE_NAME = 'conversation-chat-import';

async function main() {
  const mongoClient = new MongoClient(buildMongoConnectionString());
  await mongoClient.connect();

  const queue = new Queue(QUEUE_NAME, {
    connection: {
      host: readEnv(['NODE_REDIS_HOST', 'REDIS_HOST'], '127.0.0.1'),
      port: parseInt(readEnv(['NODE_REDIS_PORT', 'REDIS_PORT'], '6379'), 10),
      db: parseInt(readEnv(['NODE_REDIS_DB', 'REDIS_DB'], '0'), 10),
      password: readEnv(['NODE_REDIS_PASSWORD', 'REDIS_PASSWORD'], '') || undefined,
    },
    prefix: readEnv(['NODE_BULLMQ_PREFIX'], '{tzl-bullmq}'),
  });

  try {
    const db = mongoClient.db(readEnv(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl'));
    const batchCollection = db.collection('conversation_chat_import_batch');

    // 检查是否已经有这个 source message 的 batch
    const existing = await batchCollection.findOne({
      clientRequestId: `manual-backfill:${SOURCE_MESSAGE_ID}`,
    });
    if (existing) {
      console.log(`已存在回填 batch: ${existing._id}, status=${existing.status}`);
      return;
    }

    const now = new Date();
    const assetId = crypto.randomBytes(12).toString('hex');

    const batch = {
      _id: new ObjectId(),
      userId: new ObjectId(USER_ID),
      agentId: new ObjectId(AGENT_ID),
      conversationId: new ObjectId(CONVERSATION_ID),
      clientRequestId: `manual-backfill:${SOURCE_MESSAGE_ID}`,
      status: 'queued',
      assets: [
        {
          id: assetId,
          objectKey: IMAGE_OBJECT_KEY,
          publicUrl: null,
          mimeType: 'image/jpeg',
          screenshotSequence: 0,
          imageHash: '',
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          errorCode: null,
          errorDetail: null,
        },
      ],
      leftSpeaker: 'agent',
      rightSpeaker: 'user',
      screenshotCount: 1,
      recognizedCount: 0,
      confirmedCount: 0,
      failedCount: 0,
      duplicateCount: 0,
      deleteAssetsAfterImport: false,
      memoryStatus: 'pending',
      styleStatus: 'pending',
      memoryCandidates: [],
      retryCount: 0,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const result = await batchCollection.insertOne(batch);
    console.log(`创建 batch 成功: ${result.insertedId}`);

    // 入队
    const jobId = `chat-import:recognize:${result.insertedId}`;
    await queue.add(
      'recognize',
      {
        operation: 'recognize',
        batchId: result.insertedId.toString(),
      },
      {
        jobId,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
        backoff: { type: 'exponential', delay: 3000 },
      }
    );

    console.log(`已入队 (jobId=${jobId})`);
    console.log('等待 worker 处理...');
  } finally {
    await queue.close();
    await mongoClient.close();
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

main().catch((err) => {
  console.error('手动回填失败:', err);
  process.exit(1);
});
