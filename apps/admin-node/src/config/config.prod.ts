import { MidwayConfig } from '@midwayjs/core';
import { readBooleanFrom, readNumberFrom, readStringFrom } from '@tzl/shared';

const redisHost = readStringFrom(
  ['ADMIN_API_REDIS_HOST', 'NODE_REDIS_HOST'],
  'tzl_redis'
);
const redisPort = readNumberFrom(
  ['ADMIN_API_REDIS_PORT', 'NODE_REDIS_PORT'],
  6379
);
const redisPassword = readStringFrom(
  ['ADMIN_API_REDIS_PASSWORD', 'NODE_REDIS_PASSWORD'],
  ''
);
const redisDb = readNumberFrom(['ADMIN_API_REDIS_DB', 'NODE_REDIS_DB'], 0);

export default {
  bullmq: {
    defaultConnection: {
      host: readStringFrom(
        ['ADMIN_API_BULLMQ_HOST', 'NODE_BULLMQ_HOST'],
        redisHost
      ),
      port: readNumberFrom(
        ['ADMIN_API_BULLMQ_PORT', 'NODE_BULLMQ_PORT'],
        redisPort
      ),
      password: readStringFrom(
        ['ADMIN_API_BULLMQ_PASSWORD', 'NODE_BULLMQ_PASSWORD'],
        redisPassword
      ),
      db: readNumberFrom(['ADMIN_API_BULLMQ_DB', 'NODE_BULLMQ_DB'], redisDb),
    },
  },
  typeorm: {
    dataSource: {
      default: {
        database: readStringFrom(
          ['ADMIN_API_MONGO_DB', 'NODE_MONGO_DB', 'MONGO_DB'],
          'tzl'
        ),
        host: readStringFrom(
          ['ADMIN_API_MONGO_HOST', 'NODE_MONGO_HOST', 'MONGO_HOST'],
          'tzl_mongo'
        ),
        port: readNumberFrom(
          ['ADMIN_API_MONGO_PORT', 'NODE_MONGO_PORT', 'MONGO_PORT'],
          27017
        ),
        authSource: readStringFrom(
          [
            'ADMIN_API_MONGO_AUTH_SOURCE',
            'NODE_MONGO_AUTH_SOURCE',
            'MONGO_AUTH_SOURCE',
          ],
          'admin'
        ),
        username: readStringFrom(
          ['ADMIN_API_MONGO_USERNAME', 'NODE_MONGO_USERNAME', 'MONGO_USERNAME'],
          'admin'
        ),
        password: readStringFrom(
          ['ADMIN_API_MONGO_PASSWORD', 'NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'],
          'qwerasdf'
        ),
        synchronize: readBooleanFrom(['ADMIN_API_DB_SYNCHRONIZE'], false),
        logging: readBooleanFrom(['ADMIN_API_DB_LOGGING'], false),
      },
    },
  },
} as MidwayConfig;
