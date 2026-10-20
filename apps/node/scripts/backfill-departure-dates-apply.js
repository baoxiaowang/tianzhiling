#!/usr/bin/env node
/**
 * 离世日期回填执行器（高置信候选）。
 *
 * 只处理 dry-run 输出里 confidence=high 且 kind in exact/day/milestone 的候选：
 * - exact: 写 person_temporal_assertion + person_temporal_profile + agent.deathDate
 * - day/milestone: 只写 assertion + profile 的 estimatedStart/End，不伪造精确日期
 *
 * 默认 dry-run；加 --execute 才写库。写库前生成备份和 manifest，可用
 * --rollback=<manifest> 回滚本次写入。
 */

const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');

const DAY_MS = 86_400_000;

function parseArgs(argv) {
  const args = {
    input: '/tmp/dryrun.json',
    execute: false,
    limit: 0,
    backup: '/tmp/tzl-departure-backfill-backup.json',
    manifest: '/tmp/tzl-departure-backfill-manifest.json',
    rollback: '',
  };
  for (const raw of argv.slice(2)) {
    if (raw === '--execute') args.execute = true;
    else if (raw.startsWith('--input=')) args.input = raw.slice(8);
    else if (raw.startsWith('--limit=')) args.limit = Number(raw.slice(8)) || 0;
    else if (raw.startsWith('--backup=')) args.backup = raw.slice(9);
    else if (raw.startsWith('--manifest=')) args.manifest = raw.slice(11);
    else if (raw.startsWith('--rollback=')) args.rollback = raw.slice(11);
  }
  return args;
}

function dateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return undefined;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

function dateKey(value) {
  const d = dateOnly(value);
  return d ? d.toISOString().slice(0, 10) : '';
}

function mongoOptionsFromEnv() {
  return {
    host: process.env.NODE_MONGO_HOST || 'tzl_mongo',
    port: Number(process.env.NODE_MONGO_PORT || 27017),
    database: process.env.NODE_MONGO_DB || 'tzl',
    authSource: process.env.NODE_MONGO_AUTH_SOURCE || 'admin',
    username: process.env.NODE_MONGO_USERNAME || 'admin',
    password: process.env.NODE_MONGO_PASSWORD || 'qwerasdf',
  };
}

