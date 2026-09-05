import { MidwayConfig } from '@midwayjs/core';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, resolve } from 'path';
import {
  AgentEntity,
  AgentEntitlementEntity,
  AgentMemoryFactEntity,
  AgentProfileFactEntity,
  AgentRelationshipSignalEntity,
  AgentShareInviteEntity,
  AgentShareMemberEntity,
  AgentSubEntity,
  ChatSpanEntity,
  ChatTraceEntity,
  ConversationEmotionStateEntity,
  ConversationChatImportBatchEntity,
  ConversationChatImportItemEntity,
  ConversationMessageFeedbackEntity,
  ConversationDeliberateReplyTaskEntity,
  ConversationReplyTurnEntity,
  ConversationEntity,
  CouponLedgerEntity,
  FreeChatAgentLedgerEntity,
  MessageEntity,
  MessengerCallEventEntity,
  OrderEntity,
  OrderRefundEntity,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostLikeEntity,
  PostNotificationEntity,
  PostEntity,
  UserAccountEntity,
  UserEntity,
  UserIdentityProfileEntity,
  UserKnownPersonEntity,
  UserMembershipEntity,
  VipPlanEntity,
  VoicePackageEntity,
  VoiceServiceSessionEntity,
  VoiceTimbreEntity,
  VoiceTrainingTaskEntity,
} from '@tzl/entities';

const PROJECT_ROOT = resolve(__dirname, '../../../..');

loadLocalEnv();

