#!/usr/bin/env node

'use strict';

const { MilvusClient, RRFRanker } = require('@zilliz/milvus2-sdk-node');

const COLLECTION_NAME =
  process.env.NODE_MILVUS_COLLECTION_NAME || 'conversation_message_memory_v2';
const ADDRESS = process.env.NODE_MILVUS_ADDRESS || 'standalone:19530';
const TIMEOUT_MS = Number(process.env.NODE_MILVUS_TIMEOUT_MS || 15000);
const WRITE_CANARY_APPROVAL = 'milvus-production-canary-v1';
const writeCanary = process.argv.includes('--write-canary');
const approvalId = readArgument('--approval-id=');

const REQUIRED_FIELDS = [
  'id',
  'sourceMessageId',
  'userId',
  'conversationId',
  'agentId',
  'role',
  'type',
  'personId',
  'memoryKind',
  'status',
  'schemaVersion',
  'embeddingModel',
  'embeddingVersion',
  'sourceHash',
  'searchableText',
  'createdAtTs',
  'updatedAtTs',
  'vector',
  'sparseVector',
];

function readArgument(prefix) {
  return (
    process.argv
      .find(value => value.startsWith(prefix))
      ?.slice(prefix.length) || ''
  );
}

function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)),
      TIMEOUT_MS
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function assertSuccessful(label, response) {
  const status = response?.status || response;
  const code = status?.error_code;
  if (code !== undefined && code !== 0 && code !== 'Success') {
    throw new Error(`${label} failed: ${status?.reason || String(code)}`);
  }
  return response;
}

function escapeFilterValue(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function resolveVectorDimension(description) {
  const vectorField = description?.schema?.fields?.find(
    field => field.name === 'vector'
  );
  const dimension = Number(vectorField?.dim || 0);
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error('collection vector dimension is missing or invalid');
  }
  return dimension;
}

function assertCollectionContract(description) {
  const schemaFields = description?.schema?.fields || [];
  const fields = new Set(schemaFields.map(field => field.name));
  const missingFields = REQUIRED_FIELDS.filter(field => !fields.has(field));
  if (missingFields.length) {
    throw new Error(`collection fields missing: ${missingFields.join(',')}`);
  }

  const functions = new Set(
    (description?.schema?.functions || []).map(func => func.name)
  );
  if (!functions.has('searchableTextBm25')) {
    throw new Error('collection BM25 function searchableTextBm25 is missing');
  }
  const userField = schemaFields.find(field => field.name === 'userId');
  if (!userField?.is_partition_key) {
    throw new Error('collection userId is not the partition key');
  }
  const textField = schemaFields.find(field => field.name === 'searchableText');
  if (!textField?.enable_analyzer || !textField?.enable_match) {
    throw new Error('collection searchableText analyzer or match is disabled');
  }
}

