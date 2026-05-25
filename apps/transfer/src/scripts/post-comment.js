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
const POST_COMMENT_COLLECTION = 'post_comment';
const MOMENT_COMMENT_TABLE = 'moment_comment';
const REPLAY_MESSAGE_TABLE = 'replay_message';

async function main() {
  const mode = readMode({
    allowedValues: ['all', 'export', 'import'],
    defaultValue: 'all',
    envName: 'TRANSFER_POST_COMMENT_MODE',
  });
  const dumpPath = resolveDumpPath({
    defaultPath: path.resolve(__dirname, '../../dump'),
    envNames: [
      'TRANSFER_POST_COMMENT_DUMP_PATH',
      'TRANSFER_POST_DUMP_PATH',
      'TRANSFER_MESSAGE_DUMP_PATH',
      'TRANSFER_CONVERSATION_DUMP_PATH',
      'TRANSFER_AGENT_DUMP_PATH',
      'TRANSFER_USER_DUMP_PATH',
    ],
  });

  if (mode === 'export') {
    await exportPostCommentsToBson(dumpPath);
    return;
  }

  if (mode === 'import') {
    await importPostCommentsFromBson(dumpPath);
    return;
  }

  await exportPostCommentsToBson(dumpPath);
  await importPostCommentsFromBson(dumpPath);
}

async function exportPostCommentsToBson(dumpPath) {
  const context = await createMysqlTransferContext();

  try {
    await exportPostComments(context, dumpPath);
  } finally {
    await closeMysqlTransferConnection(context);
  }
}

async function importPostCommentsFromBson(dumpPath) {
  const context = await createMongoTransferContext();

  try {
    await importPostComments(context, dumpPath);
  } finally {
    await closeMongoTransferConnection(context);
  }
}

async function exportPostComments(context, dumpPath) {
  const includeMomentComment = readBooleanEnv(
    'TRANSFER_POST_COMMENT_INCLUDE_MOMENT_COMMENT',
    true
  );
  const includeReplayMessage = readBooleanEnv(
    'TRANSFER_POST_COMMENT_INCLUDE_REPLAY_MESSAGE',
    true
  );

  if (!includeMomentComment && !includeReplayMessage) {
    throw new Error(
      'at least one post comment source must be enabled'
    );
  }

  const batchSize = readNumberEnv(
    'TRANSFER_POST_COMMENT_BATCH_SIZE',
    DEFAULT_BATCH_SIZE
  );
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);
  const momentCommentColumns = includeMomentComment
    ? await fetchTableColumns(context, MOMENT_COMMENT_TABLE)
    : new Set();
  const replayMessageColumns = includeReplayMessage
    ? await fetchTableColumns(context, REPLAY_MESSAGE_TABLE)
    : new Set();
  const stats = {
    scannedMomentComments: 0,
    exportedMomentComments: 0,
    skippedMomentComments: 0,
    scannedReplayMessages: 0,
    exportedReplayMessages: 0,
    skippedReplayMessages: 0,
    missingReplyTargets: 0,
  };

  if (includeMomentComment) {
    ensureRequiredColumns(momentCommentColumns, [
      'moment_id',
      'user_id',
      'comment_content',
    ], MOMENT_COMMENT_TABLE);
  }

  if (includeReplayMessage) {
    ensureRequiredColumns(replayMessageColumns, [
      'moment_id',
      'send_id',
      'is_agent',
      'comment_content',
    ], REPLAY_MESSAGE_TABLE);
  }

  context.logger.info('[post-comment] bson export started', {
    batchSize,
    dumpPath,
    dbName,
    includeMomentComment,
    includeReplayMessage,
  });

  const targetMaps = await preloadReplyTargets(context, {
    batchSize,
    includeMomentComment,
    includeReplayMessage,
    momentCommentColumns,
    replayMessageColumns,
  });
  const writer = createBsonDumpWriter({
    collectionNames: [POST_COMMENT_COLLECTION],
    dbDumpPath,
  });

  try {
    if (includeMomentComment) {
      await exportMomentComments(context, writer, {
        batchSize,
        columns: momentCommentColumns,
        stats,
        targetMaps,
      });
    }

    if (includeReplayMessage) {
      await exportReplayMessages(context, writer, {
        batchSize,
        columns: replayMessageColumns,
        stats,
        targetMaps,
      });
    }
  } finally {
    await writer.close();
  }

  context.logger.info('[post-comment] bson export completed', {
    ...stats,
    dumpPath,
    dbName,
  });
}

