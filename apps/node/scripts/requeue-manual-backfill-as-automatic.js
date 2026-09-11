const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { Queue } = require('bullmq');

loadLocalEnv();

const BATCH_ID = '6aa2c1063216c118863c0a6d';
const SOURCE_MESSAGE_ID = '6aa28e0862e3f394d7e5e63d';
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

    const now = new Date();

    // 修改 batch：clientRequestId 改成 automatic-image: 前缀，状态重置为 queued
    const result = await batchCollection.updateOne(
      { _id: new ObjectId(BATCH_ID) },
      {
        $set: {
          clientRequestId: `automatic-image:${SOURCE_MESSAGE_ID}`,
          status: 'queued',
          retryCount: 0,
          recognizedCount: 0,
          confirmedCount: 0,
          failedCount: 0,
          memoryStatus: 'pending',
          styleStatus: 'pending',
          'assets.$[].status': 'pending',
          'assets.$[].errorCode': null,
          'assets.$[].errorDetail': null,
          updatedAt: now,
        },
        $unset: {
          errorCode: '',
          errorDetail: '',
          recognizedAt: '',
          confirmedAt: '',
          completedAt: '',
        },
      }
    );

    console.log(`修改 batch 成功: matched=${result.matchedCount}, modified=${result.modifiedCount}`);

    // 入队
    const jobId = `chat-import:recognize:${BATCH_ID}`;
    await queue.add(
      'recognize',
      {
        operation: 'recognize',
        batchId: BATCH_ID,
      },
      {
        jobId,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
        backoff: { type: 'exponential', delay: 3000 },
      }
    );

    console.log(`已重新入队 (jobId=${jobId})`);
    console.log('clientRequestId 已改为 automatic-image: 前缀，将走完整自动导入流程');
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
  console.error('重新入队失败:', err);
  process.exit(1);
});
