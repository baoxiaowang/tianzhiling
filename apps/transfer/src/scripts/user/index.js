require('ts-node/register');

const path = require('path');
const {
  closeMysqlTransferConnection,
  createMysqlTransferContext,
} = require('../../runtime');
const {
  MIGRATION_NAMESPACE,
  createLegacyTableExporter,
  readEnv,
  readMode,
  readNumberEnv,
  resolveDumpPath,
  normalizeString,
} = require('../lib/migration');

const DEFAULT_BATCH_SIZE = 500;
const USER_COLLECTION = 'user';
const USER_ACCOUNT_COLLECTION = 'user_account';
const USER_SOURCE_JOINS = [
  `LEFT JOIN user_login ul
        ON ul.user_id = ui.user_id
        AND COALESCE(ul.logical_del, 0) = 0`,
];
const USER_FIELD_MAP = [
  [{ expr: 'ui.user_id', alias: 'user_id' }, '_id', 'ObjectId'],
  [
    { expr: 'ui.user_name', alias: 'name' },
    'name',
    'string',
    (value, row) =>
      normalizeString(value) ||
      normalizeString(row.legal_name) ||
      normalizeString(row.login_phone) ||
      normalizeString(row.info_phone) ||
      `用户${normalizeString(row.user_id)}`,
  ],
  [{ expr: 'ui.user_img', alias: 'user_img' }, 'avatar', 'string'],
  [
    { expr: 'ul.phone', alias: 'login_phone' },
    'phone',
    'string',
    (value, row) => normalizeString(value) || normalizeString(row.info_phone),
  ],
  [
    { expr: 'ul.phone', alias: 'login_phone' },
    'phoneVerified',
    'boolean',
    (value, row) => normalizeString(value) || normalizeString(row.info_phone),
  ],
  [{ expr: 'ui.register_time', alias: 'register_time' }, 'createdAt', 'date'],
  [() => new Date(), 'updatedAt', 'date'],
  [() => MIGRATION_NAMESPACE, 'legacy.namespace', 'string'],
  [{ expr: 'ui.user_id', alias: 'user_id' }, 'legacy.userId', 'string'],
];
const USER_ACCOUNT_FIELD_MAP = [
  [row => `account:${normalizeString(row.user_id)}`, '_id', 'ObjectId'],
  [{ expr: 'ui.user_id', alias: 'user_id' }, 'userId', 'ObjectId'],
  [
    { expr: 'ul.phone', alias: 'login_phone' },
    'account',
    'string',
    (value, row) =>
      normalizeString(value) ||
      normalizeString(row.info_phone) ||
      normalizeString(row.open_id),
  ],
  [() => '', 'password', 'string'],
  [{ expr: 'ul.open_id', alias: 'open_id' }, 'openId', 'string'],
  [{ expr: 'ui.register_time', alias: 'register_time' }, 'createdAt', 'date'],
  [() => new Date(), 'updatedAt', 'date'],
  [() => MIGRATION_NAMESPACE, 'legacy.namespace', 'string'],
  [{ expr: 'ui.user_id', alias: 'user_id' }, 'legacy.userId', 'string'],
];
const USER_EXPORTER = createLegacyTableExporter({
  collections: [
    {
      fieldMapList: USER_FIELD_MAP,
      name: USER_COLLECTION,
      skipIf: row => !normalizeString(row.user_id),
      statName: 'exportedUsers',
    },
    {
      buildSkipMeta: row => ({
        legacyUserId: normalizeString(row.user_id),
      }),
      fieldMapList: USER_ACCOUNT_FIELD_MAP,
      name: USER_ACCOUNT_COLLECTION,
      skippedStatName: 'skippedAccounts',
      skipDocument: userAccount => !normalizeString(userAccount.account),
      skipIf: row => !normalizeString(row.user_id),
      skipMessage: '[user] skipped user_account without account',
      statName: 'exportedAccounts',
    },
  ],
  logPrefix: '[user]',
  source: {
    alias: 'ui',
    joins: USER_SOURCE_JOINS,
    primaryKey: 'user_id',
    table: 'user_info',
  },
});

async function main() {
  const mode = readMode({
    allowedValues: ['export'],
    defaultValue: 'export',
    envName: 'TRANSFER_USER_MODE',
  });
  const dumpPath = resolveDumpPath({
    defaultPath: path.resolve(__dirname, '../../../dump'),
    envNames: ['TRANSFER_USER_DUMP_PATH'],
  });

  if (mode === 'export') {
    await exportUsersToBson(dumpPath);
    return;
  }
}

async function exportUsersToBson(dumpPath) {
  const context = await createMysqlTransferContext();

  try {
    await exportUsers(context, dumpPath);
  } finally {
    await closeMysqlTransferConnection(context);
  }
}

async function exportUsers(context, dumpPath) {
  const batchSize = readNumberEnv('TRANSFER_USER_BATCH_SIZE', DEFAULT_BATCH_SIZE);
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');

  await USER_EXPORTER.exportToBson(context, {
    batchSize,
    dbName,
    dumpPath,
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
