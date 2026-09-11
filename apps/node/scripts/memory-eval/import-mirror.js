'use strict';
// 本地运行：把生产只读导出的 EJSON 写入本地镜像库。
// 安全护栏：只允许写入本机、且数据库名必须是 tzl_mirror*，绝不指向生产库。
const fs = require('fs');
const path = require('path');
const { MongoClient, BSON } = require('mongodb');

const source = process.argv[2] || '/tmp/memory-eval-mirror.json';
const dbName = process.env.MIRROR_DB || 'tzl_mirror';
const host = process.env.MIRROR_MONGO_HOST || '127.0.0.1';
const port =
  process.env.MIRROR_MONGO_PORT ||
  process.env.NODE_MONGO_PORT ||
  process.env.MONGO_PORT ||
  '17271';
const username = process.env.NODE_MONGO_USERNAME || process.env.MONGO_USERNAME || 'admin';
const password = process.env.NODE_MONGO_PASSWORD || process.env.MONGO_PASSWORD || 'qwerasdf';
const authSource =
  process.env.NODE_MONGO_AUTH_SOURCE || process.env.MONGO_AUTH_SOURCE || 'admin';

if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('MIRROR_GUARD_HOST:' + host);
}
if (!/^tzl_mirror/.test(dbName)) {
  throw new Error('MIRROR_GUARD_DB:' + dbName);
}

const uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(
  password
)}@${host}:${port}/${dbName}?authSource=${authSource}`;

(async () => {
  const raw = BSON.EJSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  const counts = {};
  // 清掉上一轮遗留的运行态集合，避免回放的“让路给线上流量”检查被它们挡住。
  for (const operational of [
    'memory_pipeline_task',
    'conversation_reply_turn',
  ]) {
    await db.collection(operational).deleteMany({});
  }
  for (const [name, docs] of Object.entries(raw.collections || {})) {
    await db.collection(name).deleteMany({});
    if (docs.length) await db.collection(name).insertMany(docs);
    counts[name] = docs.length;
  }
  await db.collection('_mirror_meta').replaceOne(
    { _id: 'manifest' },
    {
      _id: 'manifest',
      version: raw.version || 1,
      capturedAt: raw.capturedAt || '',
      userIds: raw.userIds || [],
      counts,
      importedAt: new Date().toISOString(),
    },
    { upsert: true }
  );
  console.log(
    `IMPORT_OK db=${dbName} counts=` +
      Object.entries(counts)
        .map(([key, value]) => `${key}:${value}`)
        .join(',')
  );
  await client.close();
})().catch(error => {
  console.error('IMPORT_ERR=' + error.message);
  process.exit(1);
});