function loadLocalEnv(): void {
  if (process.env.NODE_ENV !== 'production') {
    const localEnvPath = resolve(PROJECT_ROOT, '.env.local');

    if (existsSync(localEnvPath)) {
      loadEnvFile(localEnvPath);
    }
  }

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
  brand: {
    key: readStringFrom(['BRAND'], 'tianzhiling'),
    name: readStringFrom(['BRAND_NAME'], '天之灵'),
    companyName: readStringFrom(
      ['BRAND_COMPANY'],
      '武汉市天之灵智能技术有限公司'
    ),
  },
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
      '.amr',
      '.silk',
      '.mp4',
      '.m4v',
      '.mov',
    ],
    match: /\/api\/storage\/upload$/,
    limits: {
      fileSize: 50 * 1024 * 1024,
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
  wechatVirtualPay: {
    enabled: readBooleanFrom(['NODE_WECHAT_VIRTUAL_PAY_ENABLED'], false),
    offerId: readStringFrom(['NODE_WECHAT_VIRTUAL_PAY_OFFER_ID'], ''),
    env: readNumberFrom(
      ['NODE_WECHAT_VIRTUAL_PAY_ENV'],
      process.env.NODE_ENV === 'production' ? 0 : 1
    ),
    sandboxAppKey: readStringFrom(
      ['NODE_WECHAT_VIRTUAL_PAY_SANDBOX_APP_KEY'],
      ''
    ),
    productionAppKey: readStringFrom(
      ['NODE_WECHAT_VIRTUAL_PAY_PRODUCTION_APP_KEY'],
      ''
    ),
  },
  openai: {
    enabled: readBooleanFrom(['NODE_ENABLED'], true),
    apiKey: readStringFrom(['NODE_CHAT_API_KEY', 'NODE_MINIMAX_API_KEY'], ''),
    baseURL: readStringFrom(
      ['NODE_CHAT_BASE_URL', 'NODE_MINIMAX_BASE_URL'],
      'https://api.minimax.io/v1'
    ),
    model: readStringFrom(
      ['NODE_CHAT_MODEL', 'NODE_MINIMAX_MODEL'],
      'MiniMax-M2.5'
    ),
    fallback: {
      apiKey: readStringFrom(['NODE_CHAT_FALLBACK_API_KEY'], ''),
      baseURL: readStringFrom(
        ['NODE_CHAT_FALLBACK_BASE_URL'],
        'https://api.deepseek.com'
      ),
      model: readStringFrom(['NODE_CHAT_FALLBACK_MODEL'], 'deepseek-v4-flash'),
    },
    secondaryFallback: {
      apiKey: readStringFrom(
        ['NODE_CHAT_SECONDARY_FALLBACK_API_KEY', 'DASHSCOPE_API_KEY'],
        ''
      ),
      baseURL: readStringFrom(
        ['NODE_CHAT_SECONDARY_FALLBACK_BASE_URL'],
        'https://dashscope.aliyuncs.com/compatible-mode/v1'
      ),
      model: readStringFrom(
        ['NODE_CHAT_SECONDARY_FALLBACK_MODEL'],
        'qwen-plus'
      ),
    },

    // 视觉理解模型
    visionModel: readStringFrom(['NODE_VISION_MODEL'], ''),
    visionApiKey: readStringFrom(
      ['NODE_VISION_API_KEY', 'DASHSCOPE_API_KEY'],
      ''
    ),
    visionBaseURL: readStringFrom(['NODE_VISION_BASE_URL'], ''),
    // 语音转文字
    speechToTextApiKey: readStringFrom(
      ['NODE_SPEECH_TO_TEXT_API_KEY', 'DASHSCOPE_API_KEY'],
      ''
    ),
    speechToTextBaseURL: readStringFrom(['NODE_SPEECH_TO_TEXT_BASE_URL'], ''),
    speechToTextModel: readStringFrom(['NODE_SPEECH_TO_TEXT_MODEL'], ''),
    // 语音合成
    textToSpeechApiKey: readStringFrom(
      ['NODE_TEXT_TO_SPEECH_API_KEY', 'DASHSCOPE_API_KEY'],
      ''
    ),
    textToSpeechBaseURL: readStringFrom(['NODE_TEXT_TO_SPEECH_BASE_URL'], ''),
    textToSpeechModel: readStringFrom(['NODE_TEXT_TO_SPEECH_MODEL'], ''),
    textToSpeechVoice: readStringFrom(['NODE_TEXT_TO_SPEECH_VOICE'], ''),
    textToSpeechLanguageType: readStringFrom(
      ['NODE_TEXT_TO_SPEECH_LANGUAGE_TYPE'],
      'Chinese'
    ),

    // A/B 通道：按用户哈希路由到不同模型
    abModel: readStringFrom(['NODE_CHAT_AB_MODEL'], ''),
    abModelApiKey: readStringFrom(['NODE_CHAT_AB_MODEL_API_KEY'], ''),
    abModelBaseURL: readStringFrom(['NODE_CHAT_AB_MODEL_BASE_URL'], ''),
    // 分配到 B 通道的用户百分比 (0-100)，默认 0 即全部走主模型
    abSplitPercent: readNumberFrom(['NODE_CHAT_AB_SPLIT_PERCENT'], 0),

    temperature: readNumberFrom(['NODE_TEMPERATURE'], 1),
    topP: readNumberFrom(['NODE_TOP_P'], 0.95),
    presencePenalty: readNumberFrom(['NODE_PRESENCE_PENALTY'], 0.6),
    frequencyPenalty: readNumberFrom(['NODE_FREQUENCY_PENALTY'], 0.3),
    maxRetries: readNumberFrom(['NODE_MAX_RETRIES'], 2),
    timeoutMs: readNumberFrom(['NODE_TIMEOUT_MS'], 120000),
    reasoningSplit: readBooleanFrom(['NODE_REASONING_SPLIT'], true),

    // 嵌入模型
    embeddingApiKey: readStringFrom(
      ['NODE_EMBEDDING_API_KEY', 'DASHSCOPE_API_KEY'],
      ''
    ),
    embeddingBaseURL: readStringFrom(['NODE_EMBEDDING_BASE_URL'], ''),
    embeddingModel: readStringFrom(['NODE_EMBEDDING_MODEL'], ''),
    embeddingDimensions: readOptionalNumberFrom(['NODE_EMBEDDING_DIMENSIONS']),
  },
  replyIntent: {
    enabled: readBooleanFrom(['NODE_REPLY_INTENT_ENABLED'], true),
    model: readStringFrom(['NODE_REPLY_INTENT_MODEL'], ''),
    timeoutMs: readNumberFrom(['NODE_REPLY_INTENT_TIMEOUT_MS'], 10000),
    hybridEnabled: readBooleanFrom(['NODE_REPLY_INTENT_HYBRID_ENABLED'], true),
    directMaxCharacters: readNumberFrom(
      ['NODE_REPLY_INTENT_DIRECT_MAX_CHARACTERS'],
      80
    ),
  },
  chatProgramReduction: {
    mode: readStringFrom(['NODE_CHAT_PROGRAM_REDUCTION'], 'active'),
    modelPromptLayer: readStringFrom(
      ['NODE_CHAT_MODEL_PROMPT_LAYER'],
      'hybrid'
    ),
    l5TraceOnly: readBooleanFrom(['NODE_CHAT_L5_TRACE_ONLY'], true),
  },
  chatTools: {
    mode: readStringFrom(['NODE_CHAT_TOOLS_MODE'], 'shadow'),
    shadowSampleRate: readNumberFrom(
      ['NODE_CHAT_TOOLS_SHADOW_SAMPLE_RATE'],
      0.2
    ),
    activeSampleRate: readNumberFrom(['NODE_CHAT_TOOLS_ACTIVE_SAMPLE_RATE'], 0),
    maxCallsPerTurn: readNumberFrom(['NODE_CHAT_TOOLS_MAX_CALLS_PER_TURN'], 4),
    timeoutMs: readNumberFrom(['NODE_CHAT_TOOLS_TIMEOUT_MS'], 2500),
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
  cosyVoice: {
    enabled: readBooleanFrom(['NODE_COSYVOICE_ENABLED'], true),
    apiKey: readStringFrom(
      [
        'NODE_COSYVOICE_API_KEY',
        'ADMIN_API_COSYVOICE_API_KEY',
        'DASHSCOPE_API_KEY',
      ],
      ''
    ),
    baseURL: readStringFrom(
      ['NODE_COSYVOICE_BASE_URL', 'ADMIN_API_COSYVOICE_BASE_URL'],
      'https://dashscope.aliyuncs.com'
    ),
    defaultPreviewModel: readStringFrom(
      ['NODE_COSYVOICE_PREVIEW_MODEL', 'ADMIN_API_COSYVOICE_PREVIEW_MODEL'],
      'cosyvoice-v3.5-plus'
    ),
    defaultSpeechModel: readStringFrom(
      [
        'NODE_COSYVOICE_SPEECH_MODEL',
        'ADMIN_API_COSYVOICE_SPEECH_MODEL',
        'NODE_COSYVOICE_PREVIEW_MODEL',
        'ADMIN_API_COSYVOICE_PREVIEW_MODEL',
      ],
      'cosyvoice-v3.5-plus'
    ),
    defaultLanguageHint: readStringFrom(
      ['NODE_COSYVOICE_LANGUAGE_HINT', 'ADMIN_API_COSYVOICE_LANGUAGE_HINT'],
      'zh'
    ),
    outputFormat: readStringFrom(['NODE_COSYVOICE_OUTPUT_FORMAT'], 'mp3'),
    sampleRate: readNumberFrom(['NODE_COSYVOICE_SAMPLE_RATE'], 24000),
    timeoutMs: readNumberFrom(
      ['NODE_COSYVOICE_TIMEOUT_MS', 'ADMIN_API_COSYVOICE_TIMEOUT_MS'],
      120000
    ),
  },
  qwenVoice: {
    enabled: readBooleanFrom(
      ['NODE_QWEN_VOICE_ENABLED', 'ADMIN_API_QWEN_VOICE_ENABLED'],
      true
    ),
    apiKey: readStringFrom(
      [
        'NODE_QWEN_VOICE_API_KEY',
        'ADMIN_API_QWEN_VOICE_API_KEY',
        'DASHSCOPE_API_KEY',
      ],
      ''
    ),
    baseURL: readStringFrom(
      ['NODE_QWEN_VOICE_BASE_URL', 'ADMIN_API_QWEN_VOICE_BASE_URL'],
      'https://dashscope.aliyuncs.com'
    ),
    audioBaseURL: readStringFrom(
      ['NODE_QWEN_AUDIO_BASE_URL', 'ADMIN_API_QWEN_AUDIO_BASE_URL'],
      ''
    ),
    enrollmentModel: readStringFrom(
      [
        'NODE_QWEN_VOICE_ENROLLMENT_MODEL',
        'ADMIN_API_QWEN_VOICE_ENROLLMENT_MODEL',
      ],
      'qwen-audio-3.0-tts-plus'
    ),
    defaultSpeechModel: readStringFrom(
      ['NODE_QWEN_VOICE_SPEECH_MODEL', 'ADMIN_API_QWEN_VOICE_PREVIEW_MODEL'],
      'qwen3-tts-vc-2026-01-22'
    ),
    defaultLanguageType: readStringFrom(
      ['NODE_QWEN_VOICE_LANGUAGE_TYPE', 'NODE_QWEN_VOICE_LANGUAGE'],
      'Auto'
    ),
    timeoutMs: readNumberFrom(
      ['NODE_QWEN_VOICE_TIMEOUT_MS', 'ADMIN_API_QWEN_VOICE_TIMEOUT_MS'],
      120000
    ),
  },
  doubaoVoice: {
    enabled: readBooleanFrom(
      ['NODE_DOUBAO_VOICE_ENABLED', 'ADMIN_API_DOUBAO_VOICE_ENABLED'],
      true
    ),
    apiKey: readStringFrom(
      ['NODE_DOUBAO_VOICE_API_KEY', 'ADMIN_API_DOUBAO_VOICE_API_KEY'],
      ''
    ),
    appId: readStringFrom(
      ['NODE_DOUBAO_VOICE_APP_ID', 'ADMIN_API_DOUBAO_VOICE_APP_ID'],
      ''
    ),
    accessToken: readStringFrom(
      ['NODE_DOUBAO_VOICE_ACCESS_TOKEN', 'ADMIN_API_DOUBAO_VOICE_ACCESS_TOKEN'],
      ''
    ),
    baseURL: readStringFrom(
      ['NODE_DOUBAO_VOICE_BASE_URL', 'ADMIN_API_DOUBAO_VOICE_BASE_URL'],
      'https://openspeech.bytedance.com'
    ),
    resourceId: readStringFrom(
      ['NODE_DOUBAO_VOICE_RESOURCE_ID', 'ADMIN_API_DOUBAO_VOICE_RESOURCE_ID'],
      'seed-icl-2.0'
    ),
    defaultSpeechModel: readStringFrom(
      [
        'NODE_DOUBAO_VOICE_SPEECH_MODEL',
        'ADMIN_API_DOUBAO_VOICE_PREVIEW_MODEL',
      ],
      'seed-tts-2.0-expressive'
    ),
    timeoutMs: readNumberFrom(
      ['NODE_DOUBAO_VOICE_TIMEOUT_MS', 'ADMIN_API_DOUBAO_VOICE_TIMEOUT_MS'],
      120000
    ),
  },
  bailianImage: {
    enabled: readBooleanFrom(
      ['NODE_BAILIAN_IMAGE_ENABLED', 'ADMIN_API_BAILIAN_IMAGE_ENABLED'],
      true
    ),
    apiKey: readStringFrom(
      [
        'NODE_BAILIAN_IMAGE_API_KEY',
        'ADMIN_API_BAILIAN_IMAGE_API_KEY',
        'DASHSCOPE_API_KEY',
      ],
      ''
    ),
    baseURL: readStringFrom(
      ['NODE_BAILIAN_IMAGE_BASE_URL', 'ADMIN_API_BAILIAN_IMAGE_BASE_URL'],
      'https://dashscope.aliyuncs.com'
    ),
    model: readStringFrom(
      ['NODE_BAILIAN_IMAGE_MODEL', 'ADMIN_API_BAILIAN_IMAGE_MODEL'],
      'wan2.7-image-pro'
    ),
    size: readStringFrom(
      ['NODE_BAILIAN_IMAGE_SIZE', 'ADMIN_API_BAILIAN_IMAGE_SIZE'],
      '2K'
    ),
    timeoutMs: readNumberFrom(
      ['NODE_BAILIAN_IMAGE_TIMEOUT_MS', 'ADMIN_API_BAILIAN_IMAGE_TIMEOUT_MS'],
      180000
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
  voiceClipping: {
    binaryPath: readStringFrom(['NODE_FFMPEG_BINARY_PATH'], 'ffmpeg'),
    timeoutMs: readNumberFrom(['NODE_FFMPEG_TIMEOUT_MS'], 300000),
    segmentSeconds: readNumberFrom(['NODE_VOICE_CLIP_SEGMENT_SECONDS'], 12),
    maxClipsPerMaterial: readNumberFrom(
      ['NODE_VOICE_CLIP_MAX_PER_MATERIAL'],
      8
    ),
    maxTotalClips: readNumberFrom(['NODE_VOICE_CLIP_MAX_TOTAL'], 8),
    maxSourceSeconds: readNumberFrom(
      ['NODE_VOICE_CLIP_MAX_SOURCE_SECONDS'],
      180
    ),
    minClipBytes: readNumberFrom(['NODE_VOICE_CLIP_MIN_BYTES'], 4096),
    minUsableDurationSeconds: readNumberFrom(
      ['NODE_VOICE_CLIP_MIN_USABLE_SECONDS'],
      2
    ),
    maxSilenceRatio: readNumberFrom(
      ['NODE_VOICE_CLIP_MAX_SILENCE_RATIO'],
      0.75
    ),
    maxClippingRatio: readNumberFrom(
      ['NODE_VOICE_CLIP_MAX_CLIPPING_RATIO'],
      0.12
    ),
    minRecoverableRmsDb: readNumberFrom(
      ['NODE_VOICE_CLIP_MIN_RECOVERABLE_RMS_DB'],
      -58
    ),
    lowVolumeRmsDb: readNumberFrom(['NODE_VOICE_CLIP_LOW_VOLUME_RMS_DB'], -32),
    targetRmsDb: readNumberFrom(['NODE_VOICE_CLIP_TARGET_RMS_DB'], -22),
    maxVolumeGainDb: readNumberFrom(['NODE_VOICE_CLIP_MAX_VOLUME_GAIN_DB'], 20),
    minSignalToNoiseDb: readNumberFrom(
      ['NODE_VOICE_CLIP_MIN_SIGNAL_TO_NOISE_DB'],
      4
    ),
    warningSignalToNoiseDb: readNumberFrom(
      ['NODE_VOICE_CLIP_WARNING_SIGNAL_TO_NOISE_DB'],
      12
    ),
  },
  voiceAnalysis: {
    enabled: readBooleanFrom(['NODE_VOICE_ANALYSIS_ENABLED'], true),
    apiKey: readStringFrom(
      [
        'NODE_VOICE_ANALYSIS_API_KEY',
        'DASHSCOPE_API_KEY',
        'NODE_QWEN_VOICE_API_KEY',
      ],
      ''
    ),
    baseURL: readStringFrom(
      ['NODE_VOICE_ANALYSIS_BASE_URL'],
      'https://dashscope.aliyuncs.com'
    ),
    model: readStringFrom(['NODE_VOICE_ANALYSIS_MODEL'], 'paraformer-v2'),
    timeoutMs: readNumberFrom(['NODE_VOICE_ANALYSIS_TIMEOUT_MS'], 240000),
    pollIntervalMs: readNumberFrom(
      ['NODE_VOICE_ANALYSIS_POLL_INTERVAL_MS'],
      2000
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
          AgentMemoryFactEntity,
          AgentProfileFactEntity,
          AgentRelationshipSignalEntity,
          AgentShareInviteEntity,
          AgentShareMemberEntity,
          AgentSubEntity,
          ChatSpanEntity,
          ChatTraceEntity,
          ConversationChatImportBatchEntity,
          ConversationChatImportItemEntity,
          ConversationEmotionStateEntity,
          ConversationMessageFeedbackEntity,
          ConversationDeliberateReplyTaskEntity,
          ConversationReplyTurnEntity,
          ConversationEntity,
          CouponLedgerEntity,
          FreeChatAgentLedgerEntity,
          MessageEntity,
          MessengerCallEventEntity,
          OrderEntity,
          OrderRefundEntity,
          PostCommentEntity,
          PostCommentNotificationEntity,
          PostLikeEntity,
          PostNotificationEntity,
          PostEntity,
          UserAccountEntity,
          UserEntity,
          UserIdentityProfileEntity,
          UserKnownPersonEntity,
          UserMembershipEntity,
          VipPlanEntity,
          VoicePackageEntity,
          VoiceServiceSessionEntity,
          VoiceTimbreEntity,
          VoiceTrainingTaskEntity,
        ],
      },
    },
  },
} as MidwayConfig;
