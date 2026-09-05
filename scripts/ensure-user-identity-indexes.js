#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('../apps/node/node_modules/mongodb');
const dotenv = require('../apps/node/node_modules/dotenv');

const APPROVAL_ID = 'user-identity-indexes-v4';
const apply = process.argv.includes('--apply');
const approvalId = readArgument('--approval-id=');
const planned = [
  {
    collection: 'user_identity_profile',
    key: { userId: 1 },
    options: {
      name: 'uniq_user_identity_profile_user',
      unique: true,
      background: true,
    },
  },
  {
    collection: 'user_known_person',
    key: { userId: 1, status: 1 },
    options: {
      name: 'idx_user_known_person_status',
      background: true,
    },
  },
  {
    collection: 'user_known_person',
    key: { userId: 1, identityKey: 1 },
    options: {
      name: 'uniq_user_known_person_identity',
      unique: true,
      background: true,
    },
  },
  {
    collection: 'user_relative_profile',
    key: { userId: 1, status: 1 },
    options: {
      name: 'idx_user_relative_profile_status',
      background: true,
    },
  },
  {
    collection: 'user_relative_profile',
    key: { userId: 1, personId: 1 },
    options: {
      name: 'uniq_user_relative_profile_person',
      unique: true,
      background: true,
    },
  },
  {
    collection: 'user_relative_fact',
    key: { userId: 1, personId: 1, status: 1, updatedAt: -1 },
    options: {
      name: 'idx_user_relative_fact_current',
      background: true,
    },
  },
  {
    collection: 'user_relative_fact',
    key: { userId: 1, personId: 1, domain: 1, key: 1, status: 1 },
    options: {
      name: 'idx_user_relative_fact_semantic_key',
      background: true,
    },
  },
  {
    collection: 'person_temporal_assertion',
    key: {
      userId: 1,
      subjectType: 1,
      subjectId: 1,
      eventType: 1,
      status: 1,
    },
    options: {
      name: 'idx_person_temporal_assertion_subject',
      background: true,
    },
  },
  {
    collection: 'person_temporal_assertion',
    key: { userId: 1, sourceMessageId: 1, semanticKey: 1 },
    options: {
      name: 'uniq_person_temporal_assertion_source',
      unique: true,
      background: true,
    },
  },
  {
    collection: 'person_temporal_profile',
    key: { userId: 1, subjectType: 1, subjectId: 1, eventType: 1 },
    options: {
      name: 'uniq_person_temporal_profile_subject_event',
      unique: true,
      background: true,
    },
  },
  {
    collection: 'person_temporal_profile',
    key: { userId: 1, eventType: 1, updatedAt: -1 },
    options: {
      name: 'idx_person_temporal_profile_event',
      background: true,
    },
  },
  {
    collection: 'message',
    key: {
      userId: 1,
      agentId: 1,
      temporalMemorySemanticHash: 1,
      temporalMemoryVersion: 1,
    },
    options: {
      name: 'idx_message_temporal_semantic_cache',
      background: true,
      partialFilterExpression: {
        temporalMemorySemanticHash: { $exists: true },
      },
    },
  },
];

function readArgument(prefix) {
  return (
    process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ||
    ''
  );
}

async function main() {
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', planned }, null, 2));
    return;
  }
  if (approvalId !== APPROVAL_ID) {
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
    const created = [];
    for (const index of planned) {
      const name = await db
        .collection(index.collection)
        .createIndex(index.key, index.options);
      created.push({ collection: index.collection, name });
    }
    const verified = {};
    for (const collection of [...new Set(planned.map(item => item.collection))]) {
      verified[collection] = (await db.collection(collection).indexes())
        .filter(index => planned.some(item => item.options.name === index.name))
        .map(index => index.name)
        .sort();
    }
    console.log(JSON.stringify({ mode: 'apply', created, verified }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
