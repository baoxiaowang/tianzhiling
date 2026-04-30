import { MidwayConfig } from '@midwayjs/core';
import { resolve } from 'path';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';
import {
  AdminAccountEntity,
  AdminUserEntity,
  AgentEntity,
  AgentSubEntity,
  ConversationEntity,
  CouponLedgerEntity,
  MessageEntity,
  OrderEntity,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostEntity,
  UserAccountEntity,
  UserEntitlementEntity,
  UserEntity,
  UserMembershipEntity,
  VipPlanEntity,
} from '@tzl/entities';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

export default {
  keys: readStringFrom(
    ['ADMIN_API_APP_KEYS', 'NODE_APP_KEYS'],
    '1774073039411_5782'
  ),
  koa: {
    port: readNumberFrom(['ADMIN_API_PORT'], 7101),
    globalPrefix: '/admin_api',
  },
  jwt: {
    secret: readStringFrom(
      ['ADMIN_API_JWT_SECRET', 'NODE_JWT_SECRET'],
      '1774073039411_5782'
    ),
    sign: {
      expiresIn: readNumberFrom(
        ['ADMIN_API_JWT_EXPIRES_IN_SECONDS'],
        8 * 60 * 60
      ),
    },
    verify: {},
  },
  adminAuth: {
    account: readStringFrom(['ADMIN_API_ACCOUNT'], 'admin'),
    password: readStringFrom(['ADMIN_API_PASSWORD'], 'admin123456'),
    roles: readStringFrom(['ADMIN_API_ROLES'], 'admin')
      .split(',')
      .map(role => role.trim())
      .filter(Boolean),
  },
  oss: {
    enabled: readBooleanFrom(
      ['ADMIN_API_OSS_ENABLED', 'NODE_OSS_ENABLED'],
      false
    ),
    region: readStringFrom(['ADMIN_API_OSS_REGION', 'NODE_OSS_REGION'], ''),
    bucket: readStringFrom(['ADMIN_API_OSS_BUCKET', 'NODE_OSS_BUCKET'], ''),
    endpoint: readStringFrom(
      ['ADMIN_API_OSS_ENDPOINT', 'NODE_OSS_ENDPOINT'],
      ''
    ),
    publicBaseUrl: readStringFrom(
      ['ADMIN_API_OSS_PUBLIC_BASE_URL', 'NODE_OSS_PUBLIC_BASE_URL'],
      ''
    ),
    secure: readBooleanFrom(['ADMIN_API_OSS_SECURE', 'NODE_OSS_SECURE'], true),
  },
  tencentCos: {
    enabled: readBooleanFrom(
      ['ADMIN_API_TENCENT_COS_ENABLED', 'NODE_TENCENT_COS_ENABLED'],
      false
    ),
    region: readStringFrom(
      ['ADMIN_API_TENCENT_COS_REGION', 'NODE_TENCENT_COS_REGION'],
      ''
    ),
    bucket: readStringFrom(
      ['ADMIN_API_TENCENT_COS_BUCKET', 'NODE_TENCENT_COS_BUCKET'],
      ''
    ),
    protocol: readStringFrom(
      ['ADMIN_API_TENCENT_COS_PROTOCOL', 'NODE_TENCENT_COS_PROTOCOL'],
      'https'
    ),
    domain: readStringFrom(
      ['ADMIN_API_TENCENT_COS_DOMAIN', 'NODE_TENCENT_COS_DOMAIN'],
      ''
    ),
    publicBaseUrl: readStringFrom(
      [
        'ADMIN_API_TENCENT_COS_PUBLIC_BASE_URL',
        'NODE_TENCENT_COS_PUBLIC_BASE_URL',
      ],
      ''
    ),
  },
  typeorm: {
    dataSource: {
      default: {
        type: 'mongodb',
        database: readStringFrom(
          ['ADMIN_API_MONGO_DB', 'NODE_MONGO_DB', 'MONGO_DB'],
          'tzl'
        ),
        host: readStringFrom(
          ['ADMIN_API_MONGO_HOST', 'NODE_MONGO_HOST', 'MONGO_HOST'],
          '127.0.0.1'
        ),
        port: readNumberFrom(
          ['ADMIN_API_MONGO_PORT', 'NODE_MONGO_PORT', 'MONGO_PORT'],
          17271
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
        synchronize: readBooleanFrom(
          ['ADMIN_API_DB_SYNCHRONIZE'],
          process.env.NODE_ENV !== 'production'
        ),
        logging: readBooleanFrom(['ADMIN_API_DB_LOGGING'], false),
        entities: [
          AdminAccountEntity,
          AdminUserEntity,
          AgentEntity,
          AgentSubEntity,
          ConversationEntity,
          CouponLedgerEntity,
          MessageEntity,
          OrderEntity,
          PostCommentEntity,
          PostCommentNotificationEntity,
          PostEntity,
          UserAccountEntity,
          UserEntitlementEntity,
          UserEntity,
          UserMembershipEntity,
          VipPlanEntity,
        ],
      },
    },
  },
} as MidwayConfig;
