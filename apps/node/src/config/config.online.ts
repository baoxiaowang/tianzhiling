import { MidwayConfig } from '@midwayjs/core';
import { readRequiredStringFrom } from '@tzl/shared';

const ONLINE_HOST = '1.13.18.200';

const ONLINE_REDIS_PORT = 17380;
const ONLINE_REDIS_PASSWORD = '';
const ONLINE_REDIS_DB = 0;

const ONLINE_MONGO_PORT = 17271;
const ONLINE_MONGO_DB = 'tzl';
const ONLINE_MONGO_AUTH_SOURCE = 'admin';
const ONLINE_MONGO_USERNAME = 'admin';
const ONLINE_MONGO_PASSWORD = readRequiredStringFrom([
  'NODE_MONGO_PASSWORD',
  'MONGO_PASSWORD',
]);

export default {
  koa: {
    port: 7001,
  },
  milvus: {
    enabled: false,
  },
  redis: {
    client: {
      host: ONLINE_HOST,
      port: ONLINE_REDIS_PORT,
      password: ONLINE_REDIS_PASSWORD,
      db: ONLINE_REDIS_DB,
    },
  },
  bullmq: {
    defaultConnection: {
      host: ONLINE_HOST,
      port: ONLINE_REDIS_PORT,
      password: ONLINE_REDIS_PASSWORD,
      db: ONLINE_REDIS_DB,
    },
  },
  typeorm: {
    dataSource: {
      default: {
        database: ONLINE_MONGO_DB,
        host: ONLINE_HOST,
        port: ONLINE_MONGO_PORT,
        authSource: ONLINE_MONGO_AUTH_SOURCE,
        username: ONLINE_MONGO_USERNAME,
        password: ONLINE_MONGO_PASSWORD,
        synchronize: false,
        logging: false,
      },
    },
  },
} as MidwayConfig;