async function importPostComments(context, dumpPath) {
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);

  context.logger.info('[post-comment] bson import started', {
    dumpPath,
    dbName,
  });

  const stats = await importBsonCollection(context, {
    batchSize: readNumberEnv(
      'TRANSFER_POST_COMMENT_IMPORT_BATCH_SIZE',
      DEFAULT_IMPORT_BATCH_SIZE
    ),
    bsonPath: path.join(dbDumpPath, `${POST_COMMENT_COLLECTION}.bson`),
    collectionName: POST_COMMENT_COLLECTION,
  });

  context.logger.info('[post-comment] bson import completed', {
    [POST_COMMENT_COLLECTION]: stats,
  });
}

async function preloadReplyTargets(context, options) {
  const momentCommentById = new Map();
  const replayMessageById = new Map();

  if (options.includeMomentComment) {
    await preloadMomentCommentTargets(context, {
      batchSize: options.batchSize,
      columns: options.momentCommentColumns,
      target: momentCommentById,
    });
  }

  if (options.includeReplayMessage) {
    await preloadReplayMessageTargets(context, {
      batchSize: options.batchSize,
      columns: options.replayMessageColumns,
      target: replayMessageById,
    });
  }

  context.logger.info('[post-comment] reply target preload completed', {
    momentCommentTargets: momentCommentById.size,
    replayMessageTargets: replayMessageById.size,
  });

  return {
    momentCommentById,
    replayMessageById,
  };
}

