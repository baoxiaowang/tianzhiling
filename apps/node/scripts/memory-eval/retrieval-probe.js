#!/usr/bin/env node
'use strict';
// 第二层（原文检索）探针：把用户原话按人物标签写进**本地**向量库，然后按
// "人物范围"与"全量语义"两条路径检索，核对旧话能不能被取回。
// 只写本地镜像库与本地向量库，不连生产、不写生产。
//
// 用法：MIRROR_DB=tzl_mirror_s1 node retrieval-probe.js --user=<userId> [--run=<runId>]
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');

const arg = (name, fallback) =>
  process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ||
  fallback;

async function main() {
  const dbName = process.env.MIRROR_DB;
  const userId = arg('user');
  if (!dbName || !userId) {
    throw new Error('usage: MIRROR_DB=<mirrorDb> node retrieval-probe.js --user=<id>');
  }
  const runId = arg('run', dbName);
  const root = path.resolve(__dirname, '../../../..');
  const outFile = path.resolve(
    root,
    arg('out', `.task-evidence/memory-eval/probe-${runId}.json`)
  );

  const config = require('../../dist/config/config.default').default;
  const { OpenAIService } = require('../../dist/service/agents/openai');
  const { MilvusService } = require('../../dist/service/rag/milvus.service');
  const { RetrieveService } = require('../../dist/service/rag/retrieve.service');

  const openai = new OpenAIService();
  openai.openAIConfig = config.openai;
  openai.logger = console;

  const milvus = new MilvusService();
  milvus.milvusConfig = {
    ...config.milvus,
    enabled: true,
    retrievalMode: 'active',
    writeEnabled: true,
  };
  milvus.openAIConfig = config.openai;
  milvus.openAIService = openai;
  milvus.logger = console;
  milvus.redisService = {
    get: async () => null,
    set: async () => null,
    del: async () => null,
  };

  if (!milvus.isEnabled()) throw new Error('MILVUS_DISABLED');
  if (!openai.hasEmbeddingConfig())
    throw new Error('EMBEDDING_CONFIG_MISSING');

  // 连接参数与回放脚本一致，只把库名换成镜像库。
  const typeorm = config.typeorm.dataSource.default;
  const client = new MongoClient(
    `mongodb://${encodeURIComponent(typeorm.username)}:${encodeURIComponent(
      typeorm.password
    )}@127.0.0.1:${process.env.MONGO_PORT || typeorm.port}/${dbName}?authSource=${encodeURIComponent(
      typeorm.authSource
    )}&directConnection=true`,
    { serverSelectionTimeoutMS: 10000 }
  );
  await client.connect();
  const db = client.db(dbName);

  const idVariants = [userId];
  if (ObjectId.isValid(userId)) idVariants.push(ObjectId.createFromHexString(userId));
  const messages = (
    await db
      .collection('message')
      .find({
        userId: { $in: idVariants },
        role: 'user',
        status: 'sent',
        isArchived: { $ne: true },
      })
      .sort({ createdAt: 1 })
      .toArray()
  ).filter(m => (m.content || '').trim());

  const people = await db
    .collection('user_known_person')
    .find({ userId: { $in: idVariants } })
    .toArray();

  // 1) 建立锚：每条原话 × 它提到的人；没有任何人物的原话也入一条全量锚。
  const anchors = new Map();
  const personOfMessage = new Map();
  for (const message of messages) {
    const content = String(message.content || '');
    const matched = [];
    for (const person of people) {
      const names = [
        person.realName,
        person.preferredName,
        ...(person.aliases || []),
      ]
        .map(v => String(v || '').trim())
        .filter(Boolean);
      if (!names.some(name => content.includes(name))) continue;
      const personId = String(person._id);
      matched.push(personId);
      const memoryId = createHash('sha256')
        .update(`${message._id}:${personId}:raw_episode`)
        .digest('hex')
        .slice(0, 32);
      anchors.set(memoryId, {
        memoryId,
        personId,
        searchableText: content,
        message,
      });
    }
    personOfMessage.set(String(message._id), matched);
    // 全量原文锚：线上由 semantic_index 写入，与人无关；这里一并写入，
    // 用来测"全量语义"这条路径。
    const unscopedId = createHash('sha256')
      .update(`${message._id}:unscoped:raw_episode`)
      .digest('hex')
      .slice(0, 32);
    anchors.set(unscopedId, {
      memoryId: unscopedId,
      personId: '',
      searchableText: content,
      message,
    });
  }

  // 2) 写入本地向量库（幂等）。
  let indexed = 0;
  for (const anchor of anchors.values()) {
    const ok = await milvus.indexConversationMessage({
      messageId: String(anchor.message._id),
      memoryId: anchor.memoryId,
      sourceMessageId: String(anchor.message._id),
      userId,
      conversationId: String(anchor.message.conversationId || ''),
      agentId: String(anchor.message.agentId || ''),
      role: 'user',
      type: String(anchor.message.type || 'text'),
      searchableText: anchor.searchableText,
      createdAt: anchor.message.createdAt,
      updatedAt: anchor.message.updatedAt || anchor.message.createdAt,
      personId: anchor.personId,
      memoryKind: 'raw_episode',
      sourceHash: anchor.memoryId,
    });
    if (ok) indexed += 1;
  }

  const retrieve = new RetrieveService();
  retrieve.logger = console;
  retrieve.milvusService = milvus;
  retrieve.openAIService = openai;
  retrieve.messageModel = {
    find: async options => {
      const where = options?.where || {};
      const ids = (where.id?.$in || []).map(String);
      if (!ids.length) return [];
      const docs = await db
        .collection('message')
        .find({
          _id: { $in: ids.filter(ObjectId.isValid).map(id => ObjectId.createFromHexString(id)) },
          isArchived: { $ne: true },
        })
        .toArray();
      return docs.map(d => ({ ...d, id: String(d._id) }));
    },
  };
  retrieve.stringifyObjectId = value => (value ? String(value) : String(value));

  // 3) 探针：用靠后的原话做查询，看它之前的旧话能否被取回。
  //    a) 按人物：查询话里提到了谁，就找之前提到同一位家人的旧话；
  //    b) 按话题：找之前文字高度重合（2-gram 重合 ≥0.3）的旧话。
  const bigrams = text =>
    new Set(
      String(text || '')
        .replace(/\s+/g, '')
        .split('')
        .map((_, index, arr) => arr.slice(index, index + 2).join(''))
        .filter(part => part.length === 2)
    );
  const overlap = (left, right) => {
    const a = bigrams(left);
    const b = bigrams(right);
    if (!a.size || !b.size) return 0;
    let hit = 0;
    for (const part of a) if (b.has(part)) hit += 1;
    return hit / Math.min(a.size, b.size);
  };
  const queries = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const personIds = personOfMessage.get(String(message._id)) || [];
    if (!personIds.length) continue;
    const targets = messages
      .slice(0, index)
      .filter(previous =>
        (personOfMessage.get(String(previous._id)) || []).some(id =>
          personIds.includes(id)
        )
      )
      .map(previous => String(previous._id));
    if (!targets.length) continue;
    queries.push({ message, personIds, targets });
  }
  const topicQueries = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const targets = messages
      .slice(0, index)
      .filter(previous => overlap(message.content, previous.content) >= 0.3)
      .map(previous => String(previous._id));
    if (!targets.length) continue;
    topicQueries.push({ message, personIds: [], targets });
  }
  const sampled = queries.slice(-8);
  const sampledTopics = topicQueries.slice(-8);
  const results = [];
  for (const item of sampled) {
    const retrieved = await retrieve.retrieveConversationMemoriesDetailed({
      query: String(item.message.content || ''),
      userId,
      limit: 10,
      createdBeforeTs: new Date(item.message.createdAt).getTime(),
    });
    const got = new Set(retrieved.items.map(entry => String(entry.sourceMessageId)));
    const hits = item.targets.filter(target => got.has(target));
    results.push({
      query: String(item.message.content || '').slice(0, 60),
      targets: item.targets.length,
      hits: hits.length,
      recall: item.targets.length
        ? Number((hits.length / item.targets.length).toFixed(3))
        : null,
      returned: retrieved.items.map(entry => ({
        sourceMessageId: entry.sourceMessageId,
        score: Number((entry.score || 0).toFixed(4)),
        memoryKind: entry.memoryKind,
        text: String(entry.content || '').slice(0, 40),
      })),
    });
  }
  const topicResults = [];
  for (const item of sampledTopics) {
    const retrieved = await retrieve.retrieveConversationMemoriesDetailed({
      query: String(item.message.content || ''),
      userId,
      limit: 10,
      createdBeforeTs: new Date(item.message.createdAt).getTime(),
    });
    const got = new Set(retrieved.items.map(entry => String(entry.sourceMessageId)));
    const hits = item.targets.filter(target => got.has(target));
    topicResults.push({
      query: String(item.message.content || '').slice(0, 60),
      targets: item.targets.length,
      hits: hits.length,
      recall: Number((hits.length / item.targets.length).toFixed(3)),
    });
  }
  const scored = results.filter(r => r.recall !== null);
  const scoredTopics = topicResults.filter(r => r.recall !== null);
  const summary = {
    runId,
    userId,
    db: dbName,
    userMessages: messages.length,
    knownPeople: people.length,
    anchorUnits: anchors.size,
    indexedUnits: indexed,
    personTaggedUnits: [...anchors.values()].filter(a => a.personId).length,
    queries: results,
    topicQueries: topicResults,
    recallAvg: scored.length
      ? Number(
          (
            scored.reduce((sum, r) => sum + r.recall, 0) / scored.length
          ).toFixed(3)
        )
      : null,
    topicRecallAvg: scoredTopics.length
      ? Number(
          (
            scoredTopics.reduce((sum, r) => sum + r.recall, 0) /
            scoredTopics.length
          ).toFixed(3)
        )
      : null,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, queries: undefined, out: outFile }, null, 2));
  await client.close();
}

main().catch(error => {
  console.error('RETRIEVAL_PROBE_FAILED', error.message);
  process.exit(1);
});
