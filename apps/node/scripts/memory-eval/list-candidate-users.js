'use strict';
// 在生产端容器内运行：只读统计候选评测用户，按最近 30 天的用户消息数排序。
// 只做 find/aggregate 读取，绝不写生产库。
const { MongoClient, BSON } = require('mongodb');

const host = process.env.NODE_MONGO_HOST || 'tzl_mongo';
const port = process.env.NODE_MONGO_PORT || '27017';
const dbName = process.env.NODE_MONGO_DB || 'tzl';
const username = process.env.NODE_MONGO_USERNAME || 'admin';
const password = process.env.NODE_MONGO_PASSWORD || 'qwerasdf';
const authSource = process.env.NODE_MONGO_AUTH_SOURCE || 'admin';
const DAYS = Number(process.env.CANDIDATE_DAYS || 30);
// 默认按回放口径统计全部历史（回放只受 createdAt < until 限制）。
const FULL_HISTORY = process.env.CANDIDATE_FULL_HISTORY !== '0';
const MIN = Number(process.env.CANDIDATE_MIN || 25);
const MAX = Number(process.env.CANDIDATE_MAX || 60);
const uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(
  password
)}@${host}:${port}/${dbName}?authSource=${authSource}`;

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  const since = new Date(Date.now() - DAYS * 86400000);
  // 口径必须与回放的 scope() 一致：role=user、status=sent、未归档；
  // 回放不限起始时间，只看 createdAt < until，所以这里也统计全部历史。
  const rows = await db
    .collection('message')
    .aggregate([
      {
        $match: {
          role: 'user',
          status: 'sent',
          isArchived: { $ne: true },
          ...(FULL_HISTORY ? {} : { createdAt: { $gte: since } }),
        },
      },
      {
        $group: {
          _id: '$userId',
          messages: { $sum: 1 },
          last: { $max: '$createdAt' },
        },
      },
      { $match: { messages: { $gte: MIN, $lte: MAX } } },
      { $sort: { messages: -1 } },
      { $limit: 40 },
    ])
    .toArray();
  console.log(
    'CANDIDATES=' +
      BSON.EJSON.stringify(
        rows.map(r => ({
          userId: String(r._id),
          messages: r.messages,
          last: r.last,
        }))
      )
  );
  await client.close();
})().catch(error => {
  console.error('CANDIDATE_ERR=' + error.message);
  process.exit(1);
});