async function runWriteCanary(client, vectorDimension) {
  if (approvalId !== WRITE_CANARY_APPROVAL) {
    throw new Error(
      `write canary requires --approval-id=${WRITE_CANARY_APPROVAL}`
    );
  }

  const canaryId = `__tzl_milvus_canary_${Date.now()}_${process.pid}`;
  const vector = new Array(vectorDimension).fill(0);
  vector[0] = 1;
  let inserted = false;

  try {
    assertSuccessful(
      'canary upsert',
      await withTimeout(
        client.upsert({
          collection_name: COLLECTION_NAME,
          data: [
            {
              id: canaryId,
              sourceMessageId: canaryId,
              userId: '__tzl_system_canary__',
              conversationId: '__tzl_system_canary__',
              agentId: '',
              role: 'user',
              type: 'text',
              personId: '',
              memoryKind: 'acceptance_canary',
              status: 'active',
              schemaVersion: 'conversation_message_memory_v2',
              embeddingModel: 'deterministic-canary',
              embeddingVersion: 'acceptance-v1',
              sourceHash: canaryId
                .replace('__tzl_milvus_canary_', '')
                .padEnd(64, '0')
                .slice(0, 64),
              searchableText: '天之灵 Milvus 生产读写检索验收',
              createdAtTs: Date.now(),
              updatedAtTs: Date.now(),
              vector,
            },
          ],
        }),
        'canary upsert'
      )
    );
    inserted = true;

    assertSuccessful(
      'canary flush',
      await withTimeout(
        client.flushSync({ collection_names: [COLLECTION_NAME] }),
        'canary flush'
      )
    );
    await withTimeout(
      client.loadCollection({ collection_name: COLLECTION_NAME }),
      'canary load collection'
    );

    const readback = assertSuccessful(
      'canary readback',
      await withTimeout(
        client.get({
          collection_name: COLLECTION_NAME,
          ids: [canaryId],
          output_fields: ['id', 'searchableText'],
          consistency_level: 'Strong',
        }),
        'canary readback'
      )
    );
    if (!readback?.data?.some(row => row.id === canaryId)) {
      throw new Error('canary readback did not return the inserted row');
    }

    const search = assertSuccessful(
      'canary hybrid search',
      await withTimeout(
        client.hybridSearch({
          collection_name: COLLECTION_NAME,
          data: [
            {
              anns_field: 'vector',
              data: [vector],
              params: { ef: 64 },
            },
            {
              anns_field: 'sparseVector',
              data: '天之灵 Milvus 生产读写检索验收',
              params: { drop_ratio_search: 0.2 },
            },
          ],
          limit: 1,
          filter: `id == "${escapeFilterValue(canaryId)}"`,
          output_fields: ['id', 'searchableText'],
          rerank: RRFRanker(60),
          consistency_level: 'Strong',
        }),
        'canary hybrid search'
      )
    );
    if (!search?.results?.some(row => row.id === canaryId)) {
      throw new Error('canary hybrid search did not return the inserted row');
    }

    return { write: 'ok', readback: 'ok', hybridSearch: 'ok' };
  } finally {
    if (inserted) {
      assertSuccessful(
        'canary cleanup',
        await withTimeout(
          client.delete({
            collection_name: COLLECTION_NAME,
            ids: [canaryId],
            consistency_level: 'Strong',
          }),
          'canary cleanup'
        )
      );
      assertSuccessful(
        'canary cleanup flush',
        await withTimeout(
          client.flushSync({ collection_names: [COLLECTION_NAME] }),
          'canary cleanup flush'
        )
      );
    }
  }
}

async function main() {
  const client = new MilvusClient({
    address: ADDRESS,
    token: process.env.NODE_MILVUS_TOKEN || undefined,
    username: process.env.NODE_MILVUS_USERNAME || undefined,
    password: process.env.NODE_MILVUS_PASSWORD || undefined,
    database: process.env.NODE_MILVUS_DATABASE || undefined,
    timeout: TIMEOUT_MS,
    maxRetries: 0,
  });

  try {
    const health = await withTimeout(client.checkHealth(), 'health check');
    if (!health?.isHealthy) {
      throw new Error(`Milvus unhealthy: ${(health?.reasons || []).join(',')}`);
    }

    const version = await withTimeout(client.getVersion(), 'version check');
    const exists = assertSuccessful(
      'has collection',
      await withTimeout(
        client.hasCollection({ collection_name: COLLECTION_NAME }),
        'has collection'
      )
    );
    if (!exists?.value) {
      throw new Error(`required collection ${COLLECTION_NAME} does not exist`);
    }

    const description = assertSuccessful(
      'describe collection',
      await withTimeout(
        client.describeCollection({ collection_name: COLLECTION_NAME }),
        'describe collection'
      )
    );
    assertCollectionContract(description);
    const vectorDimension = resolveVectorDimension(description);

    const loadState = assertSuccessful(
      'load state',
      await withTimeout(
        client.getLoadState({ collection_name: COLLECTION_NAME }),
        'load state'
      )
    );
    const statistics = assertSuccessful(
      'collection statistics',
      await withTimeout(
        client.getCollectionStatistics({ collection_name: COLLECTION_NAME }),
        'collection statistics'
      )
    );
    const denseIndex = assertSuccessful(
      'dense index',
      await withTimeout(
        client.describeIndex({
          collection_name: COLLECTION_NAME,
          field_name: 'vector',
        }),
        'dense index'
      )
    );
    const sparseIndex = assertSuccessful(
      'sparse index',
      await withTimeout(
        client.describeIndex({
          collection_name: COLLECTION_NAME,
          field_name: 'sparseVector',
        }),
        'sparse index'
      )
    );

    const result = {
      mode: writeCanary ? 'write-canary' : 'read-only',
      address: ADDRESS,
      version: version?.version || 'unknown',
      healthy: true,
      collection: COLLECTION_NAME,
      vectorDimension,
      loadState: loadState?.state,
      rowCount:
        statistics?.stats?.find(item => item.key === 'row_count')?.value ||
        'unknown',
      denseIndexCount: denseIndex?.index_descriptions?.length || 0,
      sparseIndexCount: sparseIndex?.index_descriptions?.length || 0,
    };

    if (writeCanary) {
      result.canary = await runWriteCanary(client, vectorDimension);
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.closeConnection().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
