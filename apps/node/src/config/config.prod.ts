import { MidwayConfig } from '@midwayjs/core';

function readStringFrom(names: string[], fallback: string): string {
  for (const name of names) {
    const raw = process.env[name];

    if (raw != null) {
      return raw;
    }
  }

  return fallback;
}

function readNumberFrom(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];

    if (!raw) {
      continue;
    }

    const parsed = Number(raw);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function readBooleanFrom(names: string[], fallback: boolean): boolean {
  for (const name of names) {
    const raw = process.env[name];

    if (!raw) {
      continue;
    }

    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }

  return fallback;
}

const redisHost = readStringFrom(['NODE_REDIS_HOST'], 'tzl_redis');
const redisPort = readNumberFrom(['NODE_REDIS_PORT'], 6379);
const redisPassword = readStringFrom(['NODE_REDIS_PASSWORD'], '');
const redisDb = readNumberFrom(['NODE_REDIS_DB'], 0);

export default {
  milvus: {
    enabled: readBooleanFrom(['NODE_MILVUS_ENABLED'], true),
    address: readStringFrom(['NODE_MILVUS_ADDRESS'], 'standalone:19530'),
  },
  redis: {
    client: {
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      db: redisDb,
    },
  },
  bullmq: {
    defaultConnection: {
      host: readStringFrom(['NODE_BULLMQ_HOST'], redisHost),
      port: readNumberFrom(['NODE_BULLMQ_PORT'], redisPort),
      password: readStringFrom(['NODE_BULLMQ_PASSWORD'], redisPassword),
      db: readNumberFrom(['NODE_BULLMQ_DB'], redisDb),
    },
  },
  typeorm: {
    dataSource: {
      default: {
        database: readStringFrom(['NODE_MONGO_DB'], 'tzl'),
        host: readStringFrom(['NODE_MONGO_HOST'], 'tzl_mongo'),
        port: readNumberFrom(['NODE_MONGO_PORT'], 27017),
        authSource: readStringFrom(['NODE_MONGO_AUTH_SOURCE'], 'admin'),
        username: readStringFrom(['NODE_MONGO_USERNAME'], 'admin'),
        password: readStringFrom(['NODE_MONGO_PASSWORD'], 'qwerasdf'),
        synchronize: readBooleanFrom(['NODE_DB_SYNCHRONIZE'], false),
        logging: readBooleanFrom(['NODE_DB_LOGGING'], false),
      },
    },
  },
} as MidwayConfig;
