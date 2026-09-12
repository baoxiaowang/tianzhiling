#!/usr/bin/env node
'use strict';
// Full source replay, not a scan of previously extracted facts. No chat is sent.
// Original messages/agent settings are read-only. Writes are account-checkpointed.
const fs = require('fs');
const { MongoClient, ObjectId, BSON } = require('mongodb');
const { createHash } = require('crypto');
const arg = (name, fallback) =>
  process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ||
  fallback;
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(k => [k, canonical(value[k])])
    );
  return value;
};
const equal = (a, b) =>
  JSON.stringify(canonical(BSON.EJSON.serialize(a, { relaxed: false }))) ===
  JSON.stringify(canonical(BSON.EJSON.serialize(b, { relaxed: false })));
const hydrate = d => (d ? { ...d, id: d._id } : null);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scope = (userId, until) => ({
  userId,
  role: 'user',
  status: 'sent',
  isArchived: { $ne: true },
  createdAt: { $lt: until },
});
const tables = [
  'user_known_person',
  'user_relative_profile',
  'person_temporal_assertion',
  'person_temporal_profile',
  'user_identity_profile',
  'agent_profile_fact',
  'user_relative_fact',
  'agent_memory_fact',
];
const keys = {
  user_known_person: ['userId', 'identityKey'],
  user_relative_profile: ['userId', 'personId'],
  person_temporal_assertion: ['userId', 'sourceMessageId', 'semanticKey'],
  person_temporal_profile: ['userId', 'subjectType', 'subjectId', 'eventType'],
  user_identity_profile: ['userId'],
  agent_profile_fact: ['userId', 'agentId', 'key'],
  agent_memory_fact: ['userId', 'agentId', 'key'],
};
function manual(name, d) {
  if (name === 'user_identity_profile')
    return d.source === 'settings' || !d.sourceMessageId;
  if (name === 'person_temporal_profile') return false;
  if (
    name === 'agent_profile_fact' &&
    String(d.key).startsWith('profile_source.')
  )
    return true;
  return !d.sourceMessageId;
}
function remap(value, ids) {
  if (value instanceof ObjectId) return ids.get(String(value)) || value;
  if (typeof value === 'string') {
    if (ids.has(value)) return String(ids.get(value));
    const parts = value.split(':');
    if (
      parts.length === 2 &&
      ['user', 'agent', 'relative'].includes(parts[0]) &&
      ids.has(parts[1])
    )
      return `${parts[0]}:${ids.get(parts[1])}`;
  }
  if (value instanceof Date || value === null || typeof value !== 'object')
    return value;
  if (Array.isArray(value)) return value.map(v => remap(v, ids));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, remap(v, ids)])
  );
}
function repository(db, name, readOnly = false) {
  const c = db.collection(name);
  const guard = () => {
    if (readOnly) throw new Error('REBUILD_ORIGINAL_READ_ONLY');
  };
  const order = o =>
    Object.fromEntries(
      Object.entries(o || {}).map(([k, v]) => [k, v === 'DESC' ? -1 : 1])
    );
  return {
    find: async o =>
      (
        await c
          .find(o.where || {})
          .sort(order(o.order))
          .limit(Math.min(o.take || 80, 256))
          .maxTimeMS(15000)
          .toArray()
      ).map(hydrate),
    findOne: async o =>
      hydrate(
        await c.findOne(o.where || {}, {
          sort: order(o.order),
          maxTimeMS: 15000,
        })
      ),
    updateOne: (...a) => {
      guard();
      return c.updateOne(...a);
    },
    insertOne: d => {
      guard();
      return c.insertOne(d);
    },
    save: async d => {
      guard();
      const { id, _id, ...rest } = d;
      const key = id || _id || new ObjectId();
      await c.updateOne({ _id: key }, { $set: rest }, { upsert: true });
      return { ...rest, id: key };
    },
  };
}
// Only audit fields are overlaid. Services cannot edit original text or settings.
function messageRepository(source, stage) {
  const read = repository(source, 'message', true);
  return {
    ...read,
    findOne: async o => {
      const m = await read.findOne(o);
      if (!m) return m;
      const a = await stage.collection('message_audit').findOne({ _id: m.id });
      const { memoryValueAudit, memoryValuePriorAudits, ...original } = m;
      return { ...original, ...a, id: m.id };
    },
    updateOne: async (q, u) => {
      if (!q._id) throw new Error('REBUILD_AUDIT_REQUIRES_MESSAGE_ID');
      for (const section of Object.values(u))
        for (const k of Object.keys(section))
          if (!k.startsWith('memoryValue') && !k.startsWith('memoryWrite'))
            throw new Error('REBUILD_AUDIT_FIELD_DENIED');
      return stage
        .collection('message_audit')
        .updateOne({ _id: q._id }, u, { upsert: true });
    },
    save: async () => {
      throw new Error('REBUILD_ORIGINAL_MESSAGE_SAVE_DENIED');
    },
  };
}
function services(source, stage, model) {
  const load = (file, symbol) =>
    new (require(`../dist/service/agents/${file}`)[symbol])();
  const memory = load('memory-value.service', 'MemoryValueService');
  const relative = load(
    'user-relative-profile.service',
    'UserRelativeProfileService'
  );
  const identity = load(
    'user-identity-memory.service',
    'UserIdentityMemoryService'
  );
  const temporal = load(
    'person-temporal-memory.service',
    'PersonTemporalMemoryService'
  );
  const messages = messageRepository(source, stage);
  relative.relativeProfileModel = repository(stage, 'user_relative_profile');
  relative.relativeFactModel = repository(stage, 'user_relative_fact');
  relative.knownPersonModel = repository(stage, 'user_known_person');
  identity.identityModel = repository(stage, 'user_identity_profile');
  identity.messageModel = messages;
  identity.knownPersonModel = relative.knownPersonModel;
  identity.userRelativeProfileService = relative;
  temporal.assertionModel = repository(stage, 'person_temporal_assertion');
  temporal.profileModel = repository(stage, 'person_temporal_profile');
  temporal.agentModel = repository(stage, 'agent');
  temporal.messageModel = messages;
  temporal.openAIService = model;
  memory.factModel = repository(stage, 'agent_profile_fact');
  memory.messageModel = messages;
  memory.agentModel = repository(stage, 'agent');
  memory.personModel = relative.knownPersonModel;
  memory.openAIService = model;
  memory.personTemporalMemoryService = temporal;
  memory.userRelativeProfileService = relative;
  memory.userIdentityMemoryService = identity;
  // A historical replay must never override a user-edited identity.
  const record = identity.recordApprovedUserIdentity.bind(identity);
  identity.recordApprovedUserIdentity = async (...args) => {
    const existing = await stage
      .collection('user_identity_profile')
      .findOne({ userId: args[0].userId });
    if (existing && manual('user_identity_profile', existing)) return;
    return record(...args);
  };
  return memory;
}
class Rebuild {
  constructor(source, stage, backup, runId, options = {}) {
    Object.assign(this, { source, stage, backup, runId, options });
    this.accounts = stage.collection('accounts');
    this.runs = stage.collection('runs');
    // 第二层（原文检索）的锚：线上写向量库，本地评测没有向量库，就把"本该入库的
    // 原话条目"记到镜像库里，用来核对"每句原话有没有被留下、有没有带人物标签"。
    this.anchorUnits = stage.collection('eval_anchor_unit');
  }

