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
  buildObjectIdFromLegacyId,
  createBsonDumpWriter,
  importBsonCollection,
  normalizeDate,
  normalizeString,
  readEnv,
  readMode,
  readNumberEnv,
  resolveDumpPath,
} = require('./lib/migration');

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_IMPORT_BATCH_SIZE = 1000;
const POST_COLLECTION = 'post';
const MOMENT_TABLE = 'moment';
const AGENT_TABLE = 'agent';
const CREATED_TIME_COLUMNS = ['send_time', 'create_time', 'created_at', 'add_time'];
const UPDATED_TIME_COLUMNS = ['update_time', 'updated_at', 'send_time', 'create_time'];

async function main() {
  const mode = readMode({
    allowedValues: ['all', 'export', 'import'],
    defaultValue: 'all',
    envName: 'TRANSFER_POST_MODE',
  });
  const dumpPath = resolveDumpPath({
    defaultPath: path.resolve(__dirname, '../../dump'),
    envNames: [
      'TRANSFER_POST_DUMP_PATH',
      'TRANSFER_MESSAGE_DUMP_PATH',
      'TRANSFER_CONVERSATION_DUMP_PATH',
      'TRANSFER_AGENT_DUMP_PATH',
      'TRANSFER_USER_DUMP_PATH',
    ],
  });

  if (mode === 'export') {
    await exportPostsToBson(dumpPath);
    return;
  }

  if (mode === 'import') {
    await importPostsFromBson(dumpPath);
    return;
  }

  await exportPostsToBson(dumpPath);
  await importPostsFromBson(dumpPath);
}

async function exportPostsToBson(dumpPath) {
  const context = await createMysqlTransferContext();

  try {
    await exportPosts(context, dumpPath);
  } finally {
    await closeMysqlTransferConnection(context);
  }
}

async function importPostsFromBson(dumpPath) {
  const context = await createMongoTransferContext();

  try {
    await importPosts(context, dumpPath);
  } finally {
    await closeMongoTransferConnection(context);
  }
}

async function exportPosts(context, dumpPath) {
  const batchSize = readNumberEnv('TRANSFER_POST_BATCH_SIZE', DEFAULT_BATCH_SIZE);
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);
  const momentColumns = await fetchTableColumns(context, MOMENT_TABLE);
  const agentColumns = await fetchTableColumns(context, AGENT_TABLE);
  const cursorColumn = findFirstExistingColumn(momentColumns, [
    'id',
    'moment_id',
  ]);
  const stats = {
    scanned: 0,
    exportedPosts: 0,
    skippedInvalidPosts: 0,
    skippedAgentPostsWithoutOwner: 0,
  };
  let lastCursorValue = 0;
  let offset = 0;

  ensureRequiredColumns(momentColumns, [
    'moment_id',
    'send_id',
    'is_agent',
    'content',
    'moment_img',
  ]);
  ensureRequiredColumns(agentColumns, ['agent_id', 'create_user_id'], AGENT_TABLE);

  context.logger.info('[post] bson export started', {
    batchSize,
    dumpPath,
    dbName,
    sourceTable: MOMENT_TABLE,
  });

  const validAgentsById = await fetchValidLegacyAgents(context, {
    agentColumns,
    batchSize,
  });
  const writer = createBsonDumpWriter({
    collectionNames: [POST_COLLECTION],
    dbDumpPath,
  });

  try {
    for (;;) {
      const rows = await fetchLegacyMomentRows(
        context,
        batchSize,
        lastCursorValue,
        offset,
        momentColumns
      );

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        stats.scanned += 1;

        const doc = buildMongoDocumentFromMomentRow(row, {
          validAgentsById,
        });

        if (!doc) {
          if (isAgentMoment(row) && !validAgentsById.has(normalizeString(row.send_id))) {
            stats.skippedAgentPostsWithoutOwner += 1;
          } else {
            stats.skippedInvalidPosts += 1;
          }

          context.logger.warn('[post] skipped invalid moment row', {
            legacyMomentId: normalizeString(row.moment_id),
            legacySendId: normalizeString(row.send_id),
            isAgent: normalizeString(row.is_agent),
          });
          continue;
        }

        writer.write(POST_COLLECTION, doc);
        stats.exportedPosts += 1;
      }

      offset += rows.length;
      if (cursorColumn) {
        lastCursorValue = rows[rows.length - 1].migration_cursor;
      }
      context.logger.info('[post] bson export batch completed', {
        exportedPosts: stats.exportedPosts,
        lastCursorValue,
        scanned: stats.scanned,
        offset,
      });

      if (rows.length < batchSize) {
        break;
      }
    }
  } finally {
    await writer.close();
  }

  context.logger.info('[post] bson export completed', {
    ...stats,
    dumpPath,
    dbName,
  });
}

