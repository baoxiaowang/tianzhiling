#!/usr/bin/env node

'use strict';

const {
  DataType,
  FunctionType,
  IndexType,
  MetricType,
  MilvusClient,
} = require('@zilliz/milvus2-sdk-node');

const mode = process.argv.includes('--apply') ? 'apply' : 'check';
const targetCollection =
  readArgument('--collection=') || 'conversation_message_memory_v2';
const sourceCollection =
  readArgument('--source=') ||
  process.env.NODE_MILVUS_COLLECTION_NAME ||
  'conversation_message_memory';
const analyzer = readArgument('--analyzer=') || 'chinese';
const timeoutMs = Number(process.env.NODE_MILVUS_TIMEOUT_MS || 15000);
const requiredFields = [
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
    process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) ||
    ''
  );
}

function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
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

function resolveDimension(description) {
  const field = description?.schema?.fields?.find(item => item.name === 'vector');
  const dimension = Number(field?.dim || 0);
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error(`vector dimension is invalid in ${sourceCollection}`);
  }
  return dimension;
}

function assertContract(description) {
  const fields = description?.schema?.fields || [];
  const names = new Set(fields.map(field => field.name));
  const missing = requiredFields.filter(field => !names.has(field));
  if (missing.length) throw new Error(`v2 fields missing: ${missing.join(',')}`);
  const userField = fields.find(field => field.name === 'userId');
  if (!userField?.is_partition_key) {
    throw new Error('v2 userId is not the partition key');
  }
  const textField = fields.find(field => field.name === 'searchableText');
  if (!textField?.enable_analyzer) {
    throw new Error('v2 searchableText analyzer is disabled');
  }
  const analyzerParams =
    typeof textField.analyzer_params === 'string'
      ? JSON.parse(textField.analyzer_params)
      : textField.analyzer_params;
  if (analyzerParams?.type !== analyzer) {
    throw new Error(
      `v2 searchableText analyzer mismatch: expected ${analyzer}, got ${
        analyzerParams?.type || 'missing'
      }`
    );
  }
  const functions = description?.schema?.functions || [];
  if (!functions.some(func => func.name === 'searchableTextBm25')) {
    throw new Error('v2 BM25 function searchableTextBm25 is missing');
  }
}

async function describeRequired(client, collectionName) {
  const exists = assertSuccessful(
    'has collection',
    await withTimeout(
      client.hasCollection({ collection_name: collectionName, timeout: timeoutMs }),
      `has collection ${collectionName}`
    )
  );
  if (!exists?.value) return null;
  return assertSuccessful(
    'describe collection',
    await withTimeout(
      client.describeCollection({
        collection_name: collectionName,
        timeout: timeoutMs,
      }),
      `describe collection ${collectionName}`
    )
  );
}

