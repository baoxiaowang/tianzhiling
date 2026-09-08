#!/usr/bin/env node
'use strict';
// One-process, bounded tooling. Evaluation never mutates production.
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const { createHash } = require('crypto');
const dotenv = require('dotenv');
const arg = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ||
  fallback;
const mode = arg('mode', 'evaluate');
process.umask(0o077);
const envFile = arg('env-file', '');
if (envFile) {
  const values = dotenv.parse(fs.readFileSync(envFile));
  for (const [key, value] of Object.entries(values))
    if (process.env[key] === undefined) process.env[key] = value;
}
const config = require('../dist/config/config.default').default;
const {
  MemoryDecisionModelService,
} = require('../dist/service/agents/memory-decision-model.service');
const {
  MemoryValueService,
} = require('../dist/service/agents/memory-value.service');
const {
  memoryBudgetSnapshot,
} = require('../dist/service/memory-resource-budget');
const { MEMORY_VALUE_VERSION } = require('../dist/service/agents/memory-value');
const logger = { debug() {}, info() {}, warn() {}, error() {} };
const model = new MemoryDecisionModelService();
model.providerConfig = config.openai;
model.configureMemoryModel();
if (
  mode === 'evaluate-live' &&
  (new URL(model.openAIConfig.baseURL).hostname !== 'dashscope.aliyuncs.com' ||
    model.openAIConfig.model !== 'qwen-plus')
)
  throw new Error(
    'Live evaluation is authorized only for Qwen Plus at dashscope.aliyuncs.com'
  );
let tokens = 0,
  calls = 0;
const generate = model.generateText.bind(model);
model.generateText = async options => {
  const r = await generate(options);
  tokens += r.response?.usage?.total_tokens || 0;
  calls++;
  fs.appendFileSync(
    `${output}.raw.jsonl`,
    JSON.stringify({
      call: calls,
      model: r.response?.model,
      content: r.content,
    }) + '\n'
  );
  return r;
};
const service = new MemoryValueService();
service.openAIService = model;
const output = arg('output', `/tmp/memory-value-${mode}.json`);
const delay = ms => new Promise(r => setTimeout(r, ms));
const hydrate = d => (d ? { ...d, id: d._id } : null);
function repo(db, name) {
  const c = db.collection(name);
  const guardWrite = () => {
    if (mode !== 'backfill')
      throw new Error('Read-only evaluation cannot write production records');
  };
  return {
    find: async o =>
      (
        await c
          .find(o.where || {})
          .sort(
            o.order
              ? Object.fromEntries(
                  Object.entries(o.order).map(([k, v]) => [
                    k,
                    v === 'DESC' ? -1 : 1,
                  ])
                )
              : {}
          )
          .limit(o.take || 80)
          .maxTimeMS(20000)
          .toArray()
      ).map(hydrate),
    findOne: async o =>
      hydrate(
        await c.findOne(o.where || {}, {
          sort: o.order
            ? Object.fromEntries(
                Object.entries(o.order).map(([k, v]) => [
                  k,
                  v === 'DESC' ? -1 : 1,
                ])
              )
            : undefined,
        })
      ),
    updateOne: (...a) => {
      guardWrite();
      return c.updateOne(...a);
    },
    insertOne: d => {
      guardWrite();
      return c.insertOne(d);
    },
    save: async d => {
      guardWrite();
      const { id, _id, ...rest } = d;
      const key = id || _id || new ObjectId();
      await c.updateOne({ _id: key }, { $set: rest }, { upsert: true });
      return { ...rest, id: key };
    },
  };
}

