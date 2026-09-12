#!/usr/bin/env node
'use strict';
// 第二层（原文检索）的本地核对：不依赖向量库，只读本地镜像库。
//   - 原话留存率：有多少条用户原话留下了检索锚；
//   - 人物标签覆盖率：留下的锚里有多少带人物标签；
//   - 人物范围召回探针：提到某位家人的旧话，是否都能被"按人物"取回。
// 只读本地镜像库，不连生产、不写任何东西。
//
// 用法：MIRROR_DB=tzl_mirror-s1 node anchor-coverage.js <userId>
const { MongoClient } = require('mongodb');

const dbName = process.env.MIRROR_DB;
const userId = process.argv[2];
if (!dbName || !userId) {
  console.error('usage: MIRROR_DB=<mirrorDb> node anchor-coverage.js <userId>');
  process.exit(1);
}
const uri = `mongodb://127.0.0.1:${process.env.MONGO_PORT || 17271}/${dbName}`;

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  const messages = await db
    .collection('message')
    .find({
      userId: { $in: [userId, require('mongodb').ObjectId.createFromHexString(userId)] },
      role: 'user',
      status: 'sent',
      isArchived: { $ne: true },
    })
    .sort({ createdAt: 1 })
    .toArray();
  const anchors = await db
    .collection('eval_anchor_unit')
    .find({ userId })
    .toArray();

  const anchored = new Map();
  for (const anchor of anchors) {
    const key = String(anchor.sourceMessageId);
    const list = anchored.get(key) || [];
    list.push(anchor);
    anchored.set(key, list);
  }
  const userMessages = messages.filter(m => (m.content || '').trim());
  const kept = userMessages.filter(m => anchored.has(String(m._id)));
  const withPerson = anchors.filter(a => a.personId);
  const personLabels = new Map();
  for (const anchor of withPerson) {
    const label = String(anchor.searchableText || '')
      .match(
        /(爸爸|妈妈|父亲|母亲|爷爷|奶奶|外公|外婆|姥姥|姥爷|哥哥|姐姐|弟弟|妹妹|儿子|女儿|孙子|孙女|外孙|外孙女|丈夫|妻子|老公|老婆)/
      )?.[1];
    if (!label) continue;
    personLabels.set(label, [
      ...(personLabels.get(label) || []),
      String(anchor.sourceMessageId),
    ]);
  }
  const probe = [];
  for (const [label, ids] of personLabels) {
    const mentions = userMessages.filter(m =>
      String(m.content || '').includes(label)
    );
    if (mentions.length < 2) continue;
    const covered = mentions.filter(m => anchored.has(String(m._id)));
    probe.push({
      label,
      mentions: mentions.length,
      anchored: covered.length,
      recall: Number((covered.length / mentions.length).toFixed(3)),
    });
  }
  const result = {
    userId,
    db: dbName,
    userMessages: userMessages.length,
    anchoredMessages: kept.length,
    rawRetentionRate: userMessages.length
      ? Number((kept.length / userMessages.length).toFixed(3))
      : 0,
    anchorUnits: anchors.length,
    personTaggedRate: anchors.length
      ? Number((withPerson.length / anchors.length).toFixed(3))
      : 0,
    personScopeProbe: probe.sort((a, b) => b.mentions - a.mentions),
    unanchoredSamples: userMessages
      .filter(m => !anchored.has(String(m._id)))
      .slice(0, 8)
      .map(m => String(m.content || '').slice(0, 40)),
  };
  console.log(JSON.stringify(result, null, 2));
  await client.close();
})().catch(error => {
  console.error('ANCHOR_COVERAGE_FAILED', error.message);
  process.exit(1);
});
