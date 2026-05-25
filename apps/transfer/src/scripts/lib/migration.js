const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { BSON, ObjectId } = require('mongodb');

const MIGRATION_NAMESPACE = 'legacy_mysql';

function buildObjectIdFromLegacyId(value) {
  const hex = createHash('sha256')
    .update(`${MIGRATION_NAMESPACE}:${value}`)
    .digest('hex')
    .slice(0, 24);

  return new ObjectId(hex);
}

function mapRowFields(row, fieldMapList) {
  const document = {};

  for (const [sourceField, targetField, type, options] of fieldMapList) {
    const value =
      typeof sourceField === 'function'
        ? sourceField(row)
        : row[getSourceFieldAlias(sourceField)];
    const transformedValue =
      typeof options === 'function' ? options(value, row) : value;
    const mappedValue = convertFieldValue(
      transformedValue,
      type,
      typeof options === 'function' ? {} : options,
      row
    );

    if (
      mappedValue === undefined &&
      (typeof options === 'function' || options?.omitUndefined !== false)
    ) {
      continue;
    }

    setPathValue(document, targetField, mappedValue);
  }

  return document;
}

function createTableMapping(options) {
  return {
    buildDocument(row) {
      return mapRowFields(row, options.fieldMapList);
    },
    buildDocumentFromMap(row, fieldMapList) {
      return mapRowFields(row, fieldMapList);
    },
    async fetchRows(context, pagination) {
      return fetchLegacyRows(context, {
        fieldMapList: options.fieldMapList,
        joins: options.joins,
        limit: pagination.limit,
        offset: pagination.offset,
        oldTable: options.oldTable,
        orderBy: options.orderBy,
        where: options.where,
      });
    },
    fieldMapList: options.fieldMapList,
    newTable: options.newTable,
    oldTable: options.oldTable,
  };
}

function createLegacyTableExporter(options) {
  const source = buildLegacyTableSource(options.source);
  const fieldMapList =
    options.fieldMapList || collectCollectionFieldMapList(options.collections);
  const tableMapping = createTableMapping({
    fieldMapList,
    joins: source.joins,
    oldTable: source.oldTable,
    orderBy: source.orderBy,
    where: source.where,
  });

  return {
    buildDocument(row) {
      return tableMapping.buildDocument(row);
    },
    buildDocumentFromMap(row, collectionFieldMapList) {
      return tableMapping.buildDocumentFromMap(row, collectionFieldMapList);
    },
    async exportToBson(context, exportOptions) {
      const dbDumpPath =
        exportOptions.dbDumpPath ||
        path.join(exportOptions.dumpPath, exportOptions.dbName);

      return exportMappedCollectionsToBson(context, {
        batchSize: exportOptions.batchSize,
        collections: normalizeExportCollections(
          options.collections,
          tableMapping
        ),
        dbDumpPath,
        dbName: exportOptions.dbName,
        dumpPath: exportOptions.dumpPath,
        logPrefix: options.logPrefix,
        skippedStatNames: buildSkippedStatNames(
          options.collections,
          options.skippedStatNames
        ),
        tableMapping,
      });
    },
    tableMapping,
  };
}

function buildLegacyTableSource(source) {
  const alias = source.alias || '';
  const oldTable = source.oldTable || [source.table, alias].filter(Boolean).join(' ');
  const where = [...(source.where || [])];
  const logicalDelete = source.logicalDelete;

  if (logicalDelete !== false) {
    const logicalDeleteField =
      logicalDelete?.field || source.logicalDeleteField || 'logical_del';
    const qualifier = logicalDelete?.qualifier || alias || source.table;
    const fieldName = qualifier
      ? `${qualifier}.${logicalDeleteField}`
      : logicalDeleteField;

    where.push(`COALESCE(${fieldName}, 0) = 0`);
  }

  return {
    joins: source.joins || [],
    oldTable,
    orderBy: source.orderBy || buildLegacyOrderBy(source, alias),
    where,
  };
}

function buildLegacyOrderBy(source, alias) {
  if (!source.primaryKey) {
    return undefined;
  }

  return `${alias ? `${alias}.` : ''}${source.primaryKey} ASC`;
}

function collectCollectionFieldMapList(collections) {
  const fieldMapList = [];

  for (const collection of collections) {
    fieldMapList.push(...(collection.fieldMapList || []));
  }

  return fieldMapList;
}

function normalizeExportCollections(collections, tableMapping) {
  return collections.map(collection => ({
    ...collection,
    buildDocument(row) {
      if (collection.skipIf?.(row)) {
        return undefined;
      }

      if (collection.buildDocument) {
        return collection.buildDocument(row, tableMapping);
      }

      const document = tableMapping.buildDocumentFromMap(
        row,
        collection.fieldMapList
      );

      return collection.skipDocument?.(document, row) ? undefined : document;
    },
  }));
}

function buildSkippedStatNames(collections, skippedStatNames = []) {
  return [
    ...new Set([
      ...skippedStatNames,
      ...collections
        .map(collection => collection.skippedStatName)
        .filter(Boolean),
    ]),
  ];
}

