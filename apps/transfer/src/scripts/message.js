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
const MESSAGE_COLLECTION = 'message';
const CONVERSATION_RECORD_TABLE = 'conversation_record';
const AGENT_TABLE = 'agent';
const CREATED_TIME_COLUMNS = ['send_time', 'create_time', 'created_at', 'add_time'];
const UPDATED_TIME_COLUMNS = ['update_time', 'updated_at', 'send_time', 'create_time'];
const USER_SEND_TYPES = ['1', 'user', '用户', 'member', 'customer', 'human'];
const ASSISTANT_SEND_TYPES = ['2', 'agent', 'assistant', 'ai', 'bot', '智能体'];

async function main() {
  const mode = readMode({
    allowedValues: ['all', 'export', 'import'],
    defaultValue: 'all',
    envName: 'TRANSFER_MESSAGE_MODE',
  });
  const dumpPath = resolveDumpPath({
    defaultPath: path.resolve(__dirname, '../../dump'),
    envNames: [
      'TRANSFER_MESSAGE_DUMP_PATH',
      'TRANSFER_CONVERSATION_DUMP_PATH',
      'TRANSFER_AGENT_DUMP_PATH',
      'TRANSFER_USER_DUMP_PATH',
    ],
  });

  if (mode === 'export') {
    await exportMessagesToBson(dumpPath);
    return;
  }

  if (mode === 'import') {
    await importMessagesFromBson(dumpPath);
    return;
  }

  await exportMessagesToBson(dumpPath);
  await importMessagesFromBson(dumpPath);
}

async function exportMessagesToBson(dumpPath) {
  const context = await createMysqlTransferContext();

  try {
    await exportMessages(context, dumpPath);
  } finally {
    await closeMysqlTransferConnection(context);
  }
}

async function importMessagesFromBson(dumpPath) {
  const context = await createMongoTransferContext();

  try {
    await importMessages(context, dumpPath);
  } finally {
    await closeMongoTransferConnection(context);
  }
}

