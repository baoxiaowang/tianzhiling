import { MongoClient, Db } from 'mongodb';
import { Pool, PoolOptions, createPool } from 'mysql2/promise';
import { loadEnvFiles } from './utils/env';

export interface TransferLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export interface TransferContext {
  mysql: Pool;
  mongoClient: MongoClient;
  mongoDb: Db;
  logger: TransferLogger;
}

export interface MysqlTransferContext {
  mysql: Pool;
  logger: TransferLogger;
}

export interface MongoTransferContext {
  mongoClient: MongoClient;
  mongoDb: Db;
  logger: TransferLogger;
}

export async function createTransferContext(): Promise<TransferContext> {
  loadEnvFiles();

  const logger = createLogger();
  const mysql = createMysqlPool();
  const mongoClient = new MongoClient(buildMongoUri());

  await mongoClient.connect();

  return {
    mysql,
    mongoClient,
    mongoDb: mongoClient.db(readEnv('TRANSFER_MONGO_DATABASE', 'tzl')),
    logger,
  };
}

export async function createMysqlTransferContext(): Promise<MysqlTransferContext> {
  loadEnvFiles();

  return {
    mysql: createMysqlPool(),
    logger: createLogger(),
  };
}

export async function createMongoTransferContext(): Promise<MongoTransferContext> {
  loadEnvFiles();

  const mongoClient = new MongoClient(buildMongoUri());

  await mongoClient.connect();

  return {
    mongoClient,
    mongoDb: mongoClient.db(readEnv('TRANSFER_MONGO_DATABASE', 'tzl')),
    logger: createLogger(),
  };
}

export async function closeTransferConnections(
  context: TransferContext
): Promise<void> {
  await context.mysql.end();
  await context.mongoClient.close();
}

export async function closeMysqlTransferConnection(
  context: MysqlTransferContext
): Promise<void> {
  await context.mysql.end();
}

export async function closeMongoTransferConnection(
  context: MongoTransferContext
): Promise<void> {
  await context.mongoClient.close();
}

function createMysqlPool(): Pool {
  return createPool(buildMysqlPoolOptions());
}

function buildMysqlPoolOptions(): PoolOptions {
  const jdbcUrl = readEnv('TRANSFER_MYSQL_JDBC_URL', '').trim();
  const parsedJdbcUrl = jdbcUrl ? parseMysqlJdbcUrl(jdbcUrl) : {};

  return {
    ...parsedJdbcUrl.options,
    host: readEnv('TRANSFER_MYSQL_HOST', parsedJdbcUrl.host || '127.0.0.1'),
    port: readNumberEnv('TRANSFER_MYSQL_PORT', parsedJdbcUrl.port || 3306),
    user: readEnv('TRANSFER_MYSQL_USER', 'root'),
    password: readEnv('TRANSFER_MYSQL_PASSWORD', ''),
    database: readEnv('TRANSFER_MYSQL_DATABASE', parsedJdbcUrl.database || ''),
    charset: readEnv('TRANSFER_MYSQL_CHARSET', parsedJdbcUrl.charset || 'utf8mb4'),
    timezone: readEnv('TRANSFER_MYSQL_TIMEZONE', parsedJdbcUrl.timezone || '+08:00'),
    waitForConnections: true,
    connectionLimit: readNumberEnv('TRANSFER_MYSQL_CONNECTION_LIMIT', 5),
  };
}

function parseMysqlJdbcUrl(jdbcUrl: string): {
  host?: string;
  port?: number;
  database?: string;
  charset?: string;
  timezone?: string;
  options?: PoolOptions;
} {
  const normalized = jdbcUrl.replace(/^jdbc:/i, '');

  if (!normalized.startsWith('mysql://')) {
    throw new Error('TRANSFER_MYSQL_JDBC_URL must be a jdbc:mysql:// URL');
  }

  const url = new URL(normalized);
  const serverTimezone = url.searchParams.get('serverTimezone') || undefined;
  const charset =
    url.searchParams.get('characterEncoding') ||
    url.searchParams.get('connectionCollation') ||
    undefined;

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
    charset: normalizeMysqlCharset(charset),
    timezone: normalizeMysqlTimezone(serverTimezone),
    options: {
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: false,
    },
  };
}

function normalizeMysqlCharset(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase().replace(/-/g, '');

  if (normalized === 'utf8') {
    return 'utf8mb4';
  }

  return value;
}

function normalizeMysqlTimezone(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value === 'Asia/Shanghai') {
    return '+08:00';
  }

  return value;
}

function buildMongoUri(): string {
  const host = readEnv('TRANSFER_MONGO_HOST', '127.0.0.1');
  const port = readEnv('TRANSFER_MONGO_PORT', '17271');
  const username = readEnv('TRANSFER_MONGO_USERNAME', 'admin');
  const password = readEnv('TRANSFER_MONGO_PASSWORD', 'qwerasdf');
  const database = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const authSource = readEnv('TRANSFER_MONGO_AUTH_SOURCE', 'admin');

  return `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(
    password
  )}@${host}:${port}/${database}?authSource=${encodeURIComponent(authSource)}`;
}

function createLogger(): TransferLogger {
  return {
    info: (message, meta) => writeLog('INFO', message, meta),
    warn: (message, meta) => writeLog('WARN', message, meta),
    error: (message, meta) => writeLog('ERROR', message, meta),
  };
}

function writeLog(level: string, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const suffix = meta == null ? '' : ` ${JSON.stringify(meta)}`;

  console.log(`[${timestamp}] [${level}] ${message}${suffix}`);
}

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];

  return value == null || value === '' ? fallback : value;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}
