#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('../apps/node/node_modules/mongodb');
const { EJSON } = require('../apps/node/node_modules/bson');
const dotenv = require('../apps/node/node_modules/dotenv');

const APPROVAL_ID = 'user-identity-profile-backfill-v1';
const apply = process.argv.includes('--apply');
const approvalId = readArgument('--approval-id=');
const rollbackPath = readArgument('--rollback=');

function readArgument(prefix) {
  return (
    process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ||
    ''
  );
}

function parseName(value) {
  const match = String(value || '').match(/^用户正式姓名是([\u4e00-\u9fa5A-Za-z·]{2,16})$/);
  return match?.[1] || '';
}

function deriveAliases(name) {
  if (!/^[\u4e00-\u9fa5]{3}$/.test(name)) return [];
  const given = name.slice(1);
  return [...new Set([given, `${given[0]}${given[0]}`, `${given[1]}${given[1]}`])];
}

async function buildPlan(db) {
  const facts = await db
    .collection('agent_profile_fact')
    .find({
      key: 'user.identity.real_name',
      status: 'active',
      polarity: { $ne: 'negative' },
    })
    .sort({ updatedAt: -1 })
    .toArray();
  const byUser = new Map();
  for (const fact of facts) {
    const name = parseName(fact.value);
    if (!name || !fact.userId) continue;
    const key = String(fact.userId);
    const values = byUser.get(key) || [];
    values.push({ fact, name });
    byUser.set(key, values);
  }

  const existing = await db
    .collection('user_identity_profile')
    .find({ userId: { $in: [...byUser.values()].map(rows => rows[0].fact.userId) } })
    .toArray();
  const existingByUser = new Map(existing.map(row => [String(row.userId), row]));
  const inserts = [];
  const conflicts = [];
  const skippedExisting = [];
  const now = new Date();

  for (const [userId, rows] of byUser) {
    const names = [...new Set(rows.map(row => row.name))];
    if (names.length !== 1) {
      conflicts.push({ userId, names, reason: 'multiple_active_names' });
      continue;
    }
    const current = existingByUser.get(userId);
    if (current) {
      if (current.realName !== names[0]) {
        conflicts.push({
          userId,
          names,
          existing: current.realName,
          reason: 'global_identity_conflict',
        });
      } else {
        skippedExisting.push(userId);
      }
      continue;
    }
    const source = rows[0].fact;
    inserts.push({
      _id: new ObjectId(),
      userId: source.userId,
      realName: names[0],
      formerNames: [],
      aliases: deriveAliases(names[0]),
      version: 'user_identity_v1',
      source: 'historical_backfill',
      sourceAgentId: source.agentId,
      sourceMessageId: source.sourceMessageId,
      sourceText: source.sourceText,
      createdAt: now,
      updatedAt: now,
    });
  }
  return {
    sourceFactCount: facts.length,
    usersWithFacts: byUser.size,
    inserts,
    conflicts,
    skippedExisting,
  };
}

async function rollback(db, file) {
  const backup = EJSON.parse(fs.readFileSync(file, 'utf8'));
  const result = await db.collection('user_identity_profile').deleteMany({
    _id: { $in: backup.insertedIds || [] },
    source: 'historical_backfill',
  });
  if (result.deletedCount !== (backup.insertedIds || []).length) {
    throw new Error(
      `Rollback mismatch ${result.deletedCount}/${(backup.insertedIds || []).length}`
    );
  }
  return { deleted: result.deletedCount };
}

async function main() {
  if ((apply || rollbackPath) && approvalId !== APPROVAL_ID) {
    throw new Error(`Mutation requires --approval-id=${APPROVAL_ID}`);
  }
  const repoRoot = path.resolve(__dirname, '..');
  const env = dotenv.parse(fs.readFileSync(path.join(repoRoot, '.env')));
  const dbName = env.MONGO_DB || 'tzl';
  const host = process.env.TZL_PROD_MONGO_HOST || env.MONGO_HOST || '127.0.0.1';
  const port = process.env.TZL_PROD_MONGO_PORT || env.MONGO_PORT || '27017';
  const authSource = env.MONGO_AUTH_SOURCE || 'admin';
  const uri = `mongodb://${encodeURIComponent(
    env.MONGO_USERNAME
  )}:${encodeURIComponent(env.MONGO_PASSWORD)}@${host}:${port}/${dbName}?authSource=${encodeURIComponent(
    authSource
  )}&directConnection=true`;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    if (rollbackPath) {
      console.log(
        EJSON.stringify(
          { mode: 'rollback', result: await rollback(db, rollbackPath) },
          null,
          2
        )
      );
      return;
    }
    const plan = await buildPlan(db);
    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      sourceFactCount: plan.sourceFactCount,
      usersWithFacts: plan.usersWithFacts,
      plannedInserts: plan.inserts.length,
      conflicts: plan.conflicts,
      skippedExisting: plan.skippedExisting.length,
    };
    if (!apply) {
      console.log(EJSON.stringify(summary, null, 2));
      return;
    }
    const evidenceRoot = path.join(repoRoot, 'release-evidence');
    fs.mkdirSync(evidenceRoot, { recursive: true });
    const backupPath = path.join(
      evidenceRoot,
      `${new Date().toISOString().replace(/[:.]/g, '-')}_user_identity_backfill.ejson`
    );
    fs.writeFileSync(
      backupPath,
      EJSON.stringify(
        {
          version: 1,
          approvalId: APPROVAL_ID,
          insertedIds: plan.inserts.map(row => row._id),
          summary,
        },
        null,
        2
      ),
      { flag: 'wx' }
    );
    if (plan.inserts.length) {
      await db.collection('user_identity_profile').insertMany(plan.inserts, {
        ordered: true,
      });
    }
    const verified = plan.inserts.length
      ? await db.collection('user_identity_profile').countDocuments({
          _id: { $in: plan.inserts.map(row => row._id) },
        })
      : 0;
    if (verified !== plan.inserts.length) {
      throw new Error(`Readback mismatch ${verified}/${plan.inserts.length}`);
    }
    console.log(
      EJSON.stringify({ ...summary, backupPath, verified }, null, 2)
    );
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
