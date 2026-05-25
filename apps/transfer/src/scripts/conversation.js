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
const CONVERSATION_COLLECTION = 'conversation';
const CONVERSATION_RECORD_TABLE = 'conversation_record';
const AGENT_TABLE = 'agent';
const CREATED_TIME_COLUMNS = ['create_time', 'created_at', 'send_time', 'add_time'];
const UPDATED_TIME_COLUMNS = ['update_time', 'updated_at', 'create_time', 'send_time'];
const AGENT_CREATED_TIME_COLUMNS = ['create_time', 'created_at', 'add_time'];
const AGENT_UPDATED_TIME_COLUMNS = ['update_time', 'updated_at', 'create_time'];

async function main() {
  const mode = readMode({
    allowedValues: ['all', 'export', 'import'],
    defaultValue: 'all',
    envName: 'TRANSFER_CONVERSATION_MODE',
  });
  const dumpPath = resolveDumpPath({
    defaultPath: path.resolve(__dirname, '../../dump'),
    envNames: [
      'TRANSFER_CONVERSATION_DUMP_PATH',
      'TRANSFER_AGENT_DUMP_PATH',
      'TRANSFER_USER_DUMP_PATH',
    ],
  });

  if (mode === 'export') {
    await exportConversationsToBson(dumpPath);
    return;
  }

  if (mode === 'import') {
    await importConversationsFromBson(dumpPath);
    return;
  }

  await exportConversationsToBson(dumpPath);
  await importConversationsFromBson(dumpPath);
}

async function exportConversationsToBson(dumpPath) {
  const context = await createMysqlTransferContext();

  try {
    await exportConversations(context, dumpPath);
  } finally {
    await closeMysqlTransferConnection(context);
  }
}

async function importConversationsFromBson(dumpPath) {
  const context = await createMongoTransferContext();

  try {
    await importConversations(context, dumpPath);
  } finally {
    await closeMongoTransferConnection(context);
  }
}

async function exportConversations(context, dumpPath) {
  const batchSize = readNumberEnv(
    'TRANSFER_CONVERSATION_BATCH_SIZE',
    DEFAULT_BATCH_SIZE
  );
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);
  const tableColumns = await fetchTableColumns(context, CONVERSATION_RECORD_TABLE);
  const agentColumns = await fetchTableColumns(context, AGENT_TABLE);
  const stats = {
    scanned: 0,
    duplicatedConversations: 0,
    exportedConversations: 0,
    scannedAgents: 0,
    exportedSyntheticConversations: 0,
    skippedAgentsWithConversation: 0,
    skippedOrphanConversations: 0,
    skippedConversations: 0,
  };
  const seenConversationIds = new Set();
  const seenConversationPairs = new Set();
  const cursorColumn = findFirstExistingColumn(tableColumns, [
    'id',
    'record_id',
    'message_id',
  ]);
  let lastCursorValue = 0;
  let offset = 0;

  ensureRequiredColumns(tableColumns, [
    'conversation_id',
    'user_id',
    'agent_id',
  ]);
  ensureRequiredColumns(agentColumns, [
    'agent_id',
    'create_user_id',
  ], AGENT_TABLE);
  context.logger.info('[conversation] bson export started', {
    batchSize,
    dumpPath,
    dbName,
    sourceTable: CONVERSATION_RECORD_TABLE,
  });
  const validAgentResult = await fetchValidLegacyAgents(context, {
    agentColumns,
    batchSize,
  });
  const { stats: agentStats, validAgentsById } = validAgentResult;

  stats.scannedAgents = agentStats.scannedAgents;
  context.logger.info('[conversation] valid agent preload completed', {
    scannedAgents: stats.scannedAgents,
    duplicatedAgents: agentStats.duplicatedAgents,
    validAgents: validAgentsById.size,
  });

  const writer = createBsonDumpWriter({
    collectionNames: [CONVERSATION_COLLECTION],
    dbDumpPath,
  });

  try {
    for (;;) {
      const rows = await fetchLegacyConversationRows(
        context,
        batchSize,
        lastCursorValue,
        offset,
        tableColumns
      );

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        const legacyConversationId = normalizeString(row.conversation_id);
        const legacyAgentId = normalizeString(row.agent_id);
        const agent = validAgentsById.get(legacyAgentId);

        stats.scanned += 1;

        if (!legacyConversationId || !legacyAgentId) {
          stats.skippedConversations += 1;
          context.logger.warn('[conversation] skipped invalid conversation row', {
            legacyConversationId: normalizeString(row.conversation_id),
            legacyUserId: normalizeString(row.record_user_id),
            legacyAgentId: normalizeString(row.agent_id),
          });
          continue;
        }

        if (!agent) {
          stats.skippedOrphanConversations += 1;
          continue;
        }

        const doc = buildMongoDocumentFromConversationRow(row, agent);
        const pairKey = buildConversationPairKey(agent.user_id, legacyAgentId);

        if (!doc || !pairKey) {
          stats.skippedConversations += 1;
          continue;
        }

        if (seenConversationIds.has(legacyConversationId)) {
          stats.duplicatedConversations += 1;
          continue;
        }

        seenConversationIds.add(legacyConversationId);
        seenConversationPairs.add(pairKey);
        writer.write(CONVERSATION_COLLECTION, doc);
        stats.exportedConversations += 1;
      }

      offset += rows.length;
      if (cursorColumn) {
        lastCursorValue = rows[rows.length - 1].migration_cursor;
      }
      context.logger.info('[conversation] bson export batch completed', {
        duplicatedConversations: stats.duplicatedConversations,
        exportedConversations: stats.exportedConversations,
        lastCursorValue,
        scanned: stats.scanned,
        offset,
      });

      if (rows.length < batchSize) {
        break;
      }
    }

    const syntheticStats = await exportSyntheticConversationsForAgents(
      writer,
      {
        seenConversationPairs,
        validAgentsById,
      }
    );

    stats.exportedSyntheticConversations =
      syntheticStats.exportedSyntheticConversations;
    stats.skippedAgentsWithConversation =
      syntheticStats.skippedAgentsWithConversation;
  } finally {
    await writer.close();
  }

  context.logger.info('[conversation] bson export completed', {
    ...stats,
    dumpPath,
    dbName,
  });
}