async function main() {
  if (!['check', 'apply'].includes(mode)) throw new Error('invalid mode');
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
    const health = await withTimeout(client.checkHealth(), 'health check');
    if (!health?.isHealthy) throw new Error('Milvus is unhealthy');
    let description = await describeRequired(client, targetCollection);
    let action = 'existing';
    if (!description) {
      if (mode !== 'apply') {
        throw new Error(
          `v2 collection ${targetCollection} is missing; rerun with --apply`
        );
      }
      const source = await describeRequired(client, sourceCollection);
      if (!source) throw new Error(`source collection ${sourceCollection} is missing`);
      const dimension = resolveDimension(source);
      assertSuccessful(
        'create v2 collection',
        await withTimeout(
          client.createCollection({
            collection_name: targetCollection,
            timeout: timeoutMs,
            fields: [
              { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
              { name: 'userId', data_type: DataType.VarChar, max_length: 64, is_partition_key: true },
              { name: 'sourceMessageId', data_type: DataType.VarChar, max_length: 64 },
              { name: 'conversationId', data_type: DataType.VarChar, max_length: 64 },
              { name: 'agentId', data_type: DataType.VarChar, max_length: 64 },
              { name: 'role', data_type: DataType.VarChar, max_length: 16 },
              { name: 'type', data_type: DataType.VarChar, max_length: 16 },
              { name: 'personId', data_type: DataType.VarChar, max_length: 64 },
              { name: 'memoryKind', data_type: DataType.VarChar, max_length: 32 },
              { name: 'status', data_type: DataType.VarChar, max_length: 16 },
              { name: 'schemaVersion', data_type: DataType.VarChar, max_length: 64 },
              { name: 'embeddingModel', data_type: DataType.VarChar, max_length: 128 },
              { name: 'embeddingVersion', data_type: DataType.VarChar, max_length: 160 },
              { name: 'sourceHash', data_type: DataType.VarChar, max_length: 64 },
              {
                name: 'searchableText',
                data_type: DataType.VarChar,
                max_length: 4096,
                enable_analyzer: true,
                enable_match: true,
                analyzer_params: { type: analyzer },
              },
              { name: 'createdAtTs', data_type: DataType.Int64 },
              { name: 'updatedAtTs', data_type: DataType.Int64 },
              { name: 'vector', data_type: DataType.FloatVector, dim: dimension },
              { name: 'sparseVector', data_type: DataType.SparseFloatVector, is_function_output: true },
            ],
            functions: [
              {
                name: 'searchableTextBm25',
                type: FunctionType.BM25,
                input_field_names: ['searchableText'],
                output_field_names: ['sparseVector'],
                params: {},
              },
            ],
            index_params: [
              {
                field_name: 'vector',
                index_type: IndexType.HNSW,
                metric_type: MetricType.COSINE,
                params: { M: 16, efConstruction: 256 },
              },
              {
                field_name: 'sparseVector',
                index_type: IndexType.SPARSE_INVERTED_INDEX,
                metric_type: MetricType.BM25,
                params: { inverted_index_algo: 'DAAT_MAXSCORE' },
              },
            ],
            enable_dynamic_field: false,
          }),
          'create v2 collection'
        )
      );
      action = 'created';
      description = await describeRequired(client, targetCollection);
    }
    assertContract(description);
    const dimension = resolveDimension(description);
    assertSuccessful(
      'load v2 collection',
      await withTimeout(
        client.loadCollection({
          collection_name: targetCollection,
          timeout: timeoutMs,
        }),
        'load v2 collection'
      )
    );
    const dense = assertSuccessful(
      'describe dense index',
      await withTimeout(
        client.describeIndex({ collection_name: targetCollection, field_name: 'vector' }),
        'describe dense index'
      )
    );
    const sparse = assertSuccessful(
      'describe sparse index',
      await withTimeout(
        client.describeIndex({ collection_name: targetCollection, field_name: 'sparseVector' }),
        'describe sparse index'
      )
    );
    const denseIndexes = (dense?.index_descriptions || []).filter(
      item => item.field_name === 'vector'
    );
    const sparseIndexes = (sparse?.index_descriptions || []).filter(
      item => item.field_name === 'sparseVector'
    );
    if (!denseIndexes.length || !sparseIndexes.length) {
      throw new Error('v2 dense or sparse index is missing');
    }
    const loadState = assertSuccessful(
      'get v2 load state',
      await withTimeout(
        client.getLoadState({ collection_name: targetCollection }),
        'get v2 load state'
      )
    );
    const statistics = assertSuccessful(
      'get v2 statistics',
      await withTimeout(
        client.getCollectionStatistics({ collection_name: targetCollection }),
        'get v2 statistics'
      )
    );
    console.log(
      JSON.stringify({
        mode,
        action,
        collection: targetCollection,
        sourceCollection,
        vectorDimension: dimension,
        analyzer,
        denseIndexCount: denseIndexes.length,
        sparseIndexCount: sparseIndexes.length,
        loadState: loadState?.state,
        rowCount:
          statistics?.stats?.find(item => item.key === 'row_count')?.value ||
          '0',
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
