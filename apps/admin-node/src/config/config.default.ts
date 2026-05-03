import { MidwayConfig } from '@midwayjs/core';
import { resolve } from 'path';
import { tmpdir } from 'os';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';
import {
  AdminAccountEntity,
  AdminUserEntity,
  AgentEntitlementEntity,
  AgentEntity,
  AgentMembershipEntity,
  AgentSubEntity,
  ConversationEntity,
  CouponLedgerEntity,
  MessageEntity,
  OrderEntity,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostEntity,
  UserAccountEntity,
  UserEntity,
  VipPlanEntity,
  VoiceTimbreEntity,
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
  busboy: {
    mode: 'file',
    tmpdir: resolve(tmpdir(), 'tianzhiling-admin-node-upload'),
    cleanTimeout: 5 * 60 * 1000,
    whitelist: ['.mp3', '.m4a', '.wav', '.mp4'],
    match: /\/admin_api\/storage\/cos\/upload$/,
    limits: {
      fileSize: 200 * 1024 * 1024,
      files: 1,
    },
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
    secretId: readStringFrom(
      ['ADMIN_API_TENCENT_COS_SECRET_ID', 'NODE_TENCENT_COS_SECRET_ID'],
      ''
    ),
    secretKey: readStringFrom(
      ['ADMIN_API_TENCENT_COS_SECRET_KEY', 'NODE_TENCENT_COS_SECRET_KEY'],
      ''
    ),
    securityToken: readStringFrom(
      [
        'ADMIN_API_TENCENT_COS_SECURITY_TOKEN',
        'NODE_TENCENT_COS_SECURITY_TOKEN',
      ],
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
  minimaxVoice: {
    enabled: readBooleanFrom(
      ['ADMIN_API_MINIMAX_VOICE_ENABLED', 'NODE_MINIMAX_VOICE_ENABLED'],
      true
    ),
    apiKey: readStringFrom(
      [
        'ADMIN_API_MINIMAX_VOICE_API_KEY',
        'NODE_MINIMAX_VOICE_API_KEY',
        'NODE_MINIMAX_API_KEY',
      ],
      ''
    ),
    baseURL: readStringFrom(
      ['ADMIN_API_MINIMAX_VOICE_BASE_URL', 'NODE_MINIMAX_VOICE_BASE_URL'],
      'https://api.minimax.io'
    ),
    defaultPreviewModel: readStringFrom(
      [
        'ADMIN_API_MINIMAX_VOICE_PREVIEW_MODEL',
        'NODE_MINIMAX_VOICE_PREVIEW_MODEL',
      ],
      'speech-2.8-turbo'
    ),
    timeoutMs: readNumberFrom(
      ['ADMIN_API_MINIMAX_VOICE_TIMEOUT_MS', 'NODE_MINIMAX_VOICE_TIMEOUT_MS'],
      120000
    ),
  },
  bullmq: {
    defaultConnection: {
      host: readStringFrom(
        [
          'ADMIN_API_BULLMQ_HOST',
          'NODE_BULLMQ_HOST',
          'NODE_REDIS_HOST',
          'REDIS_HOST',
        ],
        '127.0.0.1'
      ),
      port: readNumberFrom(
        [
          'ADMIN_API_BULLMQ_PORT',
          'NODE_BULLMQ_PORT',
          'NODE_REDIS_PORT',
          'REDIS_PORT',
        ],
        17380
      ),
      password: readStringFrom(
        [
          'ADMIN_API_BULLMQ_PASSWORD',
          'NODE_BULLMQ_PASSWORD',
          'NODE_REDIS_PASSWORD',
          'REDIS_PASSWORD',
        ],
        ''
      ),
      db: readNumberFrom(
        ['ADMIN_API_BULLMQ_DB', 'NODE_BULLMQ_DB', 'NODE_REDIS_DB', 'REDIS_DB'],
        0
      ),
    },
    defaultPrefix: readStringFrom(
      ['ADMIN_API_BULLMQ_PREFIX', 'NODE_BULLMQ_PREFIX'],
      '{tzl-admin-bullmq}'
    ),
    defaultQueueOptions: {
      defaultJobOptions: {
        removeOnComplete: readNumberFrom(
          [
            'ADMIN_API_BULLMQ_REMOVE_ON_COMPLETE',
            'NODE_BULLMQ_REMOVE_ON_COMPLETE',
          ],
          100
        ),
        removeOnFail: readNumberFrom(
          ['ADMIN_API_BULLMQ_REMOVE_ON_FAIL', 'NODE_BULLMQ_REMOVE_ON_FAIL'],
          500
        ),
      },
    },
  },
  ffmpeg: {
    binaryPath: readStringFrom(
      ['ADMIN_API_FFMPEG_BINARY_PATH', 'NODE_FFMPEG_BINARY_PATH'],
      'ffmpeg'
    ),
    timeoutMs: readNumberFrom(
      ['ADMIN_API_FFMPEG_TIMEOUT_MS', 'NODE_FFMPEG_TIMEOUT_MS'],
      120000
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
          AgentEntitlementEntity,
          AgentEntity,
          AgentMembershipEntity,
          AgentSubEntity,
          ConversationEntity,
          CouponLedgerEntity,
          MessageEntity,
          OrderEntity,
          PostCommentEntity,
          PostCommentNotificationEntity,
          PostEntity,
          UserAccountEntity,
          UserEntity,
          VipPlanEntity,
          VoiceTimbreEntity,
        ],
      },
    },
  },
} as MidwayConfig;
