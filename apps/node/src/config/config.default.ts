import { MidwayConfig } from '@midwayjs/core';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, resolve } from 'path';
import {
  AgentEntity,
  AgentEntitlementEntity,
  AgentSubEntity,
  ConversationEntity,
  CouponLedgerEntity,
  MessageEntity,
  OrderEntity,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostLikeEntity,
  PostEntity,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  VipPlanEntity,
  VoicePackageEntity,
  VoiceTimbreEntity,
  VoiceTrainingTaskEntity,
} from '@tzl/entities';

const PROJECT_ROOT = resolve(__dirname, '../../../..');

loadLocalEnv();

function loadLocalEnv(): void {
  const envPath = resolve(PROJECT_ROOT, '.env');

  if (existsSync(envPath)) {
    loadEnvFile(envPath);
  }
}

function loadEnvFile(envPath: string): void {
  const raw = readFileSync(envPath, 'utf8');

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const index = trimmed.indexOf('=');

    if (index <= 0) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    if (!key || process.env[key] != null) {
      continue;
    }

    process.env[key] = value;
  }
}

function readStringFrom(names: string[], fallback: string): string {
  for (const name of names) {
    const raw = process.env[name];

    if (raw != null) {
      return raw;
    }
  }

  return fallback;
}

function readNonEmptyStringFrom(names: string[], fallback: string): string {
  for (const name of names) {
    const raw = process.env[name]?.trim();

    if (raw) {
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

function readOptionalNumberFrom(names: string[]): number | undefined {
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

  return undefined;
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
  keys: readStringFrom(['NODE_APP_KEYS'], '1774073039411_5782'),
  koa: {
    port: readNumberFrom(['NODE_PORT'], 7001),
    globalPrefix: readStringFrom(['NODE_GLOBAL_PREFIX'], '/api'),
  },
  busboy: {
    mode: 'file',
    tmpdir: resolve(tmpdir(), 'tianzhiling-node-upload'),
    cleanTimeout: 5 * 60 * 1000,
    whitelist: [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
      '.heic',
      '.heif',
      '.bmp',
      '.m4a',
      '.aac',
      '.mp3',
      '.wav',
      '.ogg',
      '.webm',
    ],
    match: /\/api\/storage\/upload$/,
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  },
  jwt: {
    secret: readStringFrom(['NODE_JWT_SECRET'], '1774073039411_5782'),
    sign: {
      expiresIn: readNumberFrom(
        ['NODE_JWT_EXPIRES_IN_SECONDS'],
        7 * 24 * 60 * 60
      ),
    },
    verify: {},
  },
  sms: {
    cloopen: {
      enabled: readBooleanFrom(['NODE_CLOOPEN_SMS_ENABLED'], true),
      appId: readStringFrom(['NODE_CLOOPEN_APP_ID'], ''),
      accountSid: readStringFrom(['NODE_CLOOPEN_ACCOUNT_SID'], ''),
      authToken: readStringFrom(['NODE_CLOOPEN_AUTH_TOKEN'], ''),
      templateId: readStringFrom(['NODE_CLOOPEN_SMS_TEMPLATE_ID'], '1'),
      codeExpiresInSeconds: readNumberFrom(
        ['NODE_SMS_CODE_EXPIRES_IN_SECONDS'],
        300
      ),
      resendIntervalSeconds: readNumberFrom(
        ['NODE_SMS_RESEND_INTERVAL_SECONDS'],
        60
      ),
    },
  },
  wechatMiniProgram: {
    appId: readNonEmptyStringFrom(
      [
        'NODE_WECHAT_MINI_PROGRAM_APP_ID',
        'WECHAT_MINI_PROGRAM_APP_ID',
        'NODE_WECHAT_APP_ID',
        'WECHAT_APP_ID',
        'NODE_WECHAT_PAY_APP_ID',
        'WECHAT_PAY_APP_ID',
      ],
      ''
    ),
    appSecret: readNonEmptyStringFrom(
      [
        'NODE_WECHAT_MINI_PROGRAM_APP_SECRET',
        'WECHAT_MINI_PROGRAM_APP_SECRET',
        'NODE_WECHAT_APP_SECRET',
        'WECHAT_APP_SECRET',
        'NODE_WECHAT_PAY_APP_SECRET',
        'WECHAT_PAY_APP_SECRET',
      ],
      ''
    ),
  },
  wechatPay: {
    enabled: readBooleanFrom(['NODE_WECHAT_PAY_ENABLED'], false),
    appId: readStringFrom(['NODE_WECHAT_PAY_APP_ID', 'WECHAT_PAY_APP_ID'], ''),
    appSecret: readStringFrom(
      ['NODE_WECHAT_PAY_APP_SECRET', 'WECHAT_PAY_APP_SECRET'],
      ''
    ),
    mchId: readStringFrom(['NODE_WECHAT_PAY_MCH_ID', 'WECHAT_PAY_MCH_ID'], ''),
    merchantSerialNo: readStringFrom(
      ['NODE_WECHAT_PAY_MCH_SERIAL_NO', 'WECHAT_PAY_MCH_SERIAL_NO'],
      ''
    ),
    merchantPrivateKey: readPemFrom(
      ['NODE_WECHAT_PAY_PRIVATE_KEY', 'WECHAT_PAY_PRIVATE_KEY'],
      '',
      ['NODE_WECHAT_PAY_PRIVATE_KEY_PATH', 'WECHAT_PAY_PRIVATE_KEY_PATH']
    ),
    publicKeyId: readStringFrom(
      [
        'NODE_WECHAT_PAY_PUBLIC_KEY_ID',
        'WECHAT_PAY_PUBLIC_KEY_ID',
        'NODE_WECHAT_PAY_PLATFORM_CERT_SERIAL_NO',
        'WECHAT_PAY_PLATFORM_CERT_SERIAL_NO',
      ],
      ''
    ),
    publicKey: readPemFrom(
      [
        'NODE_WECHAT_PAY_PUBLIC_KEY',
        'WECHAT_PAY_PUBLIC_KEY',
        'NODE_WECHAT_PAY_PLATFORM_CERT',
        'WECHAT_PAY_PLATFORM_CERT',
      ],
      '',
      [
        'NODE_WECHAT_PAY_PUBLIC_KEY_PATH',
        'WECHAT_PAY_PUBLIC_KEY_PATH',
        'NODE_WECHAT_PAY_PLATFORM_CERT_PATH',
        'WECHAT_PAY_PLATFORM_CERT_PATH',
      ]
    ),
    apiV3Key: readStringFrom(
      ['NODE_WECHAT_PAY_API_V3_KEY', 'WECHAT_PAY_API_V3_KEY'],
      ''
    ),
    notifyUrl: readStringFrom(
      ['NODE_WECHAT_PAY_NOTIFY_URL', 'WECHAT_PAY_NOTIFY_URL'],
      ''
    ),
  },
  openai: {
    enabled: readBooleanFrom(['NODE_ENABLED'], true),
    apiKey: readStringFrom(['NODE_MINIMAX_API_KEY'], ''),
    baseURL: readStringFrom(
      ['NODE_MINIMAX_BASE_URL'],
      'https://api.minimax.io/v1'
    ),
    model: readStringFrom(['NODE_MINIMAX_MODEL'], 'MiniMax-M2.5'),

    // 视觉理解模型
    visionModel: readStringFrom(['NODE_VISION_MODEL'], ''),
    visionApiKey: readStringFrom(['NODE_VISION_API_KEY'], ''),
    visionBaseURL: readStringFrom(['NODE_VISION_BASE_URL'], ''),
    // 语音转文字
    speechToTextApiKey: readStringFrom(['NODE_SPEECH_TO_TEXT_API_KEY'], ''),
    speechToTextBaseURL: readStringFrom(['NODE_SPEECH_TO_TEXT_BASE_URL'], ''),
    speechToTextModel: readStringFrom(['NODE_SPEECH_TO_TEXT_MODEL'], ''),
    // 语音合成
    textToSpeechApiKey: readStringFrom(['NODE_TEXT_TO_SPEECH_API_KEY'], ''),
    textToSpeechBaseURL: readStringFrom(['NODE_TEXT_TO_SPEECH_BASE_URL'], ''),
    textToSpeechModel: readStringFrom(['NODE_TEXT_TO_SPEECH_MODEL'], ''),
    textToSpeechVoice: readStringFrom(['NODE_TEXT_TO_SPEECH_VOICE'], ''),
    textToSpeechLanguageType: readStringFrom(
      ['NODE_TEXT_TO_SPEECH_LANGUAGE_TYPE'],
      'Chinese'
    ),

    temperature: readNumberFrom(['NODE_TEMPERATURE'], 1),
    topP: readNumberFrom(['NODE_TOP_P'], 0.95),
    presencePenalty: readNumberFrom(['NODE_PRESENCE_PENALTY'], 0.6),
    frequencyPenalty: readNumberFrom(['NODE_FREQUENCY_PENALTY'], 0.3),
    maxRetries: readNumberFrom(['NODE_MAX_RETRIES'], 2),
    timeoutMs: readNumberFrom(['NODE_TIMEOUT_MS'], 120000),
    reasoningSplit: readBooleanFrom(['NODE_REASONING_SPLIT'], true),

    // 嵌入模型
    embeddingApiKey: readStringFrom(['NODE_EMBEDDING_API_KEY'], ''),
    embeddingBaseURL: readStringFrom(['NODE_EMBEDDING_BASE_URL'], ''),
    embeddingModel: readStringFrom(['NODE_EMBEDDING_MODEL'], ''),
    embeddingDimensions: readOptionalNumberFrom(['NODE_EMBEDDING_DIMENSIONS']),
  },
  minimaxVoice: {
    enabled: readBooleanFrom(['NODE_MINIMAX_VOICE_ENABLED'], true),
    apiKey: readStringFrom(
      ['NODE_MINIMAX_VOICE_API_KEY', 'ADMIN_API_MINIMAX_VOICE_API_KEY'],
      ''
    ),
    baseURL: readStringFrom(
      ['NODE_MINIMAX_VOICE_BASE_URL', 'ADMIN_API_MINIMAX_VOICE_BASE_URL'],
      'https://api.minimaxi.com'
    ),
    defaultPreviewModel: readStringFrom(
      [
        'NODE_MINIMAX_VOICE_PREVIEW_MODEL',
        'ADMIN_API_MINIMAX_VOICE_PREVIEW_MODEL',
      ],
      'speech-2.8-turbo'
    ),
    defaultSpeechModel: readStringFrom(
      [
        'NODE_MINIMAX_VOICE_SPEECH_MODEL',
        'ADMIN_API_MINIMAX_VOICE_SPEECH_MODEL',
        'ADMIN_API_MINIMAX_VOICE_PREVIEW_MODEL',
      ],
      'speech-2.8-turbo'
    ),
    timeoutMs: readNumberFrom(
      ['NODE_MINIMAX_VOICE_TIMEOUT_MS', 'ADMIN_API_MINIMAX_VOICE_TIMEOUT_MS'],
      120000
    ),
  },
  milvus: {
    enabled: readBooleanFrom(['NODE_MILVUS_ENABLED'], false),
    address: readStringFrom(
      ['NODE_MILVUS_ADDRESS', 'MILVUS_ADDRESS'],
      '127.0.0.1:17953'
    ),
    token: readStringFrom(['NODE_MILVUS_TOKEN', 'MILVUS_TOKEN'], ''),
    username: readStringFrom(['NODE_MILVUS_USERNAME', 'MILVUS_USERNAME'], ''),
    password: readStringFrom(['NODE_MILVUS_PASSWORD', 'MILVUS_PASSWORD'], ''),
    database: readStringFrom(
      ['NODE_MILVUS_DATABASE', 'MILVUS_DATABASE'],
      'default'
    ),
    collectionName: readStringFrom(
      ['NODE_MILVUS_COLLECTION_NAME'],
      'conversation_message_memory'
    ),
    maxTextLength: readNumberFrom(['NODE_MILVUS_MAX_TEXT_LENGTH'], 4096),
    topK: readNumberFrom(['NODE_MILVUS_TOP_K'], 6),
    searchEf: readNumberFrom(['NODE_MILVUS_SEARCH_EF'], 64),
    minScore: readOptionalNumberFrom(['NODE_MILVUS_MIN_SCORE']),
    timeoutMs: readNumberFrom(['NODE_MILVUS_TIMEOUT_MS'], 10000),
  },
  oss: {
    enabled: readBooleanFrom(['NODE_OSS_ENABLED'], false),
    region: readStringFrom(['NODE_OSS_REGION'], ''),
    bucket: readStringFrom(['NODE_OSS_BUCKET'], ''),
    endpoint: readStringFrom(['NODE_OSS_ENDPOINT'], ''),
    publicBaseUrl: readStringFrom(['NODE_OSS_PUBLIC_BASE_URL'], ''),
    accessKeyId: readStringFrom(['NODE_OSS_ACCESS_KEY_ID'], ''),
    accessKeySecret: readStringFrom(['NODE_OSS_ACCESS_KEY_SECRET'], ''),
    stsToken: readStringFrom(['NODE_OSS_STS_TOKEN'], ''),
    secure: readBooleanFrom(['NODE_OSS_SECURE'], true),
    timeoutMs: readNumberFrom(['NODE_OSS_TIMEOUT_MS'], 60000),
    uploadPrefix: readStringFrom(['NODE_OSS_UPLOAD_PREFIX'], 'static'),
    signedUrlExpireSeconds: readNumberFrom(
      ['NODE_OSS_SIGNED_URL_EXPIRE_SECONDS'],
      900
    ),
  },
  tencentCos: {
    enabled: readBooleanFrom(['NODE_TENCENT_COS_ENABLED'], false),
    region: readStringFrom(['NODE_TENCENT_COS_REGION'], ''),
    bucket: readStringFrom(['NODE_TENCENT_COS_BUCKET'], ''),
    secretId: readStringFrom(['NODE_TENCENT_COS_SECRET_ID'], ''),
    secretKey: readStringFrom(['NODE_TENCENT_COS_SECRET_KEY'], ''),
    securityToken: readStringFrom(['NODE_TENCENT_COS_SECURITY_TOKEN'], ''),
    protocol: readStringFrom(['NODE_TENCENT_COS_PROTOCOL'], 'https:'),
    domain: readStringFrom(['NODE_TENCENT_COS_DOMAIN'], ''),
    publicBaseUrl: readStringFrom(['NODE_TENCENT_COS_PUBLIC_BASE_URL'], ''),
    uploadPrefix: readStringFrom(['NODE_TENCENT_COS_UPLOAD_PREFIX'], 'static'),
    signedUrlExpireSeconds: readNumberFrom(
      ['NODE_TENCENT_COS_SIGNED_URL_EXPIRE_SECONDS'],
      900
    ),
  },
  redis: {
    client: {
      host: readStringFrom(['NODE_REDIS_HOST', 'REDIS_HOST'], '127.0.0.1'),
      port: readNumberFrom(['NODE_REDIS_PORT', 'REDIS_PORT'], 17380),
      password: readStringFrom(['NODE_REDIS_PASSWORD', 'REDIS_PASSWORD'], ''),
      db: readNumberFrom(['NODE_REDIS_DB', 'REDIS_DB'], 0),
    },
  },
  bullmq: {
    defaultConnection: {
      host: readStringFrom(
        ['NODE_BULLMQ_HOST', 'NODE_REDIS_HOST', 'REDIS_HOST'],
        '127.0.0.1'
      ),
      port: readNumberFrom(
        ['NODE_BULLMQ_PORT', 'NODE_REDIS_PORT', 'REDIS_PORT'],
        17380
      ),
      password: readStringFrom(
        ['NODE_BULLMQ_PASSWORD', 'NODE_REDIS_PASSWORD', 'REDIS_PASSWORD'],
        ''
      ),
      db: readNumberFrom(['NODE_BULLMQ_DB', 'NODE_REDIS_DB', 'REDIS_DB'], 0),
    },
    defaultPrefix: readStringFrom(['NODE_BULLMQ_PREFIX'], '{tzl-bullmq}'),
    defaultQueueOptions: {
      defaultJobOptions: {
        removeOnComplete: readNumberFrom(
          ['NODE_BULLMQ_REMOVE_ON_COMPLETE'],
          100
        ),
        removeOnFail: readNumberFrom(['NODE_BULLMQ_REMOVE_ON_FAIL'], 500),
      },
    },
  },
  typeorm: {
    dataSource: {
      default: {
        type: 'mongodb',
        database: readStringFrom(['NODE_MONGO_DB', 'MONGO_DB'], 'tzl'),
        host: readStringFrom(['NODE_MONGO_HOST', 'MONGO_HOST'], '127.0.0.1'),
        port: readNumberFrom(['NODE_MONGO_PORT', 'MONGO_PORT'], 17271),
        authSource: readStringFrom(
          ['NODE_MONGO_AUTH_SOURCE', 'MONGO_AUTH_SOURCE'],
          'admin'
        ),
        username: readStringFrom(
          ['NODE_MONGO_USERNAME', 'MONGO_USERNAME'],
          'admin'
        ),
        password: readStringFrom(
          ['NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'],
          'qwerasdf'
        ),
        synchronize: readBooleanFrom(
          ['NODE_DB_SYNCHRONIZE'],
          process.env.NODE_ENV !== 'production'
        ),
        logging: readBooleanFrom(['NODE_DB_LOGGING'], false),
        entities: [
          AgentEntity,
          AgentEntitlementEntity,
          AgentSubEntity,
          ConversationEntity,
          CouponLedgerEntity,
          MessageEntity,
          OrderEntity,
          PostCommentEntity,
          PostCommentNotificationEntity,
          PostLikeEntity,
          PostEntity,
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