async function exportMessages(context, dumpPath) {
  const batchSize = readNumberEnv('TRANSFER_MESSAGE_BATCH_SIZE', DEFAULT_BATCH_SIZE);
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);
  const recordColumns = await fetchTableColumns(context, CONVERSATION_RECORD_TABLE);
  const agentColumns = await fetchTableColumns(context, AGENT_TABLE);
  const cursorColumn = findFirstExistingColumn(recordColumns, [
    'id',
    'record_id',
    'message_id',
  ]);
  const stats = {
    scanned: 0,
    exportedMessages: 0,
    skippedInvalidMessages: 0,
    skippedOrphanAgents: 0,
  };
  let lastCursorValue = 0;
  let offset = 0;

  ensureRequiredColumns(recordColumns, [
    'conversation_id',
    'user_id',
    'agent_id',
    'message',
  ]);
  ensureRequiredColumns(agentColumns, ['agent_id', 'create_user_id'], AGENT_TABLE);

  context.logger.info('[message] bson export started', {
    batchSize,
    dumpPath,
    dbName,
    sourceTable: CONVERSATION_RECORD_TABLE,
  });

  const validAgentsById = await fetchValidLegacyAgents(context, {
    agentColumns,
    batchSize,
  });
  const writer = createBsonDumpWriter({
    collectionNames: [MESSAGE_COLLECTION],
    dbDumpPath,
  });

  try {
    for (;;) {
      const rows = await fetchLegacyMessageRows(
        context,
        batchSize,
        lastCursorValue,
        offset,
        recordColumns
      );

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        stats.scanned += 1;

        const legacyAgentId = normalizeString(row.agent_id);
        const agent = validAgentsById.get(legacyAgentId);

        if (!agent) {
          stats.skippedOrphanAgents += 1;
          continue;
        }

        const doc = buildMongoDocumentFromMessageRow(row, agent);

        if (!doc) {
          stats.skippedInvalidMessages += 1;
          context.logger.warn('[message] skipped invalid message row', {
            legacyMessageId: normalizeString(row.message_id),
            legacyConversationId: normalizeString(row.conversation_id),
            legacyUserId: normalizeString(row.record_user_id),
            legacyAgentId,
          });
          continue;
        }

        writer.write(MESSAGE_COLLECTION, doc);
        stats.exportedMessages += 1;
      }

      offset += rows.length;
      if (cursorColumn) {
        lastCursorValue = rows[rows.length - 1].migration_cursor;
      }
      context.logger.info('[message] bson export batch completed', {
        exportedMessages: stats.exportedMessages,
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

  context.logger.info('[message] bson export completed', {
    ...stats,
    dumpPath,
    dbName,
  });
}

async function importMessages(context, dumpPath) {
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);

  context.logger.info('[message] bson import started', {
    dumpPath,
    dbName,
  });

  const stats = await importBsonCollection(context, {
    batchSize: readNumberEnv(
      'TRANSFER_MESSAGE_IMPORT_BATCH_SIZE',
      DEFAULT_IMPORT_BATCH_SIZE
    ),
    bsonPath: path.join(dbDumpPath, `${MESSAGE_COLLECTION}.bson`),
    collectionName: MESSAGE_COLLECTION,
  });

  context.logger.info('[message] bson import completed', {
    [MESSAGE_COLLECTION]: stats,
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

  context.logger.info('[message] valid agent preload completed', {
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

async function fetchLegacyMessageRows(
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
    buildLegacyMessageSelect(columns, Boolean(useCursor)),
    params
  );

  return rows;
}

function buildLegacyMessageSelect(columns, useCursor) {
  const idColumn = findFirstExistingColumn(columns, [
    'id',
    'record_id',
    'message_id',
  ]);
  const createdColumn = findFirstExistingColumn(columns, CREATED_TIME_COLUMNS);
  const updatedColumn = findFirstExistingColumn(columns, UPDATED_TIME_COLUMNS);
  const sendIdColumn = findFirstExistingColumn(columns, ['send_id', 'sender_id']);
  const sendTypeColumn = findFirstExistingColumn(columns, [
    'send_type',
    'sender_type',
  ]);
  const cursorSelect = idColumn
    ? `cr.\`${idColumn}\` AS migration_cursor,`
    : '';
  const idSelect = idColumn
    ? `CAST(cr.\`${idColumn}\` AS CHAR(191)) AS message_id,`
    : '';
  const sendIdSelect = sendIdColumn
    ? `CAST(cr.\`${sendIdColumn}\` AS CHAR(191)) AS send_id,`
    : "'' AS send_id,";
  const sendTypeSelect = sendTypeColumn
    ? `CAST(cr.\`${sendTypeColumn}\` AS CHAR(191)) AS send_type,`
    : "'' AS send_type,";
  const createdAtSelect = createdColumn
    ? `cr.\`${createdColumn}\` AS created_at,`
    : 'NULL AS created_at,';
  const updatedAtSelect = updatedColumn
    ? `cr.\`${updatedColumn}\` AS updated_at`
    : createdColumn
      ? `cr.\`${createdColumn}\` AS updated_at`
      : 'NULL AS updated_at';
  const cursorWhere = useCursor ? `AND cr.\`${idColumn}\` > ?` : '';
  const orderBy = useCursor
    ? `cr.\`${idColumn}\` ASC`
    : buildMessageOrderBy(createdColumn, idColumn);
  const limitClause = useCursor ? 'LIMIT ?' : 'LIMIT ? OFFSET ?';

  return `
    SELECT
      ${cursorSelect}
      ${idSelect}
      CAST(cr.conversation_id AS CHAR(191)) AS conversation_id,
      CAST(cr.user_id AS CHAR(191)) AS record_user_id,
      CAST(cr.agent_id AS CHAR(191)) AS agent_id,
      ${sendIdSelect}
      ${sendTypeSelect}
      CAST(cr.message AS CHAR) AS content,
      ${createdAtSelect}
      ${updatedAtSelect}
    FROM \`${CONVERSATION_RECORD_TABLE}\` cr
    WHERE ${buildMessageWhereClause(columns, 'cr')}
    ${cursorWhere}
    ORDER BY ${orderBy}
    ${limitClause}
  `;
}

function buildMessageWhereClause(columns, tableAlias) {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const conditions = [
    `${prefix}conversation_id IS NOT NULL`,
    `${prefix}user_id IS NOT NULL`,
    `${prefix}agent_id IS NOT NULL`,
    `${prefix}message IS NOT NULL`,
    `TRIM(CAST(${prefix}conversation_id AS CHAR)) <> ''`,
    `TRIM(CAST(${prefix}user_id AS CHAR)) <> ''`,
    `TRIM(CAST(${prefix}agent_id AS CHAR)) <> ''`,
    `TRIM(CAST(${prefix}message AS CHAR)) <> ''`,
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

function buildMessageOrderBy(createdColumn, idColumn) {
  const orderParts = [
    'CAST(cr.conversation_id AS CHAR) ASC',
  ];

  if (createdColumn) {
    orderParts.push(`cr.\`${createdColumn}\` ASC`);
  }

  if (idColumn) {
    orderParts.push(`cr.\`${idColumn}\` ASC`);
  }

  orderParts.push('CAST(cr.user_id AS CHAR) ASC', 'CAST(cr.agent_id AS CHAR) ASC');

  return orderParts.join(', ');
}

function buildMongoDocumentFromMessageRow(row, agent) {
  const legacyMessageId = normalizeString(row.message_id);
  const legacyConversationId = normalizeString(row.conversation_id);
  const legacyRecordUserId = normalizeString(row.record_user_id);
  const legacyUserId = normalizeString(agent.user_id);
  const legacyAgentId = normalizeString(row.agent_id);
  const content = normalizeString(row.content);

  if (!legacyConversationId || !legacyUserId || !legacyAgentId || !content) {
    return null;
  }

  const createdAt = normalizeDate(row.created_at) || new Date();
  const updatedAt = normalizeDate(row.updated_at) || createdAt;

  return {
    _id: buildMessageObjectId(row),
    conversationId: buildObjectIdFromLegacyId(
      `conversation:${legacyConversationId}:${legacyUserId}:${legacyAgentId}`
    ),
    userId: buildObjectIdFromLegacyId(legacyUserId),
    agentId: buildObjectIdFromLegacyId(`agent:${legacyAgentId}`),
    role: normalizeMessageRole(row, {
      legacyAgentId,
      legacyRecordUserId,
      legacyUserId,
    }),
    type: 'text',
    content,
    status: 'sent',
    mediaObjectKey: '',
    mediaUrl: '',
    mediaMimeType: '',
    mediaAnalysis: '',
    mediaTranscript: '',
    model: '',
    createdAt,
    updatedAt,
    legacy: {
      namespace: MIGRATION_NAMESPACE,
      conversationId: legacyConversationId,
      messageId: legacyMessageId,
      userId: legacyUserId,
      recordUserId: legacyRecordUserId,
      agentId: legacyAgentId,
      sendId: normalizeString(row.send_id),
      sendType: normalizeString(row.send_type),
    },
  };
}

function buildMessageObjectId(row) {
  const legacyMessageId = normalizeString(row.message_id);

  if (legacyMessageId) {
    return buildObjectIdFromLegacyId(`message:${legacyMessageId}`);
  }

  return buildObjectIdFromLegacyId(
    [
      'message',
      normalizeString(row.conversation_id),
      normalizeString(row.record_user_id),
      normalizeString(row.agent_id),
      normalizeString(row.send_id),
      normalizeString(row.send_type),
      normalizeDate(row.created_at)?.toISOString() || '',
      normalizeString(row.content),
    ].join(':')
  );
}

function normalizeMessageRole(row, ids) {
  const sendType = normalizeString(row.send_type).toLowerCase();
  const sendId = normalizeString(row.send_id);
  const userSendTypes = readRoleTokens(
    'TRANSFER_MESSAGE_USER_SEND_TYPES',
    USER_SEND_TYPES
  );
  const assistantSendTypes = readRoleTokens(
    'TRANSFER_MESSAGE_ASSISTANT_SEND_TYPES',
    ASSISTANT_SEND_TYPES
  );

  if (sendId && sendId === ids.legacyAgentId) {
    return 'assistant';
  }

  if (
    sendId &&
    (sendId === ids.legacyRecordUserId || sendId === ids.legacyUserId)
  ) {
    return 'user';
  }

  if (assistantSendTypes.has(sendType)) {
    return 'assistant';
  }

  if (userSendTypes.has(sendType)) {
    return 'user';
  }

  return 'user';
}

function readRoleTokens(envName, fallbackTokens) {
  const raw = readEnv(envName, '');
  const tokens = raw
    ? raw.split(',').map(item => item.trim()).filter(Boolean)
    : fallbackTokens;

  return new Set(tokens.map(item => item.toLowerCase()));
}

function findFirstExistingColumn(columns, candidates) {
  return candidates.find(column => columns.has(column));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
