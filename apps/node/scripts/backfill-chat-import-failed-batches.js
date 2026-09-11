const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { Queue } = require('bullmq');

loadLocalEnv();

const USER_ID = '6aa2823f7ba14c4a0c135743';
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

    const failedBatches = await batchCollection
      .find({
        userId: new ObjectId(USER_ID),
        status: { $in: ['failed', 'queued'] },
      })
      .sort({ createdAt: 1 })
      .toArray();

    console.log(`找到 ${failedBatches.length} 个失败的导入 batch`);

    let requeued = 0;
    for (const batch of failedBatches) {
      console.log(`\n处理 batch ${batch._id} (createdAt=${batch.createdAt})`);

      // 重置 batch 状态
      const assets = (batch.assets || []).map((asset) => ({
        ...asset,
        status: 'pending',
        errorCode: undefined,
        errorDetail: undefined,
      }));

      await batchCollection.updateOne(
        { _id: batch._id },
        {
          $set: {
            status: 'queued',
            retryCount: 0,
            recognizedCount: 0,
            confirmedCount: 0,
            failedCount: 0,
            assets,
            updatedAt: new Date(),
          },
          $unset: {
            errorCode: '',
            errorDetail: '',
          },
        }
      );

      // 入队
      const jobId = `chat-import:recognize:${batch._id}`;
      await queue.add(
        'recognize',
        {
          operation: 'recognize',
          batchId: batch._id.toString(),
        },
        {
          jobId,
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: true,
          backoff: { type: 'exponential', delay: 3000 },
        }
      );

      console.log(`  已重置状态并入队 (jobId=${jobId})`);
      requeued++;
    }

    console.log(`\n完成：共重新入队 ${requeued} 个 batch`);
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
  console.error('回填失败:', err);
  process.exit(1);
});
