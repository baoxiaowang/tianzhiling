import { MidwayConfig } from '@midwayjs/core';
import { readBooleanFrom, readNumberFrom, readStringFrom } from '@tzl/shared';

export default {
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
