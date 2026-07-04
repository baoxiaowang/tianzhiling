import { MidwayConfig } from '@midwayjs/core';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
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
  AgentSubEntity,
  ConversationEntity,
  CouponLedgerEntity,
  MessageEntity,
  OrderEntity,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostEntity,
  PostLikeEntity,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  VipPlanEntity,
  VoicePackageEntity,
  VoiceTimbreEntity,
  VoiceTrainingTaskEntity,
} from '@tzl/entities';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

const PROJECT_ROOT = resolve(__dirname, '../../../..');

function readPemFrom(
  names: string[],
  fallback = '',
  pathNames: string[] = []
): string {
  const filePath = readStringFrom(pathNames, '').trim();

  if (filePath) {
    const absolutePath = isAbsolute(filePath)
      ? filePath
      : resolve(PROJECT_ROOT, filePath);

    if (!existsSync(absolutePath)) {
      return fallback;
    }

    return readFileSync(absolutePath, 'utf8').trim();
  }

  const value = readStringFrom(names, fallback).trim();

  return value.replace(/\\n/g, '\n');
}

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
      'https://api.minimaxi.com'
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
  cosyVoice: {
    enabled: readBooleanFrom(
      ['ADMIN_API_COSYVOICE_ENABLED', 'NODE_COSYVOICE_ENABLED'],
      true
    ),
    apiKey: readStringFrom(
      [
        'ADMIN_API_COSYVOICE_API_KEY',
        'NODE_COSYVOICE_API_KEY',
        'DASHSCOPE_API_KEY',
      ],
      ''
    ),
    baseURL: readStringFrom(
      ['ADMIN_API_COSYVOICE_BASE_URL', 'NODE_COSYVOICE_BASE_URL'],
      'https://dashscope.aliyuncs.com'
    ),
    defaultPreviewModel: readStringFrom(
      [
        'ADMIN_API_COSYVOICE_PREVIEW_MODEL',
        'NODE_COSYVOICE_PREVIEW_MODEL',
      ],
      'cosyvoice-v3.5-plus'
    ),
    defaultLanguageHint: readStringFrom(
      [
        'ADMIN_API_COSYVOICE_LANGUAGE_HINT',
        'NODE_COSYVOICE_LANGUAGE_HINT',
      ],
      'zh'
    ),
    maxPromptAudioLength: readNumberFrom(
      [
        'ADMIN_API_COSYVOICE_MAX_PROMPT_AUDIO_LENGTH',
        'NODE_COSYVOICE_MAX_PROMPT_AUDIO_LENGTH',
      ],
      20
    ),
    enablePreprocess: readBooleanFrom(
      [
        'ADMIN_API_COSYVOICE_ENABLE_PREPROCESS',
        'NODE_COSYVOICE_ENABLE_PREPROCESS',
      ],
      false
    ),
    timeoutMs: readNumberFrom(
      ['ADMIN_API_COSYVOICE_TIMEOUT_MS', 'NODE_COSYVOICE_TIMEOUT_MS'],
      120000
    ),
  },
  qwenVoice: {
    enabled: readBooleanFrom(
      ['ADMIN_API_QWEN_VOICE_ENABLED', 'NODE_QWEN_VOICE_ENABLED'],
      true
    ),
    apiKey: readStringFrom(
      [
        'ADMIN_API_QWEN_VOICE_API_KEY',
        'NODE_QWEN_VOICE_API_KEY',
        'DASHSCOPE_API_KEY',
      ],
      ''
    ),
    baseURL: readStringFrom(
      ['ADMIN_API_QWEN_VOICE_BASE_URL', 'NODE_QWEN_VOICE_BASE_URL'],
      'https://dashscope.aliyuncs.com'
    ),
    defaultPreviewModel: readStringFrom(
      [
        'ADMIN_API_QWEN_VOICE_PREVIEW_MODEL',
        'NODE_QWEN_VOICE_SPEECH_MODEL',
      ],
      'qwen3-tts-vc-2026-01-22'
    ),
    defaultLanguage: readStringFrom(
      ['ADMIN_API_QWEN_VOICE_LANGUAGE', 'NODE_QWEN_VOICE_LANGUAGE'],
      'zh'
    ),
    timeoutMs: readNumberFrom(
      ['ADMIN_API_QWEN_VOICE_TIMEOUT_MS', 'NODE_QWEN_VOICE_TIMEOUT_MS'],
      120000
    ),
  },
  wechatPay: {
    enabled: readBooleanFrom(
      ['ADMIN_API_WECHAT_PAY_ENABLED', 'NODE_WECHAT_PAY_ENABLED'],
      false
    ),
    mchId: readStringFrom(
      [
        'ADMIN_API_WECHAT_PAY_MCH_ID',
        'NODE_WECHAT_PAY_MCH_ID',
        'WECHAT_PAY_MCH_ID',
      ],
      ''
    ),
    merchantSerialNo: readStringFrom(
      [
        'ADMIN_API_WECHAT_PAY_MCH_SERIAL_NO',
        'NODE_WECHAT_PAY_MCH_SERIAL_NO',
        'WECHAT_PAY_MCH_SERIAL_NO',
      ],
      ''
    ),
    merchantPrivateKey: readPemFrom(
      [
        'ADMIN_API_WECHAT_PAY_PRIVATE_KEY',
        'NODE_WECHAT_PAY_PRIVATE_KEY',
        'WECHAT_PAY_PRIVATE_KEY',
      ],
      '',
      [
        'ADMIN_API_WECHAT_PAY_PRIVATE_KEY_PATH',
        'NODE_WECHAT_PAY_PRIVATE_KEY_PATH',
        'WECHAT_PAY_PRIVATE_KEY_PATH',
      ]
    ),
    publicKeyId: readStringFrom(
      [
        'ADMIN_API_WECHAT_PAY_PUBLIC_KEY_ID',
        'NODE_WECHAT_PAY_PUBLIC_KEY_ID',
        'WECHAT_PAY_PUBLIC_KEY_ID',
        'ADMIN_API_WECHAT_PAY_PLATFORM_CERT_SERIAL_NO',
        'NODE_WECHAT_PAY_PLATFORM_CERT_SERIAL_NO',
        'WECHAT_PAY_PLATFORM_CERT_SERIAL_NO',
      ],
      ''
    ),
    publicKey: readPemFrom(
      [
        'ADMIN_API_WECHAT_PAY_PUBLIC_KEY',
        'NODE_WECHAT_PAY_PUBLIC_KEY',
        'WECHAT_PAY_PUBLIC_KEY',
        'ADMIN_API_WECHAT_PAY_PLATFORM_CERT',
        'NODE_WECHAT_PAY_PLATFORM_CERT',
        'WECHAT_PAY_PLATFORM_CERT',
      ],
      '',
      [
        'ADMIN_API_WECHAT_PAY_PUBLIC_KEY_PATH',
        'NODE_WECHAT_PAY_PUBLIC_KEY_PATH',
        'WECHAT_PAY_PUBLIC_KEY_PATH',
        'ADMIN_API_WECHAT_PAY_PLATFORM_CERT_PATH',
        'NODE_WECHAT_PAY_PLATFORM_CERT_PATH',
        'WECHAT_PAY_PLATFORM_CERT_PATH',
      ]
    ),
  },
  wechatMiniProgram: {
    appId: readStringFrom(
      [
        'ADMIN_API_WECHAT_MINI_PROGRAM_APP_ID',
        'NODE_WECHAT_MINI_PROGRAM_APP_ID',
        'WECHAT_MINI_PROGRAM_APP_ID',
        'ADMIN_API_WECHAT_APP_ID',
        'NODE_WECHAT_APP_ID',
        'WECHAT_APP_ID',
        'ADMIN_API_WECHAT_PAY_APP_ID',
        'NODE_WECHAT_PAY_APP_ID',
        'WECHAT_PAY_APP_ID',
      ],
      ''
    ),
    appSecret: readStringFrom(
      [
        'ADMIN_API_WECHAT_MINI_PROGRAM_APP_SECRET',
        'NODE_WECHAT_MINI_PROGRAM_APP_SECRET',
        'WECHAT_MINI_PROGRAM_APP_SECRET',
        'ADMIN_API_WECHAT_APP_SECRET',
        'NODE_WECHAT_APP_SECRET',
        'WECHAT_APP_SECRET',
        'ADMIN_API_WECHAT_PAY_APP_SECRET',
        'NODE_WECHAT_PAY_APP_SECRET',
        'WECHAT_PAY_APP_SECRET',
      ],
      ''
    ),
  },
  wechatVirtualPay: {
    enabled: readBooleanFrom(
      ['ADMIN_API_WECHAT_VIRTUAL_PAY_ENABLED', 'NODE_WECHAT_VIRTUAL_PAY_ENABLED'],
      false
    ),
    env: readNumberFrom(
      ['ADMIN_API_WECHAT_VIRTUAL_PAY_ENV', 'NODE_WECHAT_VIRTUAL_PAY_ENV'],
      process.env.NODE_ENV === 'production' ? 0 : 1
    ),
    sandboxAppKey: readStringFrom(
      [
        'ADMIN_API_WECHAT_VIRTUAL_PAY_SANDBOX_APP_KEY',
        'NODE_WECHAT_VIRTUAL_PAY_SANDBOX_APP_KEY',
      ],
      ''
    ),
    productionAppKey: readStringFrom(
      [
        'ADMIN_API_WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY',
        'NODE_WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY',
      ],
      ''
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
  milvus: {
    enabled: readBooleanFrom(
      ['ADMIN_API_MILVUS_ENABLED', 'NODE_MILVUS_ENABLED'],
      false
    ),
    address: readStringFrom(
      ['ADMIN_API_MILVUS_ADDRESS', 'NODE_MILVUS_ADDRESS', 'MILVUS_ADDRESS'],
      '127.0.0.1:17953'
    ),
    token: readStringFrom(
      ['ADMIN_API_MILVUS_TOKEN', 'NODE_MILVUS_TOKEN', 'MILVUS_TOKEN'],
      ''
    ),
    username: readStringFrom(
      [
        'ADMIN_API_MILVUS_USERNAME',
        'NODE_MILVUS_USERNAME',
        'MILVUS_USERNAME',
      ],
      ''
    ),
    password: readStringFrom(
      [
        'ADMIN_API_MILVUS_PASSWORD',
        'NODE_MILVUS_PASSWORD',
        'MILVUS_PASSWORD',
      ],
      ''
    ),
    database: readStringFrom(
      [
        'ADMIN_API_MILVUS_DATABASE',
        'NODE_MILVUS_DATABASE',
        'MILVUS_DATABASE',
      ],
      'default'
    ),
    collectionName: readStringFrom(
      ['ADMIN_API_MILVUS_COLLECTION_NAME', 'NODE_MILVUS_COLLECTION_NAME'],
      'conversation_message_memory'
    ),
    timeoutMs: readNumberFrom(
      ['ADMIN_API_MILVUS_TIMEOUT_MS', 'NODE_MILVUS_TIMEOUT_MS'],
      10000
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
          AgentSubEntity,
          ConversationEntity,
          CouponLedgerEntity,
          MessageEntity,
          OrderEntity,
          PostCommentEntity,
          PostCommentNotificationEntity,
          PostEntity,
          PostLikeEntity,
          UserAccountEntity,
          UserEntity,
          UserMembershipEntity,
          VipPlanEntity,
          VoicePackageEntity,
          VoiceTimbreEntity,
          VoiceTrainingTaskEntity,
        ],
      },
    },
  },
} as MidwayConfig;