  /**
   * 本地替代向量库的记录器：接口与 MilvusService.indexConversationMessage 一致。
   * 只写本地镜像库，不写生产、不接触网络。
   */
  anchorRecorder() {
    const collection = this.anchorUnits;
    return {
      indexConversationMessage: async options => {
        const memoryId = options.memoryId || options.messageId;
        await collection.updateOne(
          { _id: memoryId },
          {
            $set: {
              sourceMessageId: String(
                options.sourceMessageId || options.messageId
              ),
              userId: String(options.userId || ''),
              personId: options.personId || '',
              memoryKind: options.memoryKind || 'raw_episode',
              searchableText: String(options.searchableText || '').slice(0, 2000),
              role: options.role || '',
              createdAt: options.createdAt || null,
            },
          },
          { upsert: true }
        );
        return true;
      },
    };
  }
  async init() {
    for (const name of [...tables, 'agent']) {
      if (!(await this.source.listCollections({ name }).hasNext())) continue;
      for (const index of await this.source
        .collection(name)
        .listIndexes()
        .toArray()) {
        if (index.name === '_id_') continue;
        const opts = {
          name: index.name,
          ...(index.unique ? { unique: true } : {}),
        };
        if (index.partialFilterExpression)
          opts.partialFilterExpression = index.partialFilterExpression;
        await this.stage.collection(name).createIndex(index.key, opts);
      }
    }
    await this.accounts.createIndex({ status: 1, _id: 1 });
    await this.stage.collection('message_audit').createIndex({ userId: 1 });
  }
  async plan() {
    let run = await this.runs.findOne({ _id: this.runId });
    if (!run) {
      const until = new Date();
      run = {
        _id: this.runId,
        until,
        since: new Date(+until - 30 * 864e5),
        activeDays: 30,
        status: 'planning',
        scanned: 0,
        accounts: 0,
        messages: 0,
      };
      await this.runs.insertOne(run);
    }
    if (run.activeDays !== 30) throw new Error('REBUILD_SCOPE_MISMATCH');
    if (run.status !== 'planning') return run;
    let last = run.userCursor;
    for (;;) {
      const page = await this.source
        .collection('user')
        .find(
          {
            status: { $ne: 'canceled' },
            ...(last ? { _id: { $gt: last } } : {}),
          },
          { projection: { _id: 1 } }
        )
        .sort({ _id: 1 })
        .limit(100)
        .toArray();
      if (!page.length) break;
      for (const u of page) {
        const q = scope(u._id, run.until);
        const hit = await this.source
          .collection('message')
          .findOne(
            { ...q, createdAt: { $gte: run.since, $lt: run.until } },
            { projection: { _id: 1 }, maxTimeMS: 10000 }
          );
        if (hit) {
          const total = await this.source
            .collection('message')
            .countDocuments(q, { maxTimeMS: 20000 });
          await this.accounts.updateOne(
            { _id: u._id },
            {
              $setOnInsert: {
                status: 'pending',
                total,
                processed: 0,
                createdAt: new Date(),
              },
            },
            { upsert: true }
          );
        }
      }
      last = page[page.length - 1]._id;
      await this.runs.updateOne(
        { _id: this.runId },
        { $set: { userCursor: last }, $inc: { scanned: page.length } }
      );
    }
    const counts = await this.accounts
      .aggregate([
        {
          $group: {
            _id: null,
            accounts: { $sum: 1 },
            messages: { $sum: '$total' },
          },
        },
      ])
      .toArray();
    await this.runs.updateOne(
      { _id: this.runId },
      {
        $set: {
          status: 'planned',
          ...(counts[0] && {
            accounts: counts[0].accounts,
            messages: counts[0].messages,
          }),
        },
      }
    );
    return this.runs.findOne({ _id: this.runId });
  }
  async seed(a) {
    const userId = a._id;
    // An interrupted snapshot resumes per document; primary collections are untouched.
    for (const name of [...tables, 'agent']) {
      const q = name === 'agent' ? { createdUserId: userId } : { userId };
      for await (const d of this.source
        .collection(name)
        .find(q)
        .batchSize(50)) {
        await this.backup
          .collection(name)
          .updateOne({ _id: d._id }, { $setOnInsert: d }, { upsert: true });
        if (name === 'agent' || manual(name, d))
          await this.stage
            .collection(name)
            .updateOne({ _id: d._id }, { $setOnInsert: d }, { upsert: true });
      }
    }
    await this.accounts.updateOne(
      { _id: userId },
      { $set: { status: 'replaying', snapshotAt: new Date() } }
    );
  }
  async pressure() {
    if (this.options.pressure) return this.options.pressure();
    if (
      !require('../dist/service/memory-resource-budget').memoryBudgetSnapshot()
        .allowed
    )
      return true;
    const pending = await this.source
      .collection('memory_pipeline_task')
      .findOne(
        { status: { $in: ['pending', 'processing'] } },
        { projection: { _id: 1 } }
      );
    const replies = await this.source
      .collection('conversation_reply_turn')
      .findOne(
        {
          status: { $in: ['collecting', 'generating', 'delivering'] },
          updatedAt: { $gt: new Date(Date.now() - 300000) },
        },
        { projection: { _id: 1 } }
      );
    return !!pending || !!replies;
  }
  async waitTurn() {
    while (await this.pressure()) {
      await this.runs.updateOne(
        { _id: this.runId },
        { $set: { waitingForLiveTraffic: true, heartbeatAt: new Date() } }
      );
      await sleep(10000);
      await this.checkRun();
    }
    await this.checkRun();
    await this.runs.updateOne(
      { _id: this.runId },
      { $set: { waitingForLiveTraffic: false, heartbeatAt: new Date() } }
    );
  }
  async checkRun() {
    const r = await this.runs.findOne({ _id: this.runId });
    if (r?.paused) throw new Error('REBUILD_PAUSED');
    if (r?.leaseOwner && r.leaseOwner !== this.owner)
      throw new Error('REBUILD_LEASE_LOST');
  }
  async replay(a, model) {
    const r = await this.runs.findOne({ _id: this.runId });
    const memory = services(this.source, this.stage, model);
    let cursor = a.messageCursor;
    const userId = a._id;
    // 批量大小必须与线上一致：线上记忆抽取走的是 processBatch（一次模型调用覆盖
    // 一批消息），逐条 process 既慢（每条一次调用）又测不到线上真实路径。
    const batchSize = Math.max(
      1,
      Number(process.env.REBUILD_BATCH_SIZE || 5)
    );
    for (;;) {
      await this.waitTurn();
      const q = scope(userId, r.historyUntil || r.until);
      if (cursor)
        q.$or = [
          { createdAt: { $gt: cursor.at } },
          { createdAt: cursor.at, _id: { $gt: cursor.id } },
        ];
      const raws = await this.source
        .collection('message')
        .find(q, { sort: { createdAt: 1, _id: 1 }, maxTimeMS: 15000 })
        .limit(batchSize)
        .toArray();
      if (!raws.length) break;

      const entries = [];
      let batchTarget = null;
      for (const raw of raws) {
        let target = await memory.agentModel.findOne({
          where: { _id: raw.agentId, createdUserId: userId },
        });
        if (target?.messengerOfAgentId)
          target = await memory.agentModel.findOne({
            where: { _id: target.messengerOfAgentId, createdUserId: userId },
          });
        if (!target) throw new Error('REBUILD_MISSING_OWNED_SUBJECT');
        // 同一批必须服务于同一位亲人，否则本批到此为止，余下留给下一轮。
        if (batchTarget && String(batchTarget.id) !== String(target.id)) break;
        batchTarget = target;
        const text = (
          raw.type === 'voice'
            ? raw.mediaTranscript || raw.content
            : raw.content || ''
        ).trim();
        // Never silently truncate a source and then claim a complete account rebuild.
        if (text.length > 6000)
          throw new Error('REBUILD_SOURCE_REQUIRES_CHUNKING');
        entries.push({ raw, text });
      }
      if (!entries.length) break;

      const usable = entries.filter(entry => entry.text);
      console.log(
        `REBUILD_BATCH begin messages=${entries.length} usable=${usable.length}`
      );
      if (usable.length > 1) {
        try {
          await memory.processBatch(
            usable.map(entry => hydrate(entry.raw)),
            usable.map(entry => entry.text),
            batchTarget,
            this.anchorRecorder()
          );
        } catch (error) {
          // 一条坏消息不该拖垮整批：退化为逐条，与线上失败回退一致。
          // 批量回退代价很大（一次批量变成 N 次单条调用），所以记一行日志便于统计。
          console.log(
            `REBUILD_BATCH_FALLBACK size=${usable.length} reason=${
              error instanceof Error ? error.message : String(error)
            }`
          );
          for (const entry of usable)
            await memory.process(
              hydrate(entry.raw),
              entry.text,
              batchTarget
            );
        }
      } else if (usable.length === 1) {
        const result = await memory.process(
          hydrate(usable[0].raw),
          usable[0].text,
          batchTarget
        );
        if (
          result.audit.status !== 'completed' ||
          result.audit.unresolvedSourceFactIds?.length
        )
          throw new Error('REBUILD_UNRESOLVED_AUDIT');
      }

      for (const entry of entries) {
        await this.stage.collection('message_audit').updateOne(
          { _id: entry.raw._id },
          {
            $set: {
              userId,
              sourceHash: createHash('sha256')
                .update(entry.text)
                .digest('hex'),
            },
          }
        );
      }
      const last = entries[entries.length - 1].raw;
      cursor = { at: last.createdAt, id: last._id };
      const mediaWithoutText = entries.filter(entry => !entry.text).length;
      await this.accounts.updateOne(
        { _id: userId },
        {
          $set: { messageCursor: cursor, updatedAt: new Date() },
          $inc: {
            processed: entries.length,
            ...(mediaWithoutText ? { mediaWithoutText } : {}),
          },
        }
      );
      await sleep(this.options.delayMs ?? 5000);
    }
    await this.accounts.updateOne(
      { _id: userId },
      { $set: { status: 'ready', replayedAt: new Date() } }
    );
  }
  async synthesize(a, model) {
    const {
      AgentProfileFactService,
      AGENT_PROFILE_MEMORY_SOURCE_CONFIG,
    } = require('../dist/service/agents/agent-profile-fact.service');
    const {
      AgentMemoryProfileService,
    } = require('../dist/service/agents/agent-memory-profile.service');
    const facts = new AgentProfileFactService();
    facts.factModel = repository(this.stage, 'agent_profile_fact');
    const profile = new AgentMemoryProfileService();
    profile.agentModel = repository(this.stage, 'agent');
    profile.agentProfileFactService = facts;
    profile.openAIService = model;
    const fields = Object.keys(AGENT_PROFILE_MEMORY_SOURCE_CONFIG);
    for await (const original of this.backup
      .collection('agent')
      .find({
        createdUserId: a._id,
        messengerOfAgentId: { $exists: false },
        isArchived: { $ne: true },
      })
      .batchSize(25)) {
      const agent = hydrate(
        await this.stage.collection('agent').findOne({ _id: original._id })
      );
      if (agent.memoryRebuildSynthesis === this.runId) continue;
      // Clear only the staging draft before generation: old automatic prose is not evidence.
      for (const field of fields) agent[field] = '';
      agent.memoryProfileFactSnapshot = [];
      await profile.runRefreshFromMemory({
        agent,
        userId: a._id,
        force: true,
        rethrow: true,
      });
      for (const field of fields) {
        const key = AGENT_PROFILE_MEMORY_SOURCE_CONFIG[field].key;
        const edited = await this.stage
          .collection('agent_profile_fact')
          .findOne({ userId: a._id, agentId: original._id, key });
        if (edited || (!original.memoryProfileGeneratedAt && original[field]))
          agent[field] = original[field];
      }
      const metadata = [
        'memoryProfileFactSnapshot',
        'memoryProfileVersion',
        'memoryProfileGeneratedAt',
        'memoryProfileGenerationCount',
      ];
      await this.stage.collection('agent').updateOne(
        { _id: original._id },
        {
          $set: {
            ...Object.fromEntries(fields.map(f => [f, agent[f] || ''])),
            ...Object.fromEntries(
              metadata
                .filter(k => agent[k] !== undefined)
                .map(k => [k, agent[k]])
            ),
            memoryRebuildSynthesis: this.runId,
          },
        }
      );
    }
  }
  async publish(a) {
    const userId = a._id;
    const run = await this.runs.findOne({ _id: this.runId });
    const newer = d =>
      d.updatedAt && d.updatedAt > (run.historyUntil || run.until);
    if (
      !(await this.source
        .collection('user')
        .findOne({ _id: userId, status: { $ne: 'canceled' } }))
    )
      throw new Error('REBUILD_ACCOUNT_CANCELED');
    const ids = new Map();
    // Resolve existing natural-key IDs before publishing cross-collection references.
    for (const name of tables) {
      for await (const raw of this.stage
        .collection(name)
        .find({ userId })
        .batchSize(50)) {
        const d = remap(raw, ids),
          fields = keys[name];
        if (!fields) continue;
        const natural = Object.fromEntries(fields.map(k => [k, d[k]]));
        const old = await this.source.collection(name).findOne(natural);
        if (old && String(old._id) !== String(d._id))
          ids.set(String(raw._id), old._id);
      }
    }
    const stats = { written: 0, preservedConcurrent: 0, removed: 0 };
    await this.accounts.updateOne(
      { _id: userId },
      { $set: { status: 'publishing' } }
    );
    for (const name of tables) {
      const c = this.source.collection(name);
      for await (const raw of this.stage
        .collection(name)
        .find({ userId })
        .batchSize(50)) {
        if (manual(name, raw)) continue;
        await this.waitTurn();
        const d = remap(raw, ids);
        const current = await c.findOne({ _id: d._id });
        if (current?.memoryRebuildRunId === this.runId) continue;
        const before = await this.backup
          .collection(name)
          .findOne({ _id: d._id });
        if (
          current &&
          (!before ||
            manual(name, current) ||
            newer(current) ||
            !equal(current, before))
        ) {
          stats.preservedConcurrent++;
          continue;
        }
        const next = {
          ...d,
          memoryRebuildRunId: this.runId,
          updatedAt: new Date(),
        };
        if (current) {
          const result = await c.replaceOne(
            {
              _id: current._id,
              $expr: { $eq: ['$$ROOT', { $literal: current }] },
            },
            next
          );
          if (result.modifiedCount !== 1)
            throw new Error('REBUILD_PUBLICATION_CAS_CONFLICT');
        } else {
          try {
            await c.insertOne(next);
          } catch (e) {
            if (e.code === 11000)
              throw new Error('REBUILD_PUBLICATION_INSERT_CONFLICT');
            throw e;
          }
        }
        stats.written++;
      }
    }
    // Only after new records exist: remove untouched, backed-up automatic records.
    // Mongo is standalone. Each CAS is journaled/resumable, not falsely advertised as a transaction.
    for (const name of tables) {
      const c = this.source.collection(name);
      for await (const before of this.backup
        .collection(name)
        .find({ userId })
        .batchSize(50)) {
        if (manual(name, before)) continue;
        const current = await c.findOne({ _id: before._id });
        if (
          !current ||
          current.memoryRebuildRunId === this.runId ||
          newer(current) ||
          !equal(current, before)
        )
          continue;
        const stagedId = [...ids].find(
          ([, v]) => String(v) === String(before._id)
        )?.[0];
        if (
          await this.stage
            .collection(name)
            .findOne({ _id: stagedId ? new ObjectId(stagedId) : before._id })
        )
          continue;
        const result = await c.deleteOne({
          _id: current._id,
          $expr: { $eq: ['$$ROOT', { $literal: current }] },
        });
        stats.removed += result.deletedCount;
      }
    }
    // Refresh only generated profile columns, never names, dates, nicknames or custom context.
    const profileFields = [
      'lifeExperience',
      'personalityTraits',
      'languageHabits',
      'hobbies',
      'sharedMemories',
      'memoryProfileFactSnapshot',
      'memoryProfileVersion',
      'memoryProfileGeneratedAt',
      'memoryProfileGenerationCount',
    ];
    for await (const d of this.stage
      .collection('agent')
      .find({ createdUserId: userId, memoryRebuildSynthesis: this.runId })
      .batchSize(25)) {
      const before = await this.backup
        .collection('agent')
        .findOne({ _id: d._id });
      const current = await this.source
        .collection('agent')
        .findOne({ _id: d._id, createdUserId: userId });
      if (!before || !current || !equal(current, before)) {
        stats.preservedConcurrent++;
        continue;
      }
      const patch = Object.fromEntries(
        profileFields.filter(k => d[k] !== undefined).map(k => [k, d[k]])
      );
      await this.source.collection('agent').updateOne(
        { _id: d._id, $expr: { $eq: ['$$ROOT', { $literal: current }] } },
        {
          $set: {
            ...patch,
            memoryRebuildRunId: this.runId,
            updatedAt: new Date(),
          },
        }
      );
    }
    for await (const audit of this.stage
      .collection('message_audit')
      .find({ userId })
      .batchSize(25)) {
      const original = await this.source
        .collection('message')
        .findOne({ _id: audit._id, userId, isArchived: { $ne: true } });
      if (
        !original ||
        original.memoryWriteCompletedAt > (run.historyUntil || run.until)
      )
        continue;
      const text = (
        original.type === 'voice'
          ? original.mediaTranscript || original.content
          : original.content || ''
      ).trim();
      if (createHash('sha256').update(text).digest('hex') !== audit.sourceHash)
        throw new Error('REBUILD_SOURCE_CHANGED');
      const patch = Object.fromEntries(
        Object.entries(remap(audit, ids)).filter(
          ([k]) => k.startsWith('memoryValue') || k.startsWith('memoryWrite')
        )
      );
      await this.source.collection('message').updateOne(
        {
          _id: original._id,
          $expr: { $eq: ['$$ROOT', { $literal: original }] },
        },
        { $set: { ...patch, memoryRebuildRunId: this.runId } }
      );
    }
    // Enqueue only accepted current facts through the existing serialized index worker.
    const sources = new Set();
    for await (const f of this.source
      .collection('agent_profile_fact')
      .find(
        { userId, status: 'active', memoryRebuildRunId: this.runId },
        { projection: { sourceMessageId: 1 } }
      )
      .batchSize(50)) {
      if (!f.sourceMessageId || sources.has(String(f.sourceMessageId)))
        continue;
      sources.add(String(f.sourceMessageId));
      const m = await this.source
        .collection('message')
        .findOne({ _id: f.sourceMessageId, userId });
      if (!m) throw new Error('REBUILD_EVIDENCE_MISSING');
      const now = new Date();
      await this.source.collection('memory_pipeline_task').updateOne(
        {
          messageId: m._id,
          kind: 'person_semantic_index',
          pipelineVersion: this.runId,
        },
        {
          $setOnInsert: {
            schemaVersion: 'memory_pipeline_task_v1',
            userId,
            agentId: m.agentId,
            conversationId: m.conversationId,
            sourceHash: createHash('sha256')
              .update(m.content || '')
              .digest('hex'),
            status: 'pending',
            attemptCount: 0,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
    await this.accounts.updateOne(
      { _id: userId },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          publication: stats,
        },
      }
    );
    return stats;
  }
  async run(model) {
    const initial = await this.runs.findOne({ _id: this.runId });
    if (initial?.activeDays !== 30) throw new Error('REBUILD_SCOPE_MISMATCH');
    if (!initial.historyUntil)
      await this.runs.updateOne(
        { _id: this.runId, historyUntil: { $exists: false } },
        { $set: { historyUntil: new Date() } }
      );
    this.owner = `${process.pid}:${new ObjectId()}`;
    const lease = await this.runs.updateOne(
      {
        _id: this.runId,
        status: { $in: ['planned', 'running'] },
        $or: [
          { leaseUntil: { $lt: new Date() } },
          { leaseUntil: { $exists: false } },
        ],
      },
      {
        $set: {
          leaseOwner: this.owner,
          leaseUntil: new Date(Date.now() + 120000),
          status: 'running',
        },
      }
    );
    if (lease.modifiedCount !== 1)
      throw new Error('REBUILD_RUN_NOT_READY_OR_ALREADY_RUNNING');
    const heartbeat = setInterval(
      () =>
        this.runs
          .updateOne(
            { _id: this.runId, leaseOwner: this.owner },
            {
              $set: {
                leaseUntil: new Date(Date.now() + 120000),
                heartbeatAt: new Date(),
              },
            }
          )
          .catch(() => {}),
      20000
    );
    let attempted = 0;
    try {
      for (;;) {
        if (attempted >= (this.options.accountLimit || Infinity)) break;
        await this.waitTurn();
        const a = await this.accounts.findOne(
          {
            status: { $in: ['pending', 'replaying', 'ready', 'publishing'] },
            ...(this.options.canaryUser
              ? { _id: new ObjectId(this.options.canaryUser) }
              : {}),
          },
          { sort: { _id: 1 } }
        );
        if (!a) break;
        attempted++;
        try {
          if (
            require('../dist/service/agents/memory-value-rollout').memoryValueModeForUser(
              a._id
            ) !== 'active'
          )
            throw new Error('REBUILD_ACCOUNT_NOT_ENABLED');
          if (
            !(await this.source
              .collection('user')
              .findOne({ _id: a._id, status: { $ne: 'canceled' } }))
          )
            throw new Error('REBUILD_ACCOUNT_CANCELED');
          if (a.status === 'pending') await this.seed(a);
          if (['pending', 'replaying'].includes(a.status))
            await this.replay(
              await this.accounts.findOne({ _id: a._id }),
              model
            );
          await this.synthesize(a, model);
          const result = await this.publish(a);
          console.log(
            JSON.stringify({
              event: 'account_completed',
              userId: String(a._id),
              ...result,
            })
          );
        } catch (e) {
          if (
            String(e.message).includes('REBUILD_PAUSED') ||
            String(e.message).includes('REBUILD_LEASE_LOST')
          )
            throw e;
          // Do not leak provider errors containing prompts or credentials to logs.
          const code =
            String(e.message || '').match(/^REBUILD_[A-Z_]+$/)?.[0] ||
            'REBUILD_ACCOUNT_ERROR';
          await this.accounts.updateOne(
            { _id: a._id },
            {
              $set: {
                status: 'blocked',
                errorCode: code,
                failedAt: new Date(),
              },
            }
          );
          console.log(
            JSON.stringify({
              event: 'account_blocked',
              userId: String(a._id),
              code,
            })
          );
        }
      }
      const blocked = await this.accounts.countDocuments({ status: 'blocked' });
      const remaining = await this.accounts.countDocuments({
        status: { $in: ['pending', 'replaying', 'ready', 'publishing'] },
      });
      await this.runs.updateOne(
        { _id: this.runId },
        {
          $set: {
            status: remaining
              ? 'planned'
              : blocked
              ? 'needs_attention'
              : 'completed',
            ...(!remaining ? { finishedAt: new Date() } : {}),
          },
        }
      );
    } finally {
      clearInterval(heartbeat);
      await this.runs.updateOne(
        { _id: this.runId, leaseOwner: this.owner },
        { $unset: { leaseOwner: '', leaseUntil: '' } }
      );
    }
  }
}
async function main() {
  process.umask(0o077);
  const runId = arg('run', '');
  if (!/^memory_rebuild_[a-z0-9_]{1,32}$/.test(runId))
    throw new Error('REBUILD_INVALID_RUN_ID');
  const mode = arg('mode', 'status');
  if (
    !['status', 'plan', 'run', 'export-scope', 'pause', 'resume'].includes(mode)
  )
    throw new Error('REBUILD_INVALID_MODE');
  if (
    ['plan', 'run', 'pause', 'resume'].includes(mode) &&
    arg('apply', 'no') !== 'yes'
  )
    throw new Error('REBUILD_APPLY_REQUIRED');
  const config = require('../dist/config/config.default').default;
  const m = config.typeorm.dataSource.default;
  const c = new MongoClient(
    `mongodb://${encodeURIComponent(m.username)}:${encodeURIComponent(
      m.password
    )}@${m.host}:${m.port}/${m.database}?authSource=${encodeURIComponent(
      m.authSource
    )}&directConnection=true`,
    { maxPoolSize: 2, serverSelectionTimeoutMS: 15000 }
  );
  await c.connect();
  try {
    const job = new Rebuild(
      c.db(m.database),
      c.db(runId),
      c.db(`${runId}_backup`),
      runId,
      {
        accountLimit: Number(arg('account-limit', '0')),
        canaryUser: arg('canary-user', ''),
      }
    );
    if (mode === 'plan') {
      await job.init();
      console.log(JSON.stringify(await job.plan()));
    } else if (mode === 'export-scope') {
      const r = await job.runs.findOne({ _id: runId });
      if (!r || r.status === 'planning')
        throw new Error('REBUILD_SCOPE_NOT_FROZEN');
      const users = [];
      for await (const a of job.accounts.find({}, { projection: { _id: 1 } }))
        users.push(String(a._id));
      const output = arg('output', '');
      if (!output) throw new Error('REBUILD_OUTPUT_REQUIRED');
      fs.writeFileSync(
        output,
        JSON.stringify({
          version: 1,
          runId,
          activeDays: r.activeDays,
          since: r.since,
          until: r.until,
          userIds: users,
        }),
        { mode: 0o600 }
      );
      console.log(
        JSON.stringify({
          accounts: users.length,
          bytes: fs.statSync(output).size,
        })
      );
    } else if (mode === 'run') {
      const {
        MemoryDecisionModelService,
      } = require('../dist/service/agents/memory-decision-model.service');
      const model = new MemoryDecisionModelService();
      model.providerConfig = config.openai;
      model.configureMemoryModel();
      if (
        new URL(model.openAIConfig.baseURL).hostname !==
          'dashscope.aliyuncs.com' ||
        model.openAIConfig.model !== 'qwen-plus'
      )
        throw new Error('REBUILD_UNAUTHORIZED_MODEL_DESTINATION');
      let callSeq = 0;
      const generate = model.generateText.bind(model);
      model.generateText = async options => {
        await job.waitTurn();
        const label = options.memoryReview
          ? 'review'
          : `extract${options.maxTokens || 0}`;
        const seq = (callSeq += 1);
        const t0 = Date.now();
        const out = await generate(options);
        console.log(
          `REBUILD_CALL seq=${seq} kind=${label} ms=${Date.now() - t0} tokens=${
            out.response?.usage?.total_tokens || 0
          }`
        );
        await job.runs.updateOne(
          { _id: runId },
          {
            $inc: {
              modelCalls: 1,
              modelTokens: out.response?.usage?.total_tokens || 0,
            },
          }
        );
        return out;
      };
      await job.run(model);
    } else if (mode === 'pause' || mode === 'resume')
      await job.runs.updateOne(
        { _id: runId },
        { $set: { paused: mode === 'pause' } }
      );
    else
      console.log(
        JSON.stringify({
          run: await job.runs.findOne({ _id: runId }),
          accounts: await job.accounts
            .aggregate([
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 },
                  messages: { $sum: '$processed' },
                },
              },
            ])
            .toArray(),
        })
      );
  } finally {
    await c.close();
  }
}
module.exports = {
  Rebuild,
  manual,
  remap,
  repository,
  messageRepository,
  services,
  scope,
  equal,
};
if (require.main === module)
  main().catch(e => {
    console.error(
      String(e.message).match(/^REBUILD_[A-Z_]+$/)?.[0] || 'REBUILD_FAILED'
    );
    process.exitCode = 1;
  });
