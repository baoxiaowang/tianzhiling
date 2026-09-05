#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const { MilvusClient } = require('@zilliz/milvus2-sdk-node');

const apply = process.argv.includes('--apply');
const sourceCollection =
  readArgument('--source=') || 'conversation_message_memory';
const targetCollection =
  readArgument('--target=') || 'conversation_message_memory_v2';
const batchSize = clamp(Number(readArgument('--batch-size=') || 250), 1, 1000);
const limitArgument = Number(readArgument('--limit=') || 0);
const limit =
  Number.isInteger(limitArgument) && limitArgument > 0 ? limitArgument : -1;
const timeoutMs = Number(process.env.NODE_MILVUS_TIMEOUT_MS || 30000);
const schemaVersion = 'conversation_message_memory_v2';
const embeddingModel = process.env.NODE_EMBEDDING_MODEL || '';

const sourceFields = [
  'id',
  'userId',
  'conversationId',
  'agentId',
  'role',
  'type',
  'searchableText',
  'createdAtTs',
  'vector',
];

function readArgument(prefix) {
  return (
    process.argv
      .find(value => value.startsWith(prefix))
      ?.slice(prefix.length) || ''
  );
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.floor(value)));
}

function assertSuccessful(label, response) {
  const status = response?.status || response;
  const code = status?.error_code;
  if (code !== undefined && code !== 0 && code !== 'Success') {
    throw new Error(`${label} failed: ${status?.reason || String(code)}`);
  }
  return response;
}

function rowCount(response) {
  return Number(
    response?.stats?.find(item => item.key === 'row_count')?.value || 0
  );
}

function normalizeString(value, maximumLength) {
  return String(value ?? '').slice(0, maximumLength);
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= 0
    ? Math.floor(timestamp)
    : Date.now();
}

function mapRow(row) {
  const searchableText = normalizeString(row.searchableText, 4096);
  const createdAtTs = normalizeTimestamp(row.createdAtTs);
  if (!row.id || !row.userId || !Array.isArray(row.vector)) {
    throw new Error(`source row is incomplete: ${String(row.id || 'unknown')}`);
  }
  return {
    id: normalizeString(row.id, 64),
    sourceMessageId: normalizeString(row.id, 64),
    userId: normalizeString(row.userId, 64),
    conversationId: normalizeString(row.conversationId, 64),
    agentId: normalizeString(row.agentId, 64),
    role: normalizeString(row.role, 16),
    type: normalizeString(row.type, 16),
    personId: '',
    memoryKind: 'raw_episode',
    status: 'active',
    schemaVersion,
    embeddingModel: normalizeString(embeddingModel, 128),
    embeddingVersion: 'legacy_migration_v1',
    sourceHash: crypto
      .createHash('sha256')
      .update(searchableText)
      .digest('hex'),
    searchableText,
    createdAtTs,
    updatedAtTs: createdAtTs,
    vector: row.vector,
  };
}

async function describeRequired(client, collectionName) {
  const exists = assertSuccessful(
    `has collection ${collectionName}`,
    await client.hasCollection({
      collection_name: collectionName,
      timeout: timeoutMs,
    })
  );
  if (!exists?.value)
    throw new Error(`collection ${collectionName} does not exist`);
  return assertSuccessful(
    `describe collection ${collectionName}`,
    await client.describeCollection({
      collection_name: collectionName,
      timeout: timeoutMs,
    })
  );
}

function vectorDimension(description) {
  return Number(
    description?.schema?.fields?.find(field => field.name === 'vector')?.dim ||
      0
  );
}

async function getRowCount(client, collectionName) {
  return rowCount(
    assertSuccessful(
      `statistics ${collectionName}`,
      await client.getCollectionStatistics({ collection_name: collectionName })
    )
  );
}

async function main() {
  const client = new MilvusClient({
    address: process.env.NODE_MILVUS_ADDRESS || 'standalone:19530',
    token: process.env.NODE_MILVUS_TOKEN || undefined,
    username: process.env.NODE_MILVUS_USERNAME || undefined,
    password: process.env.NODE_MILVUS_PASSWORD || undefined,
    database: process.env.NODE_MILVUS_DATABASE || undefined,
    timeout: timeoutMs,
    maxRetries: 0,
  });
  try {
    const health = await client.checkHealth();
    if (!health?.isHealthy) throw new Error('Milvus is unhealthy');
    const [sourceDescription, targetDescription] = await Promise.all([
      describeRequired(client, sourceCollection),
      describeRequired(client, targetCollection),
    ]);
    const sourceDimension = vectorDimension(sourceDescription);
    const targetDimension = vectorDimension(targetDescription);
    if (!sourceDimension || sourceDimension !== targetDimension) {
      throw new Error(
        `vector dimension mismatch: source=${sourceDimension}, target=${targetDimension}`
      );
    }
    const sourceCount = await getRowCount(client, sourceCollection);
    const targetCountBefore = await getRowCount(client, targetCollection);
    const requestedCount =
      limit > 0 ? Math.min(limit, sourceCount) : sourceCount;

    if (!apply) {
      console.log(
        JSON.stringify({
          mode: 'check',
          sourceCollection,
          targetCollection,
          sourceCount,
          targetCountBefore,
          requestedCount,
          vectorDimension: sourceDimension,
          ready: true,
        })
      );
      return;
    }

    await client.loadCollection({ collection_name: sourceCollection });
    let migrated = 0;
    let batchNumber = 0;
    const iterator = await client.queryIterator({
      collection_name: sourceCollection,
      expr: '',
      output_fields: sourceFields,
      batchSize,
      limit: requestedCount,
      consistency_level: 'Strong',
    });
    for await (const sourceRows of iterator) {
      if (!Array.isArray(sourceRows) || !sourceRows.length) continue;
      const remaining = requestedCount - migrated;
      const rows = sourceRows.slice(0, remaining).map(mapRow);
      assertSuccessful(
        `upsert batch ${batchNumber + 1}`,
        await client.upsert({ collection_name: targetCollection, data: rows })
      );
      migrated += rows.length;
      batchNumber += 1;
      console.log(
        JSON.stringify({
          event: 'batch',
          batchNumber,
          migrated,
          requestedCount,
        })
      );
      if (migrated >= requestedCount) break;
    }
    if (migrated !== requestedCount) {
      throw new Error(
        `migration incomplete: expected ${requestedCount}, got ${migrated}`
      );
    }
    assertSuccessful(
      'flush target',
      await client.flushSync({ collection_names: [targetCollection] })
    );
    await client.loadCollection({ collection_name: targetCollection });
    const targetCountAfter = await getRowCount(client, targetCollection);
    if (limit < 0 && targetCountAfter < sourceCount) {
      throw new Error(
        `target count is smaller than source: source=${sourceCount}, target=${targetCountAfter}`
      );
    }
    console.log(
      JSON.stringify({
        event: 'complete',
        mode: 'apply',
        sourceCollection,
        targetCollection,
        sourceCount,
        targetCountBefore,
        targetCountAfter,
        migrated,
        vectorDimension: sourceDimension,
      })
    );
  } finally {
    await client.closeConnection().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
