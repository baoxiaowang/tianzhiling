'use strict';
// 本地运行：导出某个用户本轮的真实消息与记忆结果，供独立评测代理判定。
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const userId = process.argv[2];
const runId = process.argv[3] || '';
if (!userId) {
  console.error('DUMP_ERR=no_user_id');
  process.exit(1);
}
const dbName = process.env.MIRROR_DB || 'tzl_mirror';
const host = process.env.MIRROR_MONGO_HOST || process.env.NODE_MONGO_HOST || '127.0.0.1';
const port = process.env.MIRROR_MONGO_PORT || process.env.NODE_MONGO_PORT || '17271';
const username = process.env.NODE_MONGO_USERNAME || 'admin';
const password = process.env.NODE_MONGO_PASSWORD || 'qwerasdf';
const authSource = process.env.NODE_MONGO_AUTH_SOURCE || 'admin';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('DUMP_GUARD_HOST:' + host);
}
if (!/^tzl_mirror/.test(dbName)) {
  throw new Error('DUMP_GUARD_DB:' + dbName);
}
const uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(
  password
)}@${host}:${port}/${dbName}?authSource=${authSource}`;

(async () => {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  const u = new ObjectId(userId);
  const [messages, facts, known, temporal, identity] = await Promise.all([
    db
      .collection('message')
      .find({ userId: u, role: 'user', isArchived: { $ne: true } })
      .sort({ createdAt: 1 })
      .toArray(),
    db.collection('agent_profile_fact').find({ userId: u }).toArray(),
    db.collection('user_known_person').find({ userId: u }).toArray(),
    db.collection('person_temporal_assertion').find({ userId: u }).toArray(),
    db.collection('user_identity_profile').find({ userId: u }).toArray(),
  ]);
  const out = {
    userId,
    runId,
    dumpedAt: new Date().toISOString(),
    messages: messages.map(m => ({
      id: String(m._id),
      at: m.createdAt,
      content: m.content,
    })),
    facts: facts.map(f => ({
      key: f.key,
      type: f.type,
      value: f.value,
      status: f.status,
      policy: f.assertionPolicy,
      subject: f.governance && f.governance.subjectRef,
      retention: f.governance && f.governance.retention,
      certainty: f.governance && f.governance.certainty,
      timeKind: f.governance && f.governance.timeKind,
      evidence: ((f.governance && f.governance.evidence) || []).map(e => e.quote),
    })),
    knownPeople: known.map(p => ({
      realName: p.realName,
      preferredName: p.preferredName,
      relationToUser: p.relationToUser,
      identityKey: p.identityKey,
    })),
    temporalAssertions: temporal.map(a => ({
      eventType: a.eventType,
      rawText: a.rawText,
      status: a.status,
    })),
    identityProfiles: identity.map(i => ({
      realName: i.realName,
      aliases: i.aliases,
    })),
  };
  const outPath = path.resolve(
    __dirname,
    '../../../../.task-evidence/memory-eval/results-' + userId + '.json'
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    `DUMP_OK messages=${out.messages.length} facts=${out.facts.length} known=${out.knownPeople.length} temporal=${out.temporalAssertions.length} path=${outPath}`
  );
  await client.close();
})().catch(error => {
  console.error('DUMP_ERR=' + error.message);
  process.exit(1);
});