async function importConversations(context, dumpPath) {
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);

  context.logger.info('[conversation] bson import started', {
    dumpPath,
    dbName,
  });

  const stats = await importBsonCollection(context, {
    batchSize: readNumberEnv(
      'TRANSFER_CONVERSATION_IMPORT_BATCH_SIZE',
      DEFAULT_IMPORT_BATCH_SIZE
    ),
    bsonPath: path.join(dbDumpPath, `${CONVERSATION_COLLECTION}.bson`),
    collectionName: CONVERSATION_COLLECTION,
  });

  context.logger.info('[conversation] bson import completed', {
    [CONVERSATION_COLLECTION]: stats,
  });
}

async function fetchTableColumns(context, tableName) {
  const [rows] = await context.mysql.query(`SHOW COLUMNS FROM \`${tableName}\``);

  return new Set(rows.map(row => normalizeString(row.Field)));
}

function ensureRequiredColumns(columns, requiredColumns, tableName = CONVERSATION_RECORD_TABLE) {
  const missingColumns = requiredColumns.filter(column => !columns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(
      `${tableName} missing required columns: ${missingColumns.join(
        ', '
      )}`
    );
  }
}

function buildLegacyConversationSelect(recordColumns, useCursor) {
  const createdColumn = findFirstExistingColumn(
    recordColumns,
    CREATED_TIME_COLUMNS
  );
  const updatedColumn = findFirstExistingColumn(
    recordColumns,
    UPDATED_TIME_COLUMNS
  );
  const tieBreakerColumn = findFirstExistingColumn(recordColumns, [
    'id',
    'record_id',
    'message_id',
  ]);
  const whereClause = `WHERE ${buildConversationWhereClause(recordColumns, 'cr')}`;
  const orderBy = buildConversationRepresentativeOrderBy(
    createdColumn,
    tieBreakerColumn,
    'cr'
  );
  const createdAtSelect = createdColumn
    ? `cr.\`${createdColumn}\` AS created_at`
    : 'NULL AS created_at';
  const updatedAtSelect = updatedColumn
    ? `cr.\`${updatedColumn}\` AS updated_at`
    : createdColumn
      ? `cr.\`${createdColumn}\` AS updated_at`
      : 'NULL AS updated_at';
  const cursorSelect = tieBreakerColumn
    ? `cr.\`${tieBreakerColumn}\` AS migration_cursor,`
    : '';
  const cursorWhere = useCursor
    ? `AND cr.\`${tieBreakerColumn}\` > ?`
    : '';
  const orderByClause = useCursor
    ? `cr.\`${tieBreakerColumn}\` ASC`
    : `CAST(cr.conversation_id AS CHAR) ASC, ${orderBy}`;
  const limitClause = useCursor ? 'LIMIT ?' : 'LIMIT ? OFFSET ?';

  return `
    SELECT
      ${cursorSelect}
      CAST(cr.conversation_id AS CHAR(191)) AS conversation_id,
      CAST(cr.user_id AS CHAR(191)) AS record_user_id,
      CAST(cr.agent_id AS CHAR(191)) AS agent_id,
      ${createdAtSelect},
      ${updatedAtSelect}
    FROM \`${CONVERSATION_RECORD_TABLE}\` cr
    ${whereClause}
    ${cursorWhere}
    ORDER BY ${orderByClause}
    ${limitClause}
  `;
}