function createBsonDumpWriter(options) {
  const collectionStreams = new Map();

  for (const collectionName of options.collectionNames) {
    writeMetadata(options.dbDumpPath, collectionName);
    collectionStreams.set(
      collectionName,
      fs.createWriteStream(path.join(options.dbDumpPath, `${collectionName}.bson`))
    );
  }

  return {
    write(collectionName, document) {
      const stream = collectionStreams.get(collectionName);

      if (!stream) {
        throw new Error(`unknown bson dump collection: ${collectionName}`);
      }

      stream.write(BSON.serialize(document));
    },
    async close() {
      await Promise.all([...collectionStreams.values()].map(closeWriteStream));
    },
  };
}

async function exportMappedCollectionsToBson(context, options) {
  const stats = {
    scanned: 0,
  };
  let offset = 0;

  ensureParentDir(path.join(options.dbDumpPath, `${options.collections[0].name}.bson`));

  for (const collection of options.collections) {
    stats[collection.statName || `exported${collection.name}`] = 0;
  }

  for (const skippedStatName of options.skippedStatNames || []) {
    stats[skippedStatName] = 0;
  }

  context.logger.info(`${options.logPrefix} bson export started`, {
    batchSize: options.batchSize,
    dumpPath: options.dumpPath,
    dbName: options.dbName,
  });

  const writer = createBsonDumpWriter({
    collectionNames: options.collections.map(collection => collection.name),
    dbDumpPath: options.dbDumpPath,
  });

  try {
    for (;;) {
      const rows = await options.tableMapping.fetchRows(context, {
        limit: options.batchSize,
        offset,
      });

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        stats.scanned += 1;

        for (const collection of options.collections) {
          const document = collection.buildDocument(row);

          if (!document) {
            if (collection.skippedStatName) {
              stats[collection.skippedStatName] += 1;
            }

            if (collection.skipMessage) {
              context.logger.warn(collection.skipMessage, collection.buildSkipMeta?.(row));
            }

            continue;
          }

          writer.write(collection.name, document);
          stats[collection.statName || `exported${collection.name}`] += 1;
        }
      }

      offset += rows.length;
      context.logger.info(`${options.logPrefix} bson export batch completed`, {
        scanned: stats.scanned,
        offset,
      });

      if (rows.length < options.batchSize) {
        break;
      }
    }
  } finally {
    await writer.close();
  }

  context.logger.info(`${options.logPrefix} bson export completed`, {
    ...stats,
    dumpPath: options.dumpPath,
    dbName: options.dbName,
  });

  return stats;
}

async function fetchLegacyRows(context, options) {
  const selectClause = buildSelectClause(options.fieldMapList);
  const joins = options.joins?.length ? `\n${options.joins.join('\n')}` : '';
  const where = options.where?.length
    ? `\nWHERE ${options.where.join(' AND ')}`
    : '';
  const orderBy = options.orderBy ? `\nORDER BY ${options.orderBy}` : '';
  const [rows] = await context.mysql.query(
    `
      SELECT
        ${selectClause}
      FROM ${options.oldTable}${joins}${where}${orderBy}
      LIMIT ? OFFSET ?
    `,
    [options.limit, options.offset]
  );

  return rows;
}

function buildSelectClause(fieldMapList) {
  const seen = new Set();
  const selectItems = [];

  for (const [sourceField] of fieldMapList) {
    const selectItem = buildSelectItem(sourceField);

    if (!selectItem || seen.has(selectItem.alias)) {
      continue;
    }

    seen.add(selectItem.alias);
    selectItems.push(`${selectItem.expr} AS ${quoteIdentifier(selectItem.alias)}`);
  }

  if (selectItems.length === 0) {
    throw new Error('fieldMapList does not contain selectable fields');
  }

  return selectItems.join(',\n        ');
}

function buildSelectItem(sourceField) {
  if (typeof sourceField === 'function') {
    return null;
  }

  if (typeof sourceField === 'string') {
    return {
      alias: sourceField,
      expr: quoteDottedIdentifier(sourceField),
    };
  }

  if (sourceField?.expr && sourceField?.alias) {
    return {
      alias: sourceField.alias,
      expr: sourceField.expr,
    };
  }

  throw new Error(`unsupported source field: ${JSON.stringify(sourceField)}`);
}

function convertFieldValue(value, type, options = {}, row) {
  if (type === 'ObjectId') {
    const normalized = normalizeString(value);

    return normalized ? buildObjectIdFromLegacyId(normalized) : undefined;
  }

  if (type === 'ObjectId:agent') {
    const normalized = normalizeString(value);

    return normalized
      ? buildObjectIdFromLegacyId(`agent:${normalized}`)
      : undefined;
  }

  if (type === 'string') {
    const normalized = normalizeString(value);

    return normalized || options.defaultValue || '';
  }

  if (type === 'number') {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : options.defaultValue;
  }

  if (type === 'boolean') {
    return Boolean(value);
  }

  if (type === 'date') {
    return normalizeDate(value) || options.defaultValue || new Date();
  }

  if (type === 'optionalDate') {
    return normalizeDate(value);
  }

  if (type === 'raw') {
    return value;
  }

  if (typeof type === 'function') {
    return type(value, row, options);
  }

  throw new Error(`unsupported field map type: ${type}`);
}