async function preloadMomentCommentTargets(context, options) {
  let lastCursorValue = 0;
  let offset = 0;

  for (;;) {
    const rows = await fetchLegacyMomentCommentRows(context, {
      columns: options.columns,
      lastCursorValue,
      limit: options.batchSize,
      offset,
      requireContent: false,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const identity = buildMomentCommentIdentity(row);

      if (identity?.legacyId && !options.target.has(identity.legacyId)) {
        options.target.set(identity.legacyId, identity);
      }
    }

    offset += rows.length;
    if (options.columns.has('id')) {
      lastCursorValue = rows[rows.length - 1].migration_cursor;
    }

    if (rows.length < options.batchSize) {
      break;
    }
  }
}

async function preloadReplayMessageTargets(context, options) {
  let lastCursorValue = 0;
  let offset = 0;

  for (;;) {
    const rows = await fetchLegacyReplayMessageRows(context, {
      columns: options.columns,
      lastCursorValue,
      limit: options.batchSize,
      offset,
      requireContent: false,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const identity = buildReplayMessageIdentity(row);

      if (identity?.legacyId && !options.target.has(identity.legacyId)) {
        options.target.set(identity.legacyId, identity);
      }
    }

    offset += rows.length;
    if (options.columns.has('id')) {
      lastCursorValue = rows[rows.length - 1].migration_cursor;
    }

    if (rows.length < options.batchSize) {
      break;
    }
  }
}

async function exportMomentComments(context, writer, options) {
  let lastCursorValue = 0;
  let offset = 0;

  for (;;) {
    const rows = await fetchLegacyMomentCommentRows(context, {
      columns: options.columns,
      lastCursorValue,
      limit: options.batchSize,
      offset,
      requireContent: true,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      options.stats.scannedMomentComments += 1;

      const doc = buildMongoDocumentFromMomentCommentRow(
        row,
        options.targetMaps,
        options.stats
      );

      if (!doc) {
        options.stats.skippedMomentComments += 1;
        context.logger.warn('[post-comment] skipped invalid moment_comment row', {
          legacyCommentId: normalizeString(row.comment_id),
          legacyMomentId: normalizeString(row.moment_id),
          legacyUserId: normalizeString(row.user_id),
        });
        continue;
      }

      writer.write(POST_COMMENT_COLLECTION, doc);
      options.stats.exportedMomentComments += 1;
    }

    offset += rows.length;
    if (options.columns.has('id')) {
      lastCursorValue = rows[rows.length - 1].migration_cursor;
    }
    context.logger.info('[post-comment] moment_comment export batch completed', {
      exportedMomentComments: options.stats.exportedMomentComments,
      lastCursorValue,
      scannedMomentComments: options.stats.scannedMomentComments,
      offset,
    });

    if (rows.length < options.batchSize) {
      break;
    }
  }
}

async function exportReplayMessages(context, writer, options) {
  let lastCursorValue = 0;
  let offset = 0;

  for (;;) {
    const rows = await fetchLegacyReplayMessageRows(context, {
      columns: options.columns,
      lastCursorValue,
      limit: options.batchSize,
      offset,
      requireContent: true,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      options.stats.scannedReplayMessages += 1;

      const doc = buildMongoDocumentFromReplayMessageRow(
        row,
        options.targetMaps,
        options.stats
      );

      if (!doc) {
        options.stats.skippedReplayMessages += 1;
        context.logger.warn('[post-comment] skipped invalid replay_message row', {
          legacyMessageId: normalizeString(row.message_id),
          legacyMomentId: normalizeString(row.moment_id),
          legacySendId: normalizeString(row.send_id),
          isAgent: normalizeString(row.is_agent),
        });
        continue;
      }

      writer.write(POST_COMMENT_COLLECTION, doc);
      options.stats.exportedReplayMessages += 1;
    }

    offset += rows.length;
    if (options.columns.has('id')) {
      lastCursorValue = rows[rows.length - 1].migration_cursor;
    }
    context.logger.info('[post-comment] replay_message export batch completed', {
      exportedReplayMessages: options.stats.exportedReplayMessages,
      lastCursorValue,
      scannedReplayMessages: options.stats.scannedReplayMessages,
      offset,
    });

    if (rows.length < options.batchSize) {
      break;
    }
  }
}

async function fetchTableColumns(context, tableName) {
  const [rows] = await context.mysql.query(`SHOW COLUMNS FROM \`${tableName}\``);

  return new Set(rows.map(row => normalizeString(row.Field)));
}

function ensureRequiredColumns(columns, requiredColumns, tableName) {
  const missingColumns = requiredColumns.filter(column => !columns.has(column));

  if (missingColumns.length > 0) {
    throw new Error(
      `${tableName} missing required columns: ${missingColumns.join(', ')}`
    );
  }
}

async function fetchLegacyMomentCommentRows(context, options) {
  const useCursor = options.columns.has('id');
  const params = useCursor
    ? [options.lastCursorValue, options.limit]
    : [options.limit, options.offset];
  const [rows] = await context.mysql.query(
    buildLegacyMomentCommentSelect(options.columns, {
      requireContent: options.requireContent,
      useCursor,
    }),
    params
  );

  return rows;
}

function buildLegacyMomentCommentSelect(columns, options) {
  const cursorSelect = columns.has('id') ? 'mc.`id` AS migration_cursor,' : '';
  const rowIdSelect = columns.has('id')
    ? 'CAST(mc.`id` AS CHAR(191)) AS legacy_row_id,'
    : "'' AS legacy_row_id,";
  const commentIdSelect = columns.has('comment_id')
    ? 'CAST(mc.`comment_id` AS CHAR(191)) AS comment_id,'
    : "'' AS comment_id,";
  const replayCommentIdSelect = columns.has('replay_comment_id')
    ? 'CAST(mc.`replay_comment_id` AS CHAR(191)) AS replay_comment_id,'
    : "'' AS replay_comment_id,";
  const topCommentIdSelect = columns.has('top_comment_id')
    ? 'CAST(mc.`top_comment_id` AS CHAR(191)) AS top_comment_id,'
    : "'' AS top_comment_id,";
  const likeCountSelect = columns.has('like_count')
    ? 'mc.`like_count` AS like_count,'
    : '0 AS like_count,';
  const commentTimeSelect = columns.has('comment_time')
    ? 'mc.`comment_time` AS created_at'
    : 'NULL AS created_at';
  const cursorWhere = options.useCursor ? 'AND mc.`id` > ?' : '';
  const limitClause = options.useCursor ? 'LIMIT ?' : 'LIMIT ? OFFSET ?';

  const orderBy = options.useCursor
    ? 'mc.`id` ASC'
    : buildFallbackOrderBy(columns, 'mc', 'comment_time');

  return `
    SELECT
      ${cursorSelect}
      ${rowIdSelect}
      ${commentIdSelect}
      CAST(mc.moment_id AS CHAR(191)) AS moment_id,
      CAST(mc.user_id AS CHAR(191)) AS user_id,
      ${replayCommentIdSelect}
      ${topCommentIdSelect}
      CAST(mc.comment_content AS CHAR) AS content,
      ${likeCountSelect}
      ${commentTimeSelect}
    FROM \`${MOMENT_COMMENT_TABLE}\` mc
    WHERE ${buildMomentCommentWhereClause(columns, options.requireContent)}
    ${cursorWhere}
    ORDER BY ${orderBy}
    ${limitClause}
  `;
}

function buildMomentCommentWhereClause(columns, requireContent) {
  const conditions = [
    'mc.moment_id IS NOT NULL',
    'mc.user_id IS NOT NULL',
    "TRIM(CAST(mc.moment_id AS CHAR)) <> ''",
    "TRIM(CAST(mc.user_id AS CHAR)) <> ''",
  ];

  if (requireContent) {
    conditions.push(
      'mc.comment_content IS NOT NULL',
      "TRIM(CAST(mc.comment_content AS CHAR)) <> ''"
    );
  }

  const logicalDeleteCondition = buildLogicalDeleteCondition(columns, 'mc');

  if (logicalDeleteCondition) {
    conditions.unshift(logicalDeleteCondition);
  }

  return conditions.join(' AND ');
}

async function fetchLegacyReplayMessageRows(context, options) {
  const useCursor = options.columns.has('id');
  const params = useCursor
    ? [options.lastCursorValue, options.limit]
    : [options.limit, options.offset];
  const [rows] = await context.mysql.query(
    buildLegacyReplayMessageSelect(options.columns, {
      requireContent: options.requireContent,
      useCursor,
    }),
    params
  );

  return rows;
}

function buildLegacyReplayMessageSelect(columns, options) {
  const cursorSelect = columns.has('id') ? 'rm.`id` AS migration_cursor,' : '';
  const rowIdSelect = columns.has('id')
    ? 'CAST(rm.`id` AS CHAR(191)) AS legacy_row_id,'
    : "'' AS legacy_row_id,";
  const messageIdSelect = columns.has('message_id')
    ? 'CAST(rm.`message_id` AS CHAR(191)) AS message_id,'
    : "'' AS message_id,";
  const replayMessageIdSelect = columns.has('replay_message_id')
    ? 'CAST(rm.`replay_message_id` AS CHAR(191)) AS replay_message_id,'
    : "'' AS replay_message_id,";
  const topMessageIdSelect = columns.has('top_message_id')
    ? 'CAST(rm.`top_message_id` AS CHAR(191)) AS top_message_id,'
    : "'' AS top_message_id,";
  const replyRoundSelect = columns.has('reply_round')
    ? 'rm.`reply_round` AS reply_round,'
    : 'NULL AS reply_round,';
  const replyTimeSelect = columns.has('reply_time')
    ? 'rm.`reply_time` AS created_at'
    : 'NULL AS created_at';
  const cursorWhere = options.useCursor ? 'AND rm.`id` > ?' : '';
  const limitClause = options.useCursor ? 'LIMIT ?' : 'LIMIT ? OFFSET ?';

  const orderBy = options.useCursor
    ? 'rm.`id` ASC'
    : buildFallbackOrderBy(columns, 'rm', 'reply_time');

  return `
    SELECT
      ${cursorSelect}
      ${rowIdSelect}
      ${messageIdSelect}
      CAST(rm.moment_id AS CHAR(191)) AS moment_id,
      ${replayMessageIdSelect}
      CAST(rm.send_id AS CHAR(191)) AS send_id,
      CAST(rm.is_agent AS CHAR(32)) AS is_agent,
      CAST(rm.comment_content AS CHAR) AS content,
      ${replyRoundSelect}
      ${topMessageIdSelect}
      ${replyTimeSelect}
    FROM \`${REPLAY_MESSAGE_TABLE}\` rm
    WHERE ${buildReplayMessageWhereClause(columns, options.requireContent)}
    ${cursorWhere}
    ORDER BY ${orderBy}
    ${limitClause}
  `;
}

function buildReplayMessageWhereClause(columns, requireContent) {
  const conditions = [
    'rm.moment_id IS NOT NULL',
    'rm.send_id IS NOT NULL',
    "TRIM(CAST(rm.moment_id AS CHAR)) <> ''",
    "TRIM(CAST(rm.send_id AS CHAR)) <> ''",
  ];

  if (requireContent) {
    conditions.push(
      'rm.comment_content IS NOT NULL',
      "TRIM(CAST(rm.comment_content AS CHAR)) <> ''"
    );
  }

  const logicalDeleteCondition = buildLogicalDeleteCondition(columns, 'rm');

  if (logicalDeleteCondition) {
    conditions.unshift(logicalDeleteCondition);
  }

  return conditions.join(' AND ');
}

function buildLogicalDeleteCondition(columns, tableAlias) {
  if (!columns.has('logical_del')) {
    return '';
  }

  return `COALESCE(${tableAlias}.logical_del, 0) = 0`;
}

function buildFallbackOrderBy(columns, tableAlias, timeColumn) {
  const orderParts = [];

  if (columns.has(timeColumn)) {
    orderParts.push(`${tableAlias}.\`${timeColumn}\` ASC`);
  }

  if (columns.has('id')) {
    orderParts.push(`${tableAlias}.\`id\` ASC`);
  }

  return orderParts.length > 0 ? orderParts.join(', ') : '1';
}

function buildMongoDocumentFromMomentCommentRow(row, targetMaps, stats) {
  const identity = buildMomentCommentIdentity(row);
  const legacyMomentId = normalizeString(row.moment_id);
  const content = normalizeString(row.content);

  if (!identity || !legacyMomentId || !content) {
    return null;
  }

  const replyTarget = findReplyTarget(
    normalizeString(row.replay_comment_id),
    targetMaps
  );
  const createdAt = normalizeDate(row.created_at) || new Date();
  const doc = {
    _id: identity.id,
    postId: buildObjectIdFromLegacyId(`post:${legacyMomentId}`),
    userId: identity.userId,
    type: 'user',
    content,
    createdAt,
    updatedAt: createdAt,
    legacy: {
      namespace: MIGRATION_NAMESPACE,
      source: MOMENT_COMMENT_TABLE,
      momentId: legacyMomentId,
      commentId: identity.legacyId,
      rowId: normalizeString(row.legacy_row_id),
      replayCommentId: normalizeString(row.replay_comment_id),
      topCommentId: normalizeString(row.top_comment_id),
      likeCount: normalizeNumber(row.like_count),
    },
  };

  applyReplyTarget(doc, replyTarget);
  if (normalizeString(row.replay_comment_id) && !replyTarget) {
    stats.missingReplyTargets += 1;
  }

  return doc;
}

function buildMongoDocumentFromReplayMessageRow(row, targetMaps, stats) {
  const identity = buildReplayMessageIdentity(row);
  const legacyMomentId = normalizeString(row.moment_id);
  const content = normalizeString(row.content);

  if (!identity || !legacyMomentId || !content) {
    return null;
  }

  const replyTarget = findReplyTarget(
    normalizeString(row.replay_message_id),
    targetMaps
  );
  const createdAt = normalizeDate(row.created_at) || new Date();
  const doc = {
    _id: identity.id,
    postId: buildObjectIdFromLegacyId(`post:${legacyMomentId}`),
    type: identity.type,
    content,
    createdAt,
    updatedAt: createdAt,
    legacy: {
      namespace: MIGRATION_NAMESPACE,
      source: REPLAY_MESSAGE_TABLE,
      momentId: legacyMomentId,
      messageId: identity.legacyId,
      rowId: normalizeString(row.legacy_row_id),
      replayMessageId: normalizeString(row.replay_message_id),
      topMessageId: normalizeString(row.top_message_id),
      replyRound: normalizeNumber(row.reply_round),
      sendId: identity.legacyAuthorId,
      isAgent: identity.type === 'agent',
    },
  };

  if (identity.type === 'agent') {
    doc.agentId = identity.agentId;
  } else {
    doc.userId = identity.userId;
  }

  applyReplyTarget(doc, replyTarget);
  if (normalizeString(row.replay_message_id) && !replyTarget) {
    stats.missingReplyTargets += 1;
  }

  return doc;
}

function buildMomentCommentIdentity(row) {
  const legacyId =
    normalizeString(row.comment_id) || normalizeString(row.legacy_row_id);
  const legacyUserId = normalizeString(row.user_id);

  if (!legacyId || !legacyUserId) {
    return null;
  }

  return {
    id: buildObjectIdFromLegacyId(`post_comment:moment_comment:${legacyId}`),
    legacyId,
    legacyAuthorId: legacyUserId,
    type: 'user',
    userId: buildObjectIdFromLegacyId(legacyUserId),
  };
}

function buildReplayMessageIdentity(row) {
  const legacyId =
    normalizeString(row.message_id) || normalizeString(row.legacy_row_id);
  const legacyAuthorId = normalizeString(row.send_id);

  if (!legacyId || !legacyAuthorId) {
    return null;
  }

  if (isAgentReplayMessage(row)) {
    return {
      id: buildObjectIdFromLegacyId(`post_comment:replay_message:${legacyId}`),
      agentId: buildObjectIdFromLegacyId(`agent:${legacyAuthorId}`),
      legacyAuthorId,
      legacyId,
      type: 'agent',
    };
  }

  return {
    id: buildObjectIdFromLegacyId(`post_comment:replay_message:${legacyId}`),
    legacyAuthorId,
    legacyId,
    type: 'user',
    userId: buildObjectIdFromLegacyId(legacyAuthorId),
  };
}

function findReplyTarget(legacyId, targetMaps) {
  if (!legacyId) {
    return null;
  }

  return (
    targetMaps.replayMessageById.get(legacyId) ||
    targetMaps.momentCommentById.get(legacyId) ||
    null
  );
}

function applyReplyTarget(doc, replyTarget) {
  if (!replyTarget) {
    return;
  }

  doc.parentCommentId = replyTarget.id;

  if (replyTarget.type === 'agent') {
    doc.replyToAgentId = replyTarget.agentId;
  } else {
    doc.replyToUserId = replyTarget.userId;
  }
}

function isAgentReplayMessage(row) {
  const value = normalizeString(row.is_agent).toLowerCase();

  return value === '1' || value === 'true' || value === 'agent';
}

function normalizeNumber(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function readBooleanEnv(name, fallback) {
  const value = readEnv(name, '');

  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