async function fetchValidLegacyAgents(context, options) {
  const validAgentsById = new Map();
  const stats = {
    duplicatedAgents: 0,
    scannedAgents: 0,
  };
  let offset = 0;

  for (;;) {
    const rows = await fetchLegacyAgentRowsForConversation(
      context,
      options.batchSize,
      offset,
      options.agentColumns
    );

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      stats.scannedAgents += 1;

      const legacyAgentId = normalizeString(row.agent_id);

      if (!legacyAgentId) {
        continue;
      }

      if (validAgentsById.has(legacyAgentId)) {
        stats.duplicatedAgents += 1;
        continue;
      }

      validAgentsById.set(legacyAgentId, row);
    }

    offset += rows.length;

    if (rows.length < options.batchSize) {
      break;
    }
  }

  return {
    stats,
    validAgentsById,
  };
}

async function exportSyntheticConversationsForAgents(writer, options) {
  const stats = {
    exportedSyntheticConversations: 0,
    skippedAgentsWithConversation: 0,
  };

  for (const row of options.validAgentsById.values()) {
    const pairKey = buildConversationPairKey(row.user_id, row.agent_id);

    if (!pairKey) {
      continue;
    }

    if (options.seenConversationPairs.has(pairKey)) {
      stats.skippedAgentsWithConversation += 1;
      continue;
    }

    const doc = buildMongoDocumentFromAgentRow(row);

    if (!doc) {
      continue;
    }

    options.seenConversationPairs.add(pairKey);
    writer.write(CONVERSATION_COLLECTION, doc);
    stats.exportedSyntheticConversations += 1;
  }

  return stats;
}

async function fetchLegacyAgentRowsForConversation(
  context,
  limit,
  offset,
  columns
) {
  const [rows] = await context.mysql.query(
    buildLegacyAgentConversationSelect(columns),
    [limit, offset]
  );

  return rows;
}

function buildLegacyAgentConversationSelect(columns) {
  const createdColumn = findFirstExistingColumn(
    columns,
    AGENT_CREATED_TIME_COLUMNS
  );
  const updatedColumn = findFirstExistingColumn(
    columns,
    AGENT_UPDATED_TIME_COLUMNS
  );
  const createdAtSelect = createdColumn
    ? `\`${createdColumn}\` AS created_at`
    : 'NULL AS created_at';
  const updatedAtSelect = updatedColumn
    ? `\`${updatedColumn}\` AS updated_at`
    : createdColumn
      ? `\`${createdColumn}\` AS updated_at`
      : 'NULL AS updated_at';
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

  const whereClause = whereConditions.join(' AND ');

  return `
    SELECT
      CAST(agent_id AS CHAR(191)) AS agent_id,
      CAST(create_user_id AS CHAR(191)) AS user_id,
      ${createdAtSelect},
      ${updatedAtSelect}
    FROM \`${AGENT_TABLE}\`
    WHERE ${whereClause}
    ORDER BY agent_id ASC
    LIMIT ? OFFSET ?
  `;
}