async function connect() {
  const m = config.typeorm.dataSource.default;
  const host = arg('mongo-host', m.host),
    port = arg('mongo-port', m.port);
  const uri = `mongodb://${encodeURIComponent(m.username)}:${encodeURIComponent(
    m.password
  )}@${host}:${port}/${m.database}?authSource=${encodeURIComponent(
    m.authSource
  )}&directConnection=true`;
  const client = new MongoClient(uri, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  const db = client.db(m.database);
  service.factModel = repo(db, 'agent_profile_fact');
  service.messageModel = repo(db, 'message');
  service.agentModel = repo(db, 'agent');
  service.personModel = repo(db, 'user_known_person');
  return { db, client };
}

async function evaluate() {
  const uid = '665000000000000000000001',
    aid = '665000000000000000000002',
    mid = '665000000000000000000003';
  const cases = [
    {
      name: '骄傲不是职业',
      text: '你一直是妈妈的骄傲，可是现在你是我不敢提及的痛。',
      check: ds =>
        !ds.some(d => d.type === 'occupation' && d.retention !== 'discard'),
    },
    {
      name: '用户腰疼不属于儿子',
      text: '妈妈腰不好，现在腰疼犯了，好疼好疼。',
      check: ds =>
        ds.some(
          d => d.subjectRef === `user:${uid}` && d.retention === 'session'
        ) &&
        !ds.some(
          d =>
            d.subjectRef === `agent:${aid}` &&
            /腰/.test(d.value) &&
            d.retention !== 'discard'
        ),
    },
    {
      name: '愿望不能成为历史',
      text: '宝贝，今年收核桃你能来帮妈妈守着就好了。',
      check: ds =>
        !ds.some(d => d.retention !== 'discard' && d.timeKind === 'historical'),
    },
    {
      name: '明确离世年龄',
      text: '才18岁的你怎么忍心扔下我就走了啊。',
      check: ds =>
        ds.some(
          d =>
            d.subjectRef === `agent:${aid}` &&
            (d.type === 'age' || d.kind === 'temporal') &&
            d.retention !== 'discard'
        ),
    },
    {
      name: '相对离世时间',
      text: '我的宝贝，你离开妈妈一个月了。',
      check: ds =>
        ds.some(d => d.kind === 'temporal' && d.retention !== 'discard'),
    },
    {
      name: '往事有具体价值',
      text: '去年收核桃，妈妈守了一个多星期，都睡在车里。',
      check: ds =>
        ds.some(
          d =>
            d.kind === 'event' &&
            d.retention !== 'discard' &&
            d.value.includes('车')
        ),
    },
    {
      name: '短回答保留上下文',
      text: '在粮库。',
      history: [
        {
          id: '665000000000000000000000',
          role: 'assistant',
          content: '你说儿子毕业后工作过，他在哪里工作？',
        },
      ],
      check: ds =>
        ds.some(d => d.type === 'occupation' && d.retention !== 'discard'),
    },
    {
      name: '不能收录助手编造',
      text: '你别编了，我没说过。',
      history: [
        {
          id: '665000000000000000000000',
          role: 'assistant',
          content: '你儿子曾在粮库上班。',
        },
      ],
      check: ds =>
        !ds.some(d => d.type === 'occupation' && d.retention !== 'discard'),
    },
    {
      name: '混合问题不能丢事实',
      text: '你以前在粮库工作，还记得吗？',
      check: ds =>
        ds.some(d => d.type === 'occupation' && d.retention !== 'discard'),
    },
    {
      name: '普通问候',
      text: '早上好呀。',
      check: ds =>
        ds.every(d => d.retention === 'discard' || d.operation === 'noop'),
    },
    {
      name: '问答中的用户正式姓名',
      text: '赵浩帅',
      history: [
        {
          id: '665000000000000000000000',
          role: 'assistant',
          content: '你的正式姓名是什么？',
        },
      ],
      check: ds =>
        ds.some(
          d =>
            d.subjectRef === `user:${uid}` &&
            d.key === 'user.identity.real_name' &&
            d.identity?.realName === '赵浩帅'
        ),
    },
    {
      name: '昵称不能变正式姓名',
      text: '浩浩是小名，不是我的正式姓名，你这样叫我就好。',
      check: ds => !ds.some(d => d.identity?.realName === '浩浩'),
    },
  ];
  const reports = [];
  for (const c of cases) {
    const input = {
      currentMessageId: mid,
      conversationAgentRef: `agent:${aid}`,
      referenceAt: '2026-09-08T00:00:00Z',
      subjects: [
        { ref: `user:${uid}`, label: '讲述者，妈妈' },
        {
          ref: `agent:${aid}`,
          label: '逝去的儿子',
          relation: '用户的儿子，当前交谈亲人',
        },
      ],
      messages: [
        ...(c.history || []),
        { id: mid, role: 'user', content: c.text },
      ],
      existing: [],
    };
    const before = tokens;
    try {
      const proposal = await service.propose(input);
      reports.push({
        name: c.name,
        pass: c.check(
          proposal.decisions.filter(
            (d, i) =>
              !proposal.rejected.includes(i) &&
              d.certainty !== 'uncertain' &&
              !['noop', 'conflict'].includes(d.operation) &&
              (d.retention !== 'discard' || d.operation === 'archive')
          )
        ),
        tokens: tokens - before,
        proposal,
      });
    } catch (e) {
      reports.push({
        name: c.name,
        pass: false,
        error: String(e.message).slice(0, 200),
      });
      if (e.status === 401 || e.status === 403)
        throw new Error(
          'Memory provider authentication failed; stopped before further calls'
        );
    }
    fs.writeFileSync(
      output,
      JSON.stringify(
        { model: model.openAIConfig.model, tokens, calls, reports },
        null,
        2
      )
    );
    console.log(
      JSON.stringify({
        name: c.name,
        ...{ pass: reports.at(-1).pass },
        tokens: tokens - before,
      })
    );
  }
  console.log(
    JSON.stringify({
      total: reports.length,
      passed: reports.filter(r => r.pass).length,
      tokens,
      calls,
      output,
    })
  );
  if (reports.some(r => !r.pass)) process.exitCode = 1;
}

async function inspect(db) {
  const facts = await db
    .collection('agent_profile_fact')
    .find(
      { key: 'occupation.primary', value: /骄傲/ },
      {
        projection: {
          userId: 1,
          agentId: 1,
          sourceMessageId: 1,
          sourceText: 1,
          value: 1,
        },
      }
    )
    .limit(5)
    .maxTimeMS(20000)
    .toArray();
  const cases = [];
  for (const f of facts) {
    const messages = await db
      .collection('message')
      .find(
        {
          userId: f.userId,
          agentId: f.agentId,
          role: 'user',
          isArchived: { $ne: true },
        },
        {
          projection: {
            content: 1,
            createdAt: 1,
            userId: 1,
            agentId: 1,
            conversationId: 1,
            role: 1,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(12)
      .toArray();
    cases.push({ fact: f, messages });
  }
  const since = new Date(Date.now() - 90 * 86400000);
  const count = await db.collection('agent_profile_fact').countDocuments(
    {
      updatedAt: { $gte: since },
      status: { $in: ['active', 'candidate', 'conflicted'] },
      sourceMessageId: { $type: 'objectId' },
      'governance.version': { $ne: MEMORY_VALUE_VERSION },
    },
    { maxTimeMS: 20000 }
  );
  fs.writeFileSync(output, JSON.stringify({ count, cases }, null, 2));
  console.log(
    JSON.stringify({
      legacyFacts90d: count,
      screenshotMatches: cases.length,
      output,
    })
  );
}

async function evaluateLive(db) {
  // Keep production identifiers in a private local manifest, not in the release.
  const cohortPath = arg('cohort', '');
  if (!cohortPath)
    throw new Error(
      'Read-only live evaluation requires an explicitly approved cohort manifest'
    );
  const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
  if (
    !Array.isArray(cohort.factIds) ||
    cohort.factIds.length !== 5 ||
    new Set(cohort.factIds).size !== 5 ||
    cohort.factIds.some(id => !ObjectId.isValid(id))
  )
    throw new Error('Expected five distinct approved fact IDs');
  const approvedIds = cohort.factIds.map(id => new ObjectId(id));
  if (
    !Array.isArray(cohort.messageIds) ||
    cohort.messageIds.length !== 5 ||
    cohort.messageIds.some(id => !ObjectId.isValid(id)) ||
    !Array.isArray(cohort.sourceHashes) ||
    cohort.sourceHashes.length !== 5 ||
    cohort.sourceHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))
  )
    throw new Error(
      'Approved original message IDs and content hashes are required'
    );
  const facts = await db
    .collection('agent_profile_fact')
    .find({
      _id: { $in: approvedIds },
      key: 'occupation.primary',
      value: /骄傲/,
    })
    .limit(5)
    .maxTimeMS(20000)
    .toArray();
  if (facts.length !== approvedIds.length)
    throw new Error(
      'Approved evaluation cohort changed; do not substitute samples'
    );
  const reports = [];
  for (const f of facts) {
    const approvedIndex = cohort.factIds.indexOf(String(f._id));
    if (String(f.sourceMessageId) !== cohort.messageIds[approvedIndex])
      throw new Error(
        'Approved source message changed; do not substitute new raw chats'
      );
    const message = hydrate(
      await db
        .collection('message')
        .findOne({ _id: f.sourceMessageId, userId: f.userId })
    );
    const agent = hydrate(
      await db.collection('agent').findOne({ _id: f.agentId })
    );
    if (!message || !agent)
      throw new Error('An approved sample is no longer available');
    if (
      createHash('sha256')
        .update(message.content.slice(0, 6000))
        .digest('hex') !== cohort.sourceHashes[approvedIndex]
    )
      throw new Error(
        'Approved original content changed; stop before sending it'
      );
    const { input } = await service.buildInput(message, message.content, agent);
    if (!input.existing.some(x => x.id === String(f._id)))
      input.existing.push({
        id: String(f._id),
        subjectRef: `agent:${f.agentId}`,
        value: f.value,
        key: f.key,
        type: f.type,
        status: f.status,
        revision: 0,
        protected: false,
        sourceText: f.sourceText,
      });
    fs.appendFileSync(
      `${output}.inputs.jsonl`,
      JSON.stringify({ factId: String(f._id), input }) + '\n'
    );
    try {
      const proposal = await service.propose(input);
      const pass = proposal.decisions.some(
        (d, i) =>
          d.targetId === String(f._id) &&
          d.certainty !== 'uncertain' &&
          !proposal.rejected.includes(i) &&
          (d.operation === 'archive' ||
            (d.operation === 'replace' &&
              d.retention !== 'discard' &&
              d.type !== 'occupation' &&
              d.key !== f.key))
      );
      reports.push({
        messageId: String(message.id),
        factId: String(f._id),
        pass,
        proposal,
      });
    } catch (e) {
      reports.push({
        messageId: String(message.id),
        pass: false,
        error: String(e.message).slice(0, 200),
      });
    }
    console.log(
      JSON.stringify({
        messageId: String(message.id),
        pass: reports.at(-1).pass,
      })
    );
    fs.writeFileSync(
      output,
      JSON.stringify(
        { model: model.openAIConfig.model, tokens, calls, reports },
        null,
        2
      )
    );
  }
  if (!reports.length || reports.some(r => !r.pass)) process.exitCode = 1;
}

async function backfill(db) {
  if (arg('apply', '') !== 'yes')
    throw new Error('Backfill requires --apply=yes');
  const accountIds = (process.env.NODE_MEMORY_VALUE_USER_IDS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  if (
    process.env.NODE_MEMORY_VALUE_MODE !== 'active' ||
    !accountIds.length ||
    accountIds.some(id => !/^[a-f0-9]{24}$/i.test(id))
  )
    throw new Error(
      'Backfill requires active mode and explicit account IDs; no implicit full-account rollout'
    );
  const checkpoint = arg(
    'checkpoint',
    '/tmp/memory-value-backfill-checkpoint.json'
  );
  const runId = 'memory_value_backfill_20260908';
  const state = fs.existsSync(checkpoint)
    ? JSON.parse(fs.readFileSync(checkpoint, 'utf8'))
    : {
        version: runId,
        accountIds,
        cutoff: new Date(Date.now() - 90 * 86400000).toISOString(),
        until: new Date().toISOString(),
        cursor: null,
        scanned: 0,
        enqueued: 0,
        skipped: 0,
        state: 'running',
      };
  if (state.version !== runId) throw new Error('Checkpoint version mismatch');
  if (JSON.stringify(state.accountIds) !== JSON.stringify(accountIds))
    throw new Error(
      'Checkpoint account scope changed; use a separately authorized new run'
    );
  const save = () => {
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(`${checkpoint}.tmp`, JSON.stringify(state, null, 2));
    fs.renameSync(`${checkpoint}.tmp`, checkpoint);
  };
  const tasks = db.collection('memory_pipeline_task');
  let idle = 0;
  while (true) {
    if (fs.existsSync(`${checkpoint}.pause`)) {
      state.state = 'paused_by_operator';
      save();
      return;
    }
    const budget = memoryBudgetSnapshot();
    const outstanding = await tasks.countDocuments(
      { status: { $in: ['pending', 'processing'] } },
      { maxTimeMS: 10000 }
    );
    const failed = await tasks.countDocuments(
      { pipelineVersion: runId, status: 'failed' },
      { maxTimeMS: 10000 }
    );
    if (failed >= 3) {
      state.state = 'paused_failures';
      state.failed = failed;
      save();
      return;
    }
    if (!budget.allowed || outstanding >= 4) {
      state.state = budget.allowed ? 'waiting_live_queue' : 'waiting_memory';
      state.outstanding = outstanding;
      save();
      if (++idle % 6 === 0)
        console.log(
          JSON.stringify({
            state: state.state,
            outstanding,
            memoryAvailableMB: Math.round(budget.available / 1048576),
          })
        );
      await delay(10000);
      continue;
    }
    const where = {
      userId: { $in: accountIds.map(id => new ObjectId(id)) },
      updatedAt: { $gte: new Date(state.cutoff), $lte: new Date(state.until) },
      status: { $in: ['active', 'candidate', 'conflicted'] },
      sourceMessageId: { $type: 'objectId' },
      'governance.version': { $ne: MEMORY_VALUE_VERSION },
      ...(state.cursor ? { _id: { $gt: new ObjectId(state.cursor) } } : {}),
    };
    const batch = await db
      .collection('agent_profile_fact')
      .find(where, { projection: { userId: 1, sourceMessageId: 1 } })
      .sort({ _id: 1 })
      .limit(10)
      .maxTimeMS(20000)
      .toArray();
    if (!batch.length) {
      const remaining = await tasks.countDocuments({
        pipelineVersion: runId,
        status: { $nin: ['completed', 'skipped'] },
      });
      state.state = remaining ? 'draining' : 'auditing_results';
      state.remaining = remaining;
      save();
      if (!remaining) {
        state.results ||= {
          checked: 0,
          written: 0,
          noChange: 0,
          needsReview: 0,
          unverified: 0,
        };
        const completedTasks = await tasks
          .find(
            {
              pipelineVersion: runId,
              ...(state.auditCursor
                ? { _id: { $gt: new ObjectId(state.auditCursor) } }
                : {}),
            },
            { projection: { messageId: 1, status: 1 } }
          )
          .sort({ _id: 1 })
          .limit(50)
          .maxTimeMS(10000)
          .toArray();
        if (completedTasks.length) {
          const messages = await db
            .collection('message')
            .find(
              { _id: { $in: completedTasks.map(t => t.messageId) } },
              {
                projection: {
                  memoryWriteStatus: 1,
                  'memoryValueAudit.version': 1,
                  'memoryValueAudit.status': 1,
                  'memoryValueAudit.unresolvedSourceFactIds': 1,
                },
              }
            )
            .limit(50)
            .maxTimeMS(10000)
            .toArray();
          const byId = new Map(messages.map(m => [String(m._id), m]));
          for (const task of completedTasks) {
            const m = byId.get(String(task.messageId));
            state.results.checked++;
            if (
              m?.memoryValueAudit?.version !== MEMORY_VALUE_VERSION ||
              m?.memoryValueAudit?.status !== 'completed'
            )
              state.results.unverified++;
            else if (
              m.memoryWriteStatus === 'needs_review' ||
              m.memoryValueAudit.unresolvedSourceFactIds?.length
            )
              state.results.needsReview++;
            else if (m.memoryWriteStatus === 'written') state.results.written++;
            else state.results.noChange++;
          }
          state.auditCursor = String(completedTasks.at(-1)._id);
          save();
          await delay(1000);
          continue;
        }
        state.state =
          state.results.needsReview || state.results.unverified
            ? 'completed_with_review_required'
            : 'completed';
        save();
        console.log(JSON.stringify(state));
        return;
      }
      await delay(10000);
      continue;
    }
    state.state = 'running';
    // Admit only one task each cycle. Checkpoint advances only after durable insert.
    const f = batch[0];
    state.scanned++;
    const m = await db.collection('message').findOne({
      _id: f.sourceMessageId,
      userId: f.userId,
      role: 'user',
      status: 'sent',
      isArchived: { $ne: true },
    });
    const user = m
      ? await db
          .collection('user')
          .findOne(
            { _id: m.userId, accountStatus: { $ne: 'canceled' } },
            { projection: { _id: 1 } }
          )
      : null;
    if (
      m &&
      user &&
      m.content?.trim() &&
      m.memoryValueAudit?.status !== 'completed'
    ) {
      const now = new Date();
      const result = await tasks.updateOne(
        { messageId: m._id, kind: 'structured_memory', pipelineVersion: runId },
        {
          $setOnInsert: {
            schemaVersion: 'memory_pipeline_task_v1',
            pipelineVersion: runId,
            kind: 'structured_memory',
            status: 'pending',
            messageId: m._id,
            conversationId: m.conversationId,
            userId: m.userId,
            agentId: m.agentId,
            sourceHash: createHash('sha256').update(m.content).digest('hex'),
            attemptCount: 0,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount) state.enqueued++;
    } else state.skipped++;
    state.cursor = String(f._id);
    save();
    if (state.scanned % 20 === 0) console.log(JSON.stringify(state));
    await delay(3000);
  }
}

async function main() {
  if (mode === 'evaluate') return evaluate();
  const { db, client } = await connect();
  try {
    if (mode === 'inspect') await inspect(db);
    else if (mode === 'evaluate-live') await evaluateLive(db);
    else if (mode === 'backfill') await backfill(db);
    else throw new Error('Unsupported mode');
  } finally {
    await client.close();
  }
}
main().catch(e => {
  console.error(String(e.message).slice(0, 300));
  process.exitCode = 1;
});