function writeMetadata(dbDumpPath, collectionName) {
  ensureParentDir(path.join(dbDumpPath, `${collectionName}.metadata.json`));
  fs.writeFileSync(
    path.join(dbDumpPath, `${collectionName}.metadata.json`),
    JSON.stringify(
      {
        options: {},
        indexes: [
          {
            v: 2,
            key: {
              _id: 1,
            },
            name: '_id_',
          },
        ],
      },
      null,
      2
    )
  );
}

async function importBsonCollection(context, options) {
  const collection = context.mongoDb.collection(options.collectionName);
  const stats = {
    scanned: 0,
    inserted: 0,
    replaced: 0,
  };
  let batch = [];

  for await (const doc of readBsonDocuments(options.bsonPath)) {
    stats.scanned += 1;
    batch.push({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: doc,
        upsert: true,
      },
    });

    if (batch.length >= options.batchSize) {
      await flushBulkWrite(collection, batch, stats);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await flushBulkWrite(collection, batch, stats);
  }

  return stats;
}

async function flushBulkWrite(collection, batch, stats) {
  const result = await collection.bulkWrite(batch, { ordered: false });

  stats.inserted += result.upsertedCount;
  stats.replaced += result.modifiedCount;
}

async function* readBsonDocuments(bsonPath) {
  const handle = await fs.promises.open(bsonPath, 'r');
  let offset = 0;

  try {
    for (;;) {
      const lengthBuffer = Buffer.alloc(4);
      const lengthResult = await handle.read(lengthBuffer, 0, 4, offset);

      if (lengthResult.bytesRead === 0) {
        return;
      }

      if (lengthResult.bytesRead < 4) {
        throw new Error(`invalid bson length header in ${bsonPath}`);
      }

      const documentLength = lengthBuffer.readInt32LE(0);

      if (documentLength < 5) {
        throw new Error(`invalid bson document length ${documentLength}`);
      }

      const documentBuffer = Buffer.alloc(documentLength);
      lengthBuffer.copy(documentBuffer, 0);

      const bodyResult = await handle.read(
        documentBuffer,
        4,
        documentLength - 4,
        offset + 4
      );

      if (bodyResult.bytesRead < documentLength - 4) {
        throw new Error(`truncated bson document in ${bsonPath}`);
      }

      offset += documentLength;
      yield BSON.deserialize(documentBuffer);
    }
  } finally {
    await handle.close();
  }
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function closeWriteStream(stream) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

function normalizeString(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);

    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);

    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }

  return undefined;
}

function readMode(options) {
  const mode = (
    process.argv[2] ||
    process.env[options.envName] ||
    options.defaultValue ||
    'all'
  ).trim();

  if (options.allowedValues.includes(mode)) {
    return mode;
  }

  throw new Error(
    `${options.envName} must be one of: ${options.allowedValues.join(', ')}`
  );
}

function resolveDumpPath(options) {
  const rawPath =
    process.argv[3] ||
    firstNonEmptyEnv(options.envNames || []) ||
    options.defaultPath;

  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

function readEnv(name, fallback) {
  const value = process.env[name];

  return value == null || value === '' ? fallback : value;
}

function readNumberEnv(name, fallback) {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function firstNonEmptyEnv(names) {
  for (const name of names) {
    if (process.env[name]) {
      return process.env[name];
    }
  }

  return '';
}

function getSourceFieldAlias(sourceField) {
  if (typeof sourceField === 'string') {
    return sourceField;
  }

  if (sourceField?.alias) {
    return sourceField.alias;
  }

  throw new Error(`unsupported source field: ${JSON.stringify(sourceField)}`);
}

function quoteDottedIdentifier(value) {
  return String(value)
    .split('.')
    .map(part => quoteIdentifier(part))
    .join('.');
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function setPathValue(target, pathValue, value) {
  const segments = String(pathValue).split('.');
  let cursor = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];

    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }

    cursor = cursor[segment];
  }

  cursor[segments[segments.length - 1]] = value;
}

module.exports = {
  BSON,
  MIGRATION_NAMESPACE,
  buildObjectIdFromLegacyId,
  closeWriteStream,
  createBsonDumpWriter,
  createLegacyTableExporter,
  createTableMapping,
  ensureParentDir,
  exportMappedCollectionsToBson,
  fetchLegacyRows,
  importBsonCollection,
  mapRowFields,
  normalizeDate,
  normalizeString,
  readEnv,
  readBsonDocuments,
  readMode,
  readNumberEnv,
  resolveDumpPath,
  writeMetadata,
};