function buildConversationWhereClause(columns, tableAlias) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const conditions = [
    `${prefix}conversation_id IS NOT NULL`,
    `${prefix}user_id IS NOT NULL`,
    `${prefix}agent_id IS NOT NULL`,
    `TRIM(CAST(${prefix}conversation_id AS CHAR)) <> ''`,
    `TRIM(CAST(${prefix}user_id AS CHAR)) <> ''`,
    `TRIM(CAST(${prefix}agent_id AS CHAR)) <> ''`,
  ];

  const logicalDeleteCondition = buildLogicalDeleteCondition(
    columns,
    tableAlias
  );

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


async function fetchLegacyConversationRows(
  context,
  limit,
  lastCursorValue,
  offset,
  columns
) {
  const useCursor = findFirstExistingColumn(columns, [
    'id',
    'record_id',
    'message_id',
  ]);
  const params = useCursor ? [lastCursorValue, limit] : [limit, offset];
  const [rows] = await context.mysql.query(
    buildLegacyConversationSelect(columns, Boolean(useCursor)),
    params
  );

  return rows;
}

function findFirstExistingColumn(columns, candidates) {
  return candidates.find(column => columns.has(column));
}

function buildConversationRepresentativeOrderBy(
  createdColumn,
  tieBreakerColumn,
  tableAlias
) {
  const orderParts = [];
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (createdColumn) {
    orderParts.push(`${prefix}\`${createdColumn}\` ASC`);
  }

  if (tieBreakerColumn) {
    orderParts.push(`${prefix}\`${tieBreakerColumn}\` ASC`);
  }

  orderParts.push(
    `CAST(${prefix}user_id AS CHAR) ASC`,
    `CAST(${prefix}agent_id AS CHAR) ASC`
  );

  return orderParts.join(', ');
}

function buildMongoDocumentFromConversationRow(row, agent) {
  const legacyConversationId = normalizeString(row.conversation_id);
  const legacyUserId = normalizeString(agent.user_id);
  const legacyAgentId = normalizeString(row.agent_id);

  if (!legacyConversationId || !legacyUserId || !legacyAgentId) {
    return null;
  }

  const now = new Date();

  return {
    _id: buildObjectIdFromLegacyId(
      `conversation:${legacyConversationId}:${legacyUserId}:${legacyAgentId}`
    ),
    userId: buildObjectIdFromLegacyId(legacyUserId),
    agentId: buildObjectIdFromLegacyId(`agent:${legacyAgentId}`),
    createdAt: normalizeDate(row.created_at) || now,
    updatedAt: normalizeDate(row.updated_at) || now,
    legacy: {
      namespace: MIGRATION_NAMESPACE,
      conversationId: legacyConversationId,
      userId: legacyUserId,
      agentId: legacyAgentId,
      recordUserId: normalizeString(row.record_user_id),
    },
  };
}

function buildMongoDocumentFromAgentRow(row) {
  const legacyUserId = normalizeString(row.user_id);
  const legacyAgentId = normalizeString(row.agent_id);

  if (!legacyUserId || !legacyAgentId) {
    return null;
  }

  const now = new Date();

  return {
    _id: buildObjectIdFromLegacyId(
      `conversation:synthetic-agent:${legacyUserId}:${legacyAgentId}`
    ),
    userId: buildObjectIdFromLegacyId(legacyUserId),
    agentId: buildObjectIdFromLegacyId(`agent:${legacyAgentId}`),
    createdAt: normalizeDate(row.created_at) || now,
    updatedAt: normalizeDate(row.updated_at) || normalizeDate(row.created_at) || now,
    legacy: {
      namespace: MIGRATION_NAMESPACE,
      synthetic: true,
      userId: legacyUserId,
      agentId: legacyAgentId,
    },
  };
}

function buildConversationPairKey(legacyUserId, legacyAgentId) {
  const userId = normalizeString(legacyUserId);
  const agentId = normalizeString(legacyAgentId);

  if (!userId || !agentId) {
    return '';
  }

  return `${userId}:${agentId}`;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
