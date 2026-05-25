require('ts-node/register');

const path = require('path');
const {
  closeMongoTransferConnection,
  closeMysqlTransferConnection,
  createMongoTransferContext,
  createMysqlTransferContext,
} = require('../runtime');
const {
  MIGRATION_NAMESPACE,
  createLegacyTableExporter,
  importBsonCollection,
  normalizeString,
  readEnv,
  readMode,
  readNumberEnv,
  resolveDumpPath,
} = require('./lib/migration');

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_IMPORT_BATCH_SIZE = 1000;
const DEFAULT_AGENT_STATUS = 1;
const AGENT_COLLECTION = 'agent';
const AGENT_FIELD_MAP = [
  [row => `agent:${normalizeLegacyId(row.agent_id, 'agent_id')}`, '_id', 'ObjectId'],
  ['create_user_id', 'createdUserId', 'ObjectId'],
  [
    'agent_name',
    'name',
    'string',
    (value, row) =>
      normalizeString(value) ||
      normalizeString(row.real_name) ||
      `智能体${normalizeLegacyId(row.agent_id, 'agent_id')}`,
  ],
  ['real_name', 'realName', 'string'],
  ['agent_img', 'avatar', 'string'],
  ['gender', 'sex', normalizeAgentSex],
  ['callme', 'agentCallMe', 'string'],
  ['relation', 'iCallAgent', 'string'],
  ['introduce_materials', 'description', 'string'],
  ['talent', 'hobbies', 'string'],
  [() => DEFAULT_AGENT_STATUS, 'status', 'number'],
  ['create_time', 'createdAt', 'date'],
  [() => new Date(), 'updatedAt', 'date'],
  ['born_time', 'birthday', 'optionalDate'],
  ['death_time', 'deathDate', 'optionalDate'],
  [() => MIGRATION_NAMESPACE, 'legacy.namespace', 'string'],
  ['agent_id', 'legacy.agentId', 'string'],
  ['create_user_id', 'legacy.userId', 'string'],
];
const AGENT_EXPORTER = createLegacyTableExporter({
  collections: [
    {
      buildSkipMeta: row => ({
        legacyAgentId: normalizeString(row.agent_id),
      }),
      fieldMapList: AGENT_FIELD_MAP,
      name: AGENT_COLLECTION,
      skippedStatName: 'skippedAgents',
      skipIf: row => !normalizeString(row.create_user_id),
      skipMessage: '[agent] skipped agent without create_user_id',
      statName: 'exportedAgents',
    },
  ],
  logPrefix: '[agent]',
  source: {
    primaryKey: 'agent_id',
    table: 'agent',
  },
});

async function main() {
  const mode = readMode({
    allowedValues: ['all', 'export', 'import'],
    defaultValue: 'all',
    envName: 'TRANSFER_AGENT_MODE',
  });
  const dumpPath = resolveDumpPath({
    defaultPath: path.resolve(__dirname, '../../dump'),
    envNames: ['TRANSFER_AGENT_DUMP_PATH', 'TRANSFER_USER_DUMP_PATH'],
  });

  if (mode === 'export') {
    await exportAgentsToBson(dumpPath);
    return;
  }

  if (mode === 'import') {
    await importAgentsFromBson(dumpPath);
    return;
  }

  await exportAgentsToBson(dumpPath);
  await importAgentsFromBson(dumpPath);
}

async function exportAgentsToBson(dumpPath) {
  const context = await createMysqlTransferContext();

  try {
    await exportAgents(context, dumpPath);
  } finally {
    await closeMysqlTransferConnection(context);
  }
}

async function importAgentsFromBson(dumpPath) {
  const context = await createMongoTransferContext();

  try {
    await importAgents(context, dumpPath);
  } finally {
    await closeMongoTransferConnection(context);
  }
}

async function exportAgents(context, dumpPath) {
  const batchSize = readNumberEnv('TRANSFER_AGENT_BATCH_SIZE', DEFAULT_BATCH_SIZE);
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');

  await AGENT_EXPORTER.exportToBson(context, {
    batchSize,
    dbName,
    dumpPath,
  });
}

async function importAgents(context, dumpPath) {
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);

  context.logger.info('[agent] bson import started', {
    dumpPath,
    dbName,
  });

  const stats = await importBsonCollection(context, {
    batchSize: readNumberEnv(
      'TRANSFER_AGENT_IMPORT_BATCH_SIZE',
      DEFAULT_IMPORT_BATCH_SIZE
    ),
    bsonPath: path.join(dbDumpPath, `${AGENT_COLLECTION}.bson`),
    collectionName: AGENT_COLLECTION,
  });

  context.logger.info('[agent] bson import completed', {
    [AGENT_COLLECTION]: stats,
  });
}

function normalizeLegacyId(value, fieldName) {
  const normalized = String(value).trim();

  if (!normalized) {
    throw new Error(`legacy ${fieldName} is required`);
  }

  return normalized;
}

function normalizeAgentSex(value) {
  const raw = normalizeString(value).toLowerCase();

  if (raw === '1' || raw === 'man' || raw === 'male' || raw === '男') {
    return 1;
  }

  return 0;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
