'use strict';
// 在生产端容器内运行：只读导出固定评测集，输出 EJSON 到 /tmp。
// 不写生产库；仅 find 读取。
const fs = require('fs');
const { MongoClient, ObjectId, BSON } = require('mongodb');

const USER_IDS = (process.env.MIRROR_USER_IDS || process.argv.slice(2).join(','))
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
if (!USER_IDS.length) {
  console.error('EXPORT_ERR=no_user_ids');
  process.exit(1);
}

const host = process.env.NODE_MONGO_HOST || 'tzl_mongo';
const port = process.env.NODE_MONGO_PORT || '27017';
const dbName = process.env.NODE_MONGO_DB || 'tzl';
const username = process.env.NODE_MONGO_USERNAME || 'admin';
const password = process.env.NODE_MONGO_PASSWORD || 'qwerasdf';
const authSource = process.env.NODE_MONGO_AUTH_SOURCE || 'admin';
const uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(
  password
)}@${host}:${port}/${dbName}?authSource=${authSource}`;

const ids = USER_IDS.map(id => new ObjectId(id));
const SPECS = [
  ['user', { _id: { $in: ids } }],
  ['agent', { createdUserId: { $in: ids } }],
  ['conversation', { userId: { $in: ids } }],
  ['message', { userId: { $in: ids } }],
  ['agent_profile_fact', { userId: { $in: ids } }],
  ['agent_memory_fact', { userId: { $in: ids } }],
  ['user_identity_profile', { userId: { $in: ids } }],
  ['user_known_person', { userId: { $in: ids } }],
  ['user_relative_profile', { userId: { $in: ids } }],
  ['user_relative_fact', { userId: { $in: ids } }],
  ['person_temporal_assertion', { userId: { $in: ids } }],
  ['person_temporal_profile', { userId: { $in: ids } }],
];

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  const out = {
    version: 1,
    capturedAt: new Date().toISOString(),
    userIds: USER_IDS,
    collections: {},
  };
  for (const [name, filter] of SPECS) {
    out.collections[name] = await db.collection(name).find(filter).toArray();
  }
  const path = '/tmp/memory-eval-mirror.json';
  fs.writeFileSync(path, BSON.EJSON.stringify(out, { relaxed: false }));
  console.log(
    'EXPORT_OK bytes=' +
      fs.statSync(path).size +
      ' counts=' +
      Object.entries(out.collections)
        .map(([key, value]) => `${key}:${value.length}`)
        .join(',')
  );
  await client.close();
})().catch(error => {
  console.error('EXPORT_ERR=' + error.message);
  process.exit(1);
});