async function connect() {
  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    return { client, db: client.db() };
  }
  const options = mongoOptionsFromEnv();
  const client = new MongoClient(`mongodb://${options.host}:${options.port}`, {
    auth: { username: options.username, password: options.password },
    authSource: options.authSource,
    directConnection: true,
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  return { client, db: client.db(options.database) };
}

function buildWritePlan(candidate) {
  if (candidate.confidence !== 'high') return { skip: 'not_high' };
  if (!['exact', 'day', 'milestone'].includes(candidate.kind)) {
    return { skip: `kind_${candidate.kind}` };
  }
  const agentId = candidate.agentId;
  const userId = candidate.userId;
  if (!agentId || !userId) return { skip: 'missing_ids' };
  if (!ObjectId.isValid(agentId) || !ObjectId.isValid(userId)) {
    return { skip: 'invalid_object_id' };
  }
  const messageAt = new Date(candidate.messageAt);
  if (!Number.isFinite(messageAt.getTime())) return { skip: 'invalid_message_at' };

  if (candidate.kind === 'exact') {
    const exact = dateOnly(candidate.exactDate);
    if (!exact) return { skip: 'invalid_exact_date' };
    if (exact.getTime() > messageAt.getTime() + 2 * DAY_MS) {
      return { skip: 'exact_after_message' };
    }
    if (exact.getUTCFullYear() < 1900 || exact.getTime() > Date.now()) {
      return { skip: 'exact_out_of_range' };
    }
    return {
      kind: 'exact',
      agentId,
      userId,
      exactDate: exact,
      normalizedStart: exact,
      normalizedEnd: exact,
      precision: 'exact_day',
      expressionKind: 'exact_date',
      resolutionCertainty: 'explicit_exact',
    };
  }

  const start = dateOnly(candidate.estimatedStart);
  const end = dateOnly(candidate.estimatedEnd);
  if (!start || !end) return { skip: 'invalid_range' };
  if (start.getTime() > end.getTime()) return { skip: 'start_after_end' };
  if (end.getTime() > Date.now() + 2 * DAY_MS) {
    return { skip: 'range_after_now' };
  }
  if (start.getUTCFullYear() < 1900) return { skip: 'range_out_of_range' };
  return {
    kind: candidate.kind,
    agentId,
    userId,
    normalizedStart: start,
    normalizedEnd: end,
    precision: candidate.kind === 'milestone' ? 'ritual_range' : 'approximate_duration',
    expressionKind:
      candidate.kind === 'milestone' ? 'ritual_milestone' : 'relative_duration',
    resolutionCertainty: 'estimated_range',
  };
}

function buildAssertion(plan, candidate, now, assertionId) {
  const exact = plan.kind === 'exact';
  return {
    _id: assertionId,
    userId: new ObjectId(plan.userId),
    subjectType: 'agent',
    subjectId: new ObjectId(plan.agentId),
    eventType: 'death',
    expressionKind: plan.expressionKind,
    calendar: 'gregorian',
    rawText: String(candidate.snippet || '').slice(0, 500),
    referenceAt: new Date(candidate.messageAt),
    numericValue: null,
    numericMin: null,
    numericMax: null,
    durationUnit: null,
    approximate: !exact,
    isCorrection: false,
    ritual: null,
    ritualNominalDay: null,
    normalizedExactDate: exact ? plan.exactDate : null,
    normalizedStart: plan.normalizedStart,
    normalizedEnd: plan.normalizedEnd,
    normalizedYear: exact
      ? plan.exactDate.getUTCFullYear()
      : plan.normalizedStart.getUTCFullYear(),
    normalizedMonth: exact ? plan.exactDate.getUTCMonth() + 1 : null,
    normalizedDay: exact ? plan.exactDate.getUTCDate() : null,
    precision: plan.precision,
    confidence: 'confirmed',
    resolutionCertainty: plan.resolutionCertainty,
    status: 'active',
    semanticKey: `backfill_departure_v1|${plan.agentId}|${
      exact
        ? dateKey(plan.exactDate)
        : `${dateKey(plan.normalizedStart)}_${dateKey(plan.normalizedEnd)}`
    }`,
    derivationRule: `departure_backfill_rule_v1:${candidate.kind}`,
    sourceAgentId: new ObjectId(plan.agentId),
    sourceMessageId: new ObjectId(candidate.messageId),
    createdAt: now,
    updatedAt: now,
  };
}

function buildProfile(plan, candidate, now, profileId, assertionId) {
  const exact = plan.kind === 'exact';
  return {
    _id: profileId,
    userId: new ObjectId(plan.userId),
    subjectType: 'agent',
    subjectId: new ObjectId(plan.agentId),
    eventType: 'death',
    bestAssertionId: assertionId,
    ...(exact ? { exactDate: plan.exactDate } : {}),
    estimatedStart: plan.normalizedStart,
    estimatedEnd: plan.normalizedEnd,
    normalizedYear: exact
      ? plan.exactDate.getUTCFullYear()
      : plan.normalizedStart.getUTCFullYear(),
    normalizedMonth: exact ? plan.exactDate.getUTCMonth() + 1 : null,
    normalizedDay: exact ? plan.exactDate.getUTCDate() : null,
    precision: plan.precision,
    calendar: 'gregorian',
    resolutionCertainty: plan.resolutionCertainty,
    conflictStatus: 'none',
    version: 'person_temporal_profile_v1',
    createdAt: now,
    updatedAt: now,
  };
}

async function writePlan(db, plan, now) {
  const agentId = new ObjectId(plan.agentId);
  const userId = new ObjectId(plan.userId);
  const assertionId = new ObjectId();
  const profileId = new ObjectId();
  const assertion = buildAssertion(plan, plan.candidate, now, assertionId);
  const profile = buildProfile(plan, plan.candidate, now, profileId, assertionId);

  await db.collection('person_temporal_assertion').insertOne(assertion);
  try {
    await db.collection('person_temporal_profile').insertOne(profile);
    if (plan.kind === 'exact') {
      await db.collection('agent').updateOne(
        { _id: agentId, createdUserId: userId },
        { $set: { deathDate: plan.exactDate, updatedAt: now } }
      );
    }
  } catch (error) {
    // 任一步失败时清掉已写入的 assertion/profile，避免留下半条记录。
    await db.collection('person_temporal_assertion').deleteOne({ _id: assertionId });
    await db.collection('person_temporal_profile').deleteOne({ _id: profileId });
    throw error;
  }
  return { assertionId, profileId };
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.rollback) {
    const manifest = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    const { client, db } = await connect();
    try {
      const assertionIds = manifest.written
        .map(item => item.assertionId)
        .filter(Boolean)
        .map(id => new ObjectId(id));
      const profileIds = manifest.written
        .map(item => item.profileId)
        .filter(Boolean)
        .map(id => new ObjectId(id));
      if (assertionIds.length) {
        await db.collection('person_temporal_assertion').deleteMany({ _id: { $in: assertionIds } });
      }
      if (profileIds.length) {
        await db.collection('person_temporal_profile').deleteMany({ _id: { $in: profileIds } });
      }
      for (const item of manifest.agents) {
        if (item.hadDeathDate) {
          await db.collection('agent').updateOne(
            { _id: new ObjectId(item.agentId) },
            { $set: { deathDate: new Date(item.previousDeathDate), updatedAt: new Date(item.previousUpdatedAt) } }
          );
        } else {
          await db.collection('agent').updateOne(
            { _id: new ObjectId(item.agentId) },
            { $unset: { deathDate: 1 }, $set: { updatedAt: new Date(item.previousUpdatedAt) } }
          );
        }
      }
      console.log(
        JSON.stringify(
          { rolledBack: true, assertionsDeleted: assertionIds.length, profilesDeleted: profileIds.length, agentsRestored: manifest.agents.length },
          null,
          2
        )
      );
    } finally {
      await client.close();
    }
    return;
  }

  const data = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const candidates = data.candidates || [];
  const filtered = candidates.filter(item => item.confidence === 'high');
  const { client, db } = await connect();
  try {
    const now = new Date();
    const plans = [];
    const skipped = {};
    for (const candidate of filtered) {
      const plan = buildWritePlan(candidate);
      if (plan.skip) {
        skipped[plan.skip] = (skipped[plan.skip] || 0) + 1;
        continue;
      }
      plan.candidate = candidate;
      const agent = await db.collection('agent').findOne(
        { _id: new ObjectId(plan.agentId), createdUserId: new ObjectId(plan.userId) },
        { projection: { deathDate: 1, updatedAt: 1, departureDuration: 1, nodeReminder: 1 } }
      );
      if (!agent) {
        skipped.agent_not_found = (skipped.agent_not_found || 0) + 1;
        continue;
      }
      if (agent.deathDate) {
        skipped.agent_has_death = (skipped.agent_has_death || 0) + 1;
        continue;
      }
      const profile = await db.collection('person_temporal_profile').findOne({
        subjectType: 'agent',
        subjectId: new ObjectId(plan.agentId),
        eventType: 'death',
      });
      if (profile) {
        skipped.profile_exists = (skipped.profile_exists || 0) + 1;
        continue;
      }
      const semanticKey = `backfill_departure_v1|${plan.agentId}|${
        plan.kind === 'exact'
          ? dateKey(plan.exactDate)
          : `${dateKey(plan.normalizedStart)}_${dateKey(plan.normalizedEnd)}`
      }`;
      const assertion = await db.collection('person_temporal_assertion').findOne({
        userId: new ObjectId(plan.userId),
        sourceMessageId: new ObjectId(plan.candidate.messageId),
        semanticKey,
      });
      if (assertion) {
        skipped.assertion_exists = (skipped.assertion_exists || 0) + 1;
        continue;
      }
      plan.agentBefore = {
        agentId: plan.agentId,
        hadDeathDate: Boolean(agent.deathDate),
        previousDeathDate: agent.deathDate ? agent.deathDate.toISOString() : null,
        previousUpdatedAt: agent.updatedAt
          ? agent.updatedAt.toISOString()
          : now.toISOString(),
      };
      plans.push(plan);
      if (args.limit > 0 && plans.length >= args.limit) break;
    }

    const counts = {
      inputHigh: filtered.length,
      selected: plans.length,
      exact: plans.filter(item => item.kind === 'exact').length,
      day: plans.filter(item => item.kind === 'day').length,
      milestone: plans.filter(item => item.kind === 'milestone').length,
      skipped,
    };
    console.log('[apply] plan', JSON.stringify(counts, null, 2));
    if (!args.execute) {
      console.log('[apply] dry-run only; add --execute to write');
      return;
    }

    const backup = {
      createdAt: now.toISOString(),
      input: args.input,
      agents: [],
      profiles: [],
      assertions: [],
    };
    for (const plan of plans) {
      const agent = await db.collection('agent').findOne({ _id: new ObjectId(plan.agentId) });
      if (agent) backup.agents.push(agent);
      const profile = await db.collection('person_temporal_profile').findOne({
        subjectType: 'agent',
        subjectId: new ObjectId(plan.agentId),
        eventType: 'death',
      });
      if (profile) backup.profiles.push(profile);
      const assertions = await db
        .collection('person_temporal_assertion')
        .find({ sourceMessageId: new ObjectId(plan.candidate.messageId) })
        .toArray();
      backup.assertions.push(...assertions);
    }
    fs.writeFileSync(args.backup, JSON.stringify(backup, null, 2), { mode: 0o600 });

    const manifest = {
      createdAt: now.toISOString(),
      input: args.input,
      backup: args.backup,
      written: [],
      agents: plans
        .filter(item => item.kind === 'exact')
        .map(item => item.agentBefore),
    };
    let failed = 0;
    for (const plan of plans) {
      try {
        const ids = await writePlan(db, plan, now);
        manifest.written.push({
          agentId: plan.agentId,
          userId: plan.userId,
          kind: plan.kind,
          exactDate: plan.exactDate ? dateKey(plan.exactDate) : undefined,
          estimatedStart: dateKey(plan.normalizedStart),
          estimatedEnd: dateKey(plan.normalizedEnd),
          assertionId: ids.assertionId.toString(),
          profileId: ids.profileId.toString(),
          messageId: plan.candidate.messageId,
        });
      } catch (error) {
        failed++;
        console.error('[apply] write failed', plan.agentId, error.message);
      }
    }
    fs.writeFileSync(args.manifest, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    console.log(
      '[apply] done',
      JSON.stringify(
        {
          written: manifest.written.length,
          failed,
          backup: args.backup,
          manifest: args.manifest,
        },
        null,
        2
      )
    );
  } finally {
    await client.close();
  }
}

run().catch(error => {
  console.error('[apply] fatal', error);
  process.exit(1);
});