async function importPosts(context, dumpPath) {
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);

  context.logger.info('[post] bson import started', {
    dumpPath,
    dbName,
  });

  const stats = await importBsonCollection(context, {
    batchSize: readNumberEnv(
      'TRANSFER_POST_IMPORT_BATCH_SIZE',
      DEFAULT_IMPORT_BATCH_SIZE
    ),
    bsonPath: path.join(dbDumpPath, `${POST_COLLECTION}.bson`),
    collectionName: POST_COLLECTION,
  });

  context.logger.info('[post] bson import completed', {
    [POST_COLLECTION]: stats,
  });
}

async function fetchTableColumns(context, tableName) {
  const [rows] = await context.mysql.query(`SHOW COLUMNS FROM \`${tableName}\``);

  return new Set(rows.map(row => normalizeString(row.Field)));
}

function ensureRequiredColumns(columns, requiredColumns, tableName = MOMENT_TABLE) {
  const missingColumns = requiredColumns.filter(column => !columns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(
      `${tableName} missing required columns: ${missingColumns.join(', ')}`
    );
  }
}

async function fetchValidLegacyAgents(context, options) {
  const validAgentsById = new Map();
  let offset = 0;

  for (;;) {
    const rows = await fetchLegacyAgentRows(context, {
      columns: options.agentColumns,
      limit: options.batchSize,
      offset,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const legacyAgentId = normalizeString(row.agent_id);

      if (!legacyAgentId || validAgentsById.has(legacyAgentId)) {
        continue;
      }

      validAgentsById.set(legacyAgentId, row);
    }

    offset += rows.length;

    if (rows.length < options.batchSize) {
      break;
    }
  }

  context.logger.info('[post] valid agent preload completed', {
    validAgents: validAgentsById.size,
  });

  return validAgentsById;
}

async function fetchLegacyAgentRows(context, options) {
  const [rows] = await context.mysql.query(
    buildLegacyAgentSelect(options.columns),
    [options.limit, options.offset]
  );

  return rows;
}

function buildLegacyAgentSelect(columns) {
  const whereConditions = [
    'agent_id IS NOT NULL',
    'create_user_id IS NOT NULL',
    "TRIM(CAST(agent_id AS CHAR)) <> ''",
    "TRIM(CAST(create_user_id AS CHAR)) <> ''",
  ];
  const logicalDeleteCondition = buildLogicalDeleteCondition(columns);

  if (logicalDeleteCondition) {
    whereConditions.unshift(logicalDeleteCondition);
  }

  return `
    SELECT
      CAST(agent_id AS CHAR(191)) AS agent_id,
      CAST(create_user_id AS CHAR(191)) AS user_id
    FROM \`${AGENT_TABLE}\`
    WHERE ${whereConditions.join(' AND ')}
    ORDER BY agent_id ASC
    LIMIT ? OFFSET ?
  `;
}

async function fetchLegacyMomentRows(
  context,
  limit,
  lastCursorValue,
  offset,
  columns
) {
  const useCursor = findFirstExistingColumn(columns, ['id', 'moment_id']);
  const params = useCursor ? [lastCursorValue, limit] : [limit, offset];
  const [rows] = await context.mysql.query(
    buildLegacyMomentSelect(columns, Boolean(useCursor)),
    params
  );

  return rows;
}

function buildLegacyMomentSelect(columns, useCursor) {
  const idColumn = findFirstExistingColumn(columns, ['id', 'moment_id']);
  const createdColumn = findFirstExistingColumn(columns, CREATED_TIME_COLUMNS);
  const updatedColumn = findFirstExistingColumn(columns, UPDATED_TIME_COLUMNS);
  const cursorSelect = idColumn
    ? `m.\`${idColumn}\` AS migration_cursor,`
    : '';
  const createdAtSelect = createdColumn
    ? `m.\`${createdColumn}\` AS created_at,`
    : 'NULL AS created_at,';
  const updatedAtSelect = updatedColumn
    ? `m.\`${updatedColumn}\` AS updated_at`
    : createdColumn
      ? `m.\`${createdColumn}\` AS updated_at`
      : 'NULL AS updated_at';
  const cursorWhere = useCursor ? `AND m.\`${idColumn}\` > ?` : '';
  const orderBy = useCursor
    ? `m.\`${idColumn}\` ASC`
    : buildMomentOrderBy(createdColumn, idColumn);
  const limitClause = useCursor ? 'LIMIT ?' : 'LIMIT ? OFFSET ?';

  return `
    SELECT
      ${cursorSelect}
      CAST(m.moment_id AS CHAR(191)) AS moment_id,
      CAST(m.send_id AS CHAR(191)) AS send_id,
      CAST(m.is_agent AS CHAR(32)) AS is_agent,
      CAST(m.content AS CHAR) AS content,
      CAST(m.moment_img AS CHAR) AS moment_img,
      ${createdAtSelect}
      ${updatedAtSelect}
    FROM \`${MOMENT_TABLE}\` m
    WHERE ${buildMomentWhereClause(columns, 'm')}
    ${cursorWhere}
    ORDER BY ${orderBy}
    ${limitClause}
  `;
}

function buildMomentWhereClause(columns, tableAlias) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const conditions = [
    `${prefix}moment_id IS NOT NULL`,
    `${prefix}send_id IS NOT NULL`,
    `TRIM(CAST(${prefix}moment_id AS CHAR)) <> ''`,
    `TRIM(CAST(${prefix}send_id AS CHAR)) <> ''`,
  ];
  const logicalDeleteCondition = buildLogicalDeleteCondition(columns, tableAlias);

  if (logicalDeleteCondition) {
    conditions.unshift(logicalDeleteCondition);
  }

  return conditions.join(' AND ');
}

