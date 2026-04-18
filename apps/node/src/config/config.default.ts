import { MidwayConfig } from '@midwayjs/core';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

loadLocalEnv();

function loadLocalEnv(): void {
  const envPaths = [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../../.env'),
  ];
  const seen = new Set<string>();

  for (const envPath of envPaths) {
    if (seen.has(envPath) || !existsSync(envPath)) {
      continue;
    }

    seen.add(envPath);
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

function readString(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalNumber(name: string): number | undefined {
  const raw = process.env[name];

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export default {
  keys: readString('APP_KEYS', '1774073039411_5782'),
  koa: {
    port: readNumber('PORT', 7001),
  },
  jwt: {
    secret: readString(
      'JWT_SECRET',
      readString(
        'AUTH_TOKEN_SECRET',
        readString('APP_KEYS', '1774073039411_5782')
      )
    ),
    sign: {
      expiresIn: readNumber(
        'JWT_EXPIRES_IN_SECONDS',
        readNumber('AUTH_TOKEN_EXPIRES_IN_SECONDS', 7 * 24 * 60 * 60)
      ),
    },
    verify: {},
  },
  sms: {
    cloopen: {
      enabled: readBoolean('CLOOPEN_SMS_ENABLED', true),
      appId: readString('CLOOPEN_APP_ID', ''),
      accountSid: readString('CLOOPEN_ACCOUNT_SID', ''),
      authToken: readString('CLOOPEN_AUTH_TOKEN', ''),
      templateId: readString('CLOOPEN_SMS_TEMPLATE_ID', '1'),
      codeExpiresInSeconds: readNumber('SMS_CODE_EXPIRES_IN_SECONDS', 300),
      resendIntervalSeconds: readNumber('SMS_RESEND_INTERVAL_SECONDS', 60),
    },
  },
  minimax: {
    enabled: readBoolean('MINIMAX_ENABLED', true),
    apiKey: readString('MINIMAX_API_KEY', readString('OPENAI_API_KEY', '')),
    baseURL: readString(
      'MINIMAX_BASE_URL',
      readString('OPENAI_BASE_URL', 'https://api.minimax.io/v1')
    ),
    model: readString('MINIMAX_MODEL', 'MiniMax-M2.5'),
    visionModel: readString(
      'MINIMAX_VISION_MODEL',
      readString('MINIMAX_MODEL', 'MiniMax-M2.5')
    ),
    visionApiKey: readString(
      'MINIMAX_VISION_API_KEY',
      readString('MINIMAX_API_KEY', readString('OPENAI_API_KEY', ''))
    ),
    visionBaseURL: readString(
      'MINIMAX_VISION_BASE_URL',
      readString(
        'MINIMAX_BASE_URL',
        readString('OPENAI_BASE_URL', 'https://api.minimax.io/v1')
      )
    ),
    speechToTextApiKey: readString(
      'SPEECH_TO_TEXT_API_KEY',
      readString('MINIMAX_API_KEY', readString('OPENAI_API_KEY', ''))
    ),
    speechToTextBaseURL: readString(
      'SPEECH_TO_TEXT_BASE_URL',
      readString(
        'MINIMAX_BASE_URL',
        readString('OPENAI_BASE_URL', 'https://api.minimax.io/v1')
      )
    ),
    speechToTextModel: readString('SPEECH_TO_TEXT_MODEL', ''),
    temperature: readNumber('MINIMAX_TEMPERATURE', 1),
    topP: readNumber('MINIMAX_TOP_P', 0.95),
    presencePenalty: readNumber('MINIMAX_PRESENCE_PENALTY', 0.6),
    frequencyPenalty: readNumber('MINIMAX_FREQUENCY_PENALTY', 0.3),
    maxRetries: readNumber('MINIMAX_MAX_RETRIES', 2),
    timeoutMs: readNumber('MINIMAX_TIMEOUT_MS', 120000),
    reasoningSplit: readBoolean('MINIMAX_REASONING_SPLIT', true),
    embeddingApiKey: readString(
      'EMBEDDING_API_KEY',
      readString(
        'MINIMAX_EMBEDDING_API_KEY',
        readString('MINIMAX_API_KEY', readString('OPENAI_API_KEY', ''))
      )
    ),
    embeddingBaseURL: readString(
      'EMBEDDING_BASE_URL',
      readString(
        'MINIMAX_EMBEDDING_BASE_URL',
        readString(
          'MINIMAX_BASE_URL',
          readString('OPENAI_BASE_URL', 'https://api.minimax.io/v1')
        )
      )
    ),
    embeddingModel: readString(
      'EMBEDDING_MODEL',
      readString(
        'MINIMAX_EMBEDDING_MODEL',
        readString('OPENAI_EMBEDDING_MODEL', '')
      )
    ),
    embeddingDimensions:
      readOptionalNumber('EMBEDDING_DIMENSIONS') ??
      readOptionalNumber('MINIMAX_EMBEDDING_DIMENSIONS'),
  },
  milvus: {
    enabled: readBoolean('MILVUS_ENABLED', false),
    address: readString('MILVUS_ADDRESS', '127.0.0.1:17953'),
    token: readString('MILVUS_TOKEN', ''),
    username: readString('MILVUS_USERNAME', ''),
    password: readString('MILVUS_PASSWORD', ''),
    database: readString('MILVUS_DATABASE', 'default'),
    collectionName: readString(
      'MILVUS_COLLECTION_NAME',
      'conversation_message_memory'
    ),
    maxTextLength: readNumber('MILVUS_MAX_TEXT_LENGTH', 4096),
    topK: readNumber('MILVUS_TOP_K', 6),
    searchEf: readNumber('MILVUS_SEARCH_EF', 64),
    minScore: readOptionalNumber('MILVUS_MIN_SCORE'),
    timeoutMs: readNumber('MILVUS_TIMEOUT_MS', 10000),
  },
  oss: {
    enabled: readBoolean('OSS_ENABLED', false),
    region: readString('OSS_REGION', ''),
    bucket: readString('OSS_BUCKET', ''),
    endpoint: readString('OSS_ENDPOINT', ''),
    publicBaseUrl: readString('OSS_PUBLIC_BASE_URL', ''),
    accessKeyId: readString('OSS_ACCESS_KEY_ID', ''),
    accessKeySecret: readString('OSS_ACCESS_KEY_SECRET', ''),
    stsToken: readString('OSS_STS_TOKEN', ''),
    secure: readBoolean('OSS_SECURE', true),
    timeoutMs: readNumber('OSS_TIMEOUT_MS', 60000),
    uploadPrefix: readString('OSS_UPLOAD_PREFIX', 'static'),
    signedUrlExpireSeconds: readNumber('OSS_SIGNED_URL_EXPIRE_SECONDS', 900),
  },
  tencentCos: {
    enabled: readBoolean('TENCENT_COS_ENABLED', false),
    region: readString('TENCENT_COS_REGION', ''),
    bucket: readString('TENCENT_COS_BUCKET', ''),
    secretId: readString('TENCENT_COS_SECRET_ID', ''),
    secretKey: readString('TENCENT_COS_SECRET_KEY', ''),
    securityToken: readString('TENCENT_COS_SECURITY_TOKEN', ''),
    protocol: readString('TENCENT_COS_PROTOCOL', 'https:'),
    domain: readString('TENCENT_COS_DOMAIN', ''),
    publicBaseUrl: readString('TENCENT_COS_PUBLIC_BASE_URL', ''),
    uploadPrefix: readString('TENCENT_COS_UPLOAD_PREFIX', 'static'),
    signedUrlExpireSeconds: readNumber(
      'TENCENT_COS_SIGNED_URL_EXPIRE_SECONDS',
      900
    ),
  },
  redis: {
    client: {
      host: readString('REDIS_HOST', '127.0.0.1'),
      port: readNumber('REDIS_PORT', 17380),
      password: readString('REDIS_PASSWORD', ''),
      db: readNumber('REDIS_DB', 0),
    },
  },
  bullmq: {
    defaultConnection: {
      host: readString('BULLMQ_HOST', readString('REDIS_HOST', '127.0.0.1')),
      port: readNumber('BULLMQ_PORT', readNumber('REDIS_PORT', 17380)),
      password: readString('BULLMQ_PASSWORD', readString('REDIS_PASSWORD', '')),
      db: readNumber('BULLMQ_DB', readNumber('REDIS_DB', 0)),
    },
    defaultPrefix: readString('BULLMQ_PREFIX', '{tzl-bullmq}'),
    defaultQueueOptions: {
      defaultJobOptions: {
        removeOnComplete: readNumber('BULLMQ_REMOVE_ON_COMPLETE', 100),
        removeOnFail: readNumber('BULLMQ_REMOVE_ON_FAIL', 500),
      },
    },
  },
  typeorm: {
    dataSource: {
      default: {
        type: 'mongodb',
        database: readString('MONGO_DB', 'tzl'),
        host: readString('MONGO_HOST', '127.0.0.1'),
        port: readNumber('MONGO_PORT', 17271),
        authSource: readString('MONGO_AUTH_SOURCE', 'admin'),
        username: readString('MONGO_USERNAME', 'admin'),
        password: readString('MONGO_PASSWORD', 'qwerasdf'),
        synchronize: readBoolean(
          'DB_SYNCHRONIZE',
          process.env.NODE_ENV !== 'production'
        ),
        logging: readBoolean('DB_LOGGING', false),
        entities: ['entity'],
      },
    },
  },
} as MidwayConfig;
