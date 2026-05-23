import { MongoClient, Db } from 'mongodb';
import { Pool, createPool } from 'mysql2/promise';
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

export async function closeTransferConnections(
  context: TransferContext
): Promise<void> {
  await context.mysql.end();
  await context.mongoClient.close();
}

function createMysqlPool(): Pool {
  return createPool({
    host: readEnv('TRANSFER_MYSQL_HOST', '127.0.0.1'),
    port: readNumberEnv('TRANSFER_MYSQL_PORT', 3306),
    user: readEnv('TRANSFER_MYSQL_USER', 'root'),
    password: readEnv('TRANSFER_MYSQL_PASSWORD', ''),
    database: readEnv('TRANSFER_MYSQL_DATABASE', ''),
    waitForConnections: true,
    connectionLimit: readNumberEnv('TRANSFER_MYSQL_CONNECTION_LIMIT', 5),
  });
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