function buildLogicalDeleteCondition(columns, tableAlias) {
  if (!columns.has('logical_del')) {
    return '';
  }

  const prefix = tableAlias ? `${tableAlias}.` : '';

  return `COALESCE(${prefix}logical_del, 0) = 0`;
}

function buildMomentOrderBy(createdColumn, idColumn) {
  const orderParts = [];

  if (createdColumn) {
    orderParts.push(`m.\`${createdColumn}\` ASC`);
  }

  if (idColumn) {
    orderParts.push(`m.\`${idColumn}\` ASC`);
  }

  orderParts.push('CAST(m.moment_id AS CHAR) ASC');

  return orderParts.join(', ');
}

function buildMongoDocumentFromMomentRow(row, options) {
  const legacyMomentId = normalizeString(row.moment_id);
  const legacySendId = normalizeString(row.send_id);
  const content = normalizeString(row.content);
  const images = normalizeImages(row.moment_img);
  const agentMoment = isAgentMoment(row);
  const agent = agentMoment ? options.validAgentsById.get(legacySendId) : null;
  const legacyUserId = agentMoment
    ? normalizeString(agent?.user_id)
    : legacySendId;

  if (!legacyMomentId || !legacyUserId || (!content && images.length === 0)) {
    return null;
  }

  const createdAt = normalizeDate(row.created_at) || new Date();
  const updatedAt = normalizeDate(row.updated_at) || createdAt;

  return {
    _id: buildObjectIdFromLegacyId(`post:${legacyMomentId}`),
    userId: buildObjectIdFromLegacyId(legacyUserId),
    content,
    images,
    remindAgentIds: [],
    createdAt,
    updatedAt,
    legacy: {
      namespace: MIGRATION_NAMESPACE,
      momentId: legacyMomentId,
      sendId: legacySendId,
      isAgent: agentMoment,
      agentId: agentMoment ? legacySendId : '',
      userId: legacyUserId,
    },
  };
}

function normalizeImages(value) {
  const raw = normalizeString(value);

  if (!raw || raw === '[]') {
    return [];
  }

  const parsed = parseJsonImageList(raw);

  if (parsed.length > 0) {
    return parsed;
  }

  return raw
    .split(',')
    .map(item => normalizeImageValue(item))
    .filter(Boolean);
}

function parseJsonImageList(raw) {
  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed.map(item => normalizeImageValue(item)).filter(Boolean);
    }

    const singleValue = normalizeImageValue(parsed);

    return singleValue ? [singleValue] : [];
  } catch {
    return [];
  }
}

function normalizeImageValue(value) {
  if (typeof value === 'string') {
    return normalizeString(value);
  }

  if (value && typeof value === 'object') {
    return (
      normalizeString(value.url) ||
      normalizeString(value.src) ||
      normalizeString(value.path) ||
      normalizeString(value.objectKey)
    );
  }

  return '';
}

function isAgentMoment(row) {
  const value = normalizeString(row.is_agent).toLowerCase();

  return value === '1' || value === 'true' || value === 'agent';
}

function findFirstExistingColumn(columns, candidates) {
  return candidates.find(column => columns.has(column));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
