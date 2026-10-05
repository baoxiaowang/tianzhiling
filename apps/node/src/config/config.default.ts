import { MidwayConfig } from '@midwayjs/core';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { isAbsolute, resolve } from 'path';
import {
  AgentEntity,
  AppPreviewGrantEntity,
  AppTestGrantEntity,
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
  MemoryEventGroupEntity,
  MemoryOpenItemEntity,
  MemoryPipelineTaskEntity,
  MessengerCallEventEntity,
  OrderEntity,
  OrderRefundEntity,
  PersonTemporalAssertionEntity,
  PersonTemporalProfileEntity,
  PostCommentEntity,
  PostCommentNotificationEntity,
  PostLikeEntity,
  PostNotificationEntity,
  PostEntity,
  UserAccountEntity,
  UserEntity,
  UserIdentityProfileEntity,
  UserKnownPersonEntity,
  UserRelativeFactEntity,
  UserRelativeProfileEntity,
  UserSelfFactEntity,
  UserMembershipEntity,
  VipPlanEntity,
  VoicePackageEntity,
  VoiceServiceSessionEntity,
  VoiceTimbreEntity,
  VoiceTrainingTaskEntity,
} from '@tzl/entities';
import { MessageUserCountSubscriber } from '../subscriber/message-user-count.subscriber';

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

function readStringListFrom(names: string[], fallback: string[]): string[] {
  for (const name of names) {
    const raw = process.env[name];

    if (raw == null) {
      continue;
    }

    const items = raw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

    if (items.length > 0) {
      return items;
    }
  }

  return [...fallback];
}

function readNumberRecordFrom(
  names: string[],
  fallback: Record<string, number>
): Record<string, number> {
  for (const name of names) {
    const raw = process.env[name];

    if (raw == null || !raw.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }

      const result: Record<string, number> = {};

      for (const [key, value] of Object.entries(parsed)) {
        const numeric =
          typeof value === 'number' ? value : Number(value as string);
        const normalizedKey = key.trim();

        if (normalizedKey && Number.isFinite(numeric) && numeric > 0) {
          result[normalizedKey] = Math.floor(numeric);
        }
      }

      // 有配置项但全部非法：按配置错误处理，整体回退默认值，
      // 避免一个笔误静默丢掉默认的目录上限。显式 {} 表示清空。
      if (Object.keys(parsed).length > 0 && Object.keys(result).length === 0) {
        continue;
      }

      return result;
    } catch {
      // 配置为非法 JSON 时回退默认值，避免启动失败。
    }
  }

  return { ...fallback };
}

function readRatioRecordFrom(
  names: string[],
  fallback: Record<string, number>
): Record<string, number> {
  for (const name of names) {
    const raw = process.env[name];

    if (raw == null || !raw.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }

      const result: Record<string, number> = {};

      for (const [key, value] of Object.entries(parsed)) {
        const numeric =
          typeof value === 'number' ? value : Number(value as string);
        const normalizedKey = key.trim();

        // 抽样比例保留小数，取值范围 (0, 1]。
        if (
          normalizedKey &&
          Number.isFinite(numeric) &&
          numeric > 0 &&
          numeric <= 1
        ) {
          result[normalizedKey] = numeric;
        }
      }

      // 有配置项但全部非法：按配置错误处理，整体回退默认值，
      // 避免一个笔误静默丢掉默认的保护性抽样比例。显式 {} 表示清空。
      if (Object.keys(parsed).length > 0 && Object.keys(result).length === 0) {
        continue;
      }

      return result;
    } catch {
      // 配置为非法 JSON 时回退默认值，避免启动失败。
    }
  }

  return { ...fallback };
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
    // 记忆抽取专用模型：与聊天回复分开；未单独配置时回落聊天 fallback。
    memory: {
      apiKey: readStringFrom(
        ['NODE_MEMORY_API_KEY', 'NODE_CHAT_FALLBACK_API_KEY'],
        ''
      ),
      baseURL: readStringFrom(
        ['NODE_MEMORY_BASE_URL', 'NODE_CHAT_FALLBACK_BASE_URL'],
        'https://api.deepseek.com'
      ),
      model: readStringFrom(
        ['NODE_MEMORY_MODEL', 'NODE_CHAT_FALLBACK_MODEL'],
        'deepseek-flash'
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
  // 回复链路追踪。追踪用 AsyncLocalStorage 承载 traceId，而 ALS 会给链路里
  // 每一个 promise 都增加 async_hooks 传播开销；实测关闭后聊天端 CPU 显著下降。
  // 生产可用 NODE_CHAT_TRACE_ENABLED=false 关掉，排查问题再打开。
  chatTrace: {
    enabled: readBooleanFrom(['NODE_CHAT_TRACE_ENABLED'], true),
    artifactSampleRate: readOptionalNumberFrom([
      'NODE_CHAT_TRACE_ARTIFACT_SAMPLE_RATE',
    ]),
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
  tencentVrs: {
    enabled: readBooleanFrom(
      ['NODE_TENCENT_VRS_ENABLED', 'ADMIN_API_TENCENT_VRS_ENABLED'],
      false
    ),
    secretId: readStringFrom(
      ['NODE_TENCENT_VRS_SECRET_ID', 'ADMIN_API_TENCENT_VRS_SECRET_ID'],
      ''
    ),
    secretKey: readStringFrom(
      ['NODE_TENCENT_VRS_SECRET_KEY', 'ADMIN_API_TENCENT_VRS_SECRET_KEY'],
      ''
    ),
    securityToken: readStringFrom(
      [
        'NODE_TENCENT_VRS_SECURITY_TOKEN',
        'ADMIN_API_TENCENT_VRS_SECURITY_TOKEN',
      ],
      ''
    ),
    region: readStringFrom(
      ['NODE_TENCENT_VRS_REGION', 'ADMIN_API_TENCENT_VRS_REGION'],
      'ap-guangzhou'
    ),
    vrsEndpoint: readStringFrom(
      ['NODE_TENCENT_VRS_ENDPOINT', 'ADMIN_API_TENCENT_VRS_ENDPOINT'],
      'https://vrs.tencentcloudapi.com'
    ),
    ttsEndpoint: readStringFrom(
      [
        'NODE_TENCENT_VRS_TTS_ENDPOINT',
        'ADMIN_API_TENCENT_VRS_TTS_ENDPOINT',
      ],
      'https://tts.tencentcloudapi.com'
    ),
    vrsVersion: readStringFrom(
      ['NODE_TENCENT_VRS_VERSION', 'ADMIN_API_TENCENT_VRS_VERSION'],
      '2020-08-24'
    ),
    ttsVersion: readStringFrom(
      ['NODE_TENCENT_VRS_TTS_VERSION', 'ADMIN_API_TENCENT_VRS_TTS_VERSION'],
      '2019-08-23'
    ),
    singleSentenceVoiceType: readStringFrom(
      [
        'NODE_TENCENT_VRS_SINGLE_SENTENCE_VOICE_TYPE',
        'ADMIN_API_TENCENT_VRS_SINGLE_SENTENCE_VOICE_TYPE',
      ],
      '200000000'
    ),
    defaultVoiceGender: readStringFrom(
      [
        'NODE_TENCENT_VRS_DEFAULT_VOICE_GENDER',
        'ADMIN_API_TENCENT_VRS_DEFAULT_VOICE_GENDER',
      ],
      '2'
    ),
    defaultSampleRate: readStringFrom(
      [
        'NODE_TENCENT_VRS_DEFAULT_SAMPLE_RATE',
        'ADMIN_API_TENCENT_VRS_DEFAULT_SAMPLE_RATE',
      ],
      '16000'
    ),
    timeoutMs: readNumberFrom(
      ['NODE_TENCENT_VRS_TIMEOUT_MS', 'ADMIN_API_TENCENT_VRS_TIMEOUT_MS'],
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
  aiContentLabel: {
    enabled: readBooleanFrom(['NODE_AI_CONTENT_LABEL_ENABLED'], true),
    providerName: readStringFrom(
      ['NODE_AI_CONTENT_LABEL_PROVIDER'],
      '武汉市天之灵智能技术有限公司'
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
      'conversation_message_memory_v2'
    ),
    schemaVersion: readStringFrom(
      ['NODE_MILVUS_SCHEMA_VERSION'],
      'conversation_message_memory_v2'
    ),
    analyzer: readStringFrom(['NODE_MILVUS_ANALYZER'], 'chinese'),
    writeEnabled: readBooleanFrom(['NODE_MILVUS_WRITE_ENABLED'], true),
    retrievalMode: readStringFrom(['NODE_MILVUS_RETRIEVAL_MODE'], 'off'),
    maxTextLength: readNumberFrom(['NODE_MILVUS_MAX_TEXT_LENGTH'], 4096),
    topK: readNumberFrom(['NODE_MILVUS_TOP_K'], 6),
    searchEf: readNumberFrom(['NODE_MILVUS_SEARCH_EF'], 64),
    minScore: readOptionalNumberFrom(['NODE_MILVUS_MIN_SCORE']),
    minPersonScore: readOptionalNumberFrom(['NODE_MILVUS_MIN_PERSON_SCORE']),
    minRawScore: readOptionalNumberFrom(['NODE_MILVUS_MIN_RAW_SCORE']),
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
  tencentAsr: {
    appId: readStringFrom(['NODE_TENCENT_ASR_APP_ID'], ''),
    secretId: readStringFrom(['NODE_TENCENT_ASR_SECRET_ID'], ''),
    secretKey: readStringFrom(['NODE_TENCENT_ASR_SECRET_KEY'], ''),
    engineModelType: readStringFrom(
      ['NODE_TENCENT_ASR_ENGINE_MODEL_TYPE'],
      '16k_zh'
    ),
  },
  // 内容审核（图片）与上传配额：与品牌、支付、域名配置分离，便于单独核验与回滚。
  imageModeration: {
    // 关闭时完全保持历史行为：上传成功即返回，不做任何审核调用。
    enabled: readBooleanFrom(['NODE_IMAGE_MODERATION_ENABLED'], false),
    // 审核策略唯一标识；留空使用控制台默认策略（场景即计费倍数，必须显式确认）。
    bizType: readStringFrom(['NODE_IMAGE_MODERATION_BIZ_TYPE'], ''),
    // 只审核用户产生内容的目录；服务端生成与运营资产不审，避免无效审核费用。
    folders: readStringListFrom(
      ['NODE_IMAGE_MODERATION_FOLDERS'],
      [
        'moments',
        'avatars',
        'contact-covers',
        'conversation-images',
        'chat-imports',
        'memorial-source-photos',
      ]
    ),
    // 疑似违规（Result=2）：block 拦截，其他值放行并记日志等待人工复核。
    reviewAction: readStringFrom(
      ['NODE_IMAGE_MODERATION_REVIEW_ACTION'],
      'allow'
    ),
    // 分层审核：公开目录（可传播内容）用上面的策略全量审；
    // 私密目录（仅本人可见、但会进模型）改用红线策略 + 抽样，用来压缩成本。
    restrictedFolders: readStringListFrom(
      ['NODE_IMAGE_MODERATION_RESTRICTED_FOLDERS'],
      ['conversation-images', 'chat-imports', 'memorial-source-photos']
    ),
    // 私密目录的红线策略（只勾色情等内容）；留空退回上面的 bizType。
    restrictedBizType: readStringFrom(
      ['NODE_IMAGE_MODERATION_RESTRICTED_BIZ_TYPE'],
      ''
    ),
    restrictedSampleRate: readNumberFrom(
      ['NODE_IMAGE_MODERATION_RESTRICTED_SAMPLE_RATE'],
      0.05
    ),
    folderSampleRates: readRatioRecordFrom(
      ['NODE_IMAGE_MODERATION_FOLDER_SAMPLE_RATES'],
      // 亲人素材会进入 AI 合成链路（深度合成合规重点），保持全量。
      { 'memorial-source-photos': 1 }
    ),
    // 审核服务不可用（超时/报错/结构无法识别）：block 拦截，其他值放行并告警。
    failureAction: readStringFrom(
      ['NODE_IMAGE_MODERATION_FAILURE_ACTION'],
      'allow'
    ),
    // 超过 5MB 的图片需要压缩后审核，会产生基础图片处理费用，默认关闭。
    largeImageDetect: readBooleanFrom(
      ['NODE_IMAGE_MODERATION_LARGE_IMAGE_DETECT'],
      false
    ),
    timeoutMs: readNumberFrom(['NODE_IMAGE_MODERATION_TIMEOUT_MS'], 8000),
    // 首次上线需要靠原始响应核对返回结构，确认后可关闭。
    logRawResponse: readBooleanFrom(['NODE_IMAGE_MODERATION_LOG_RAW'], true),
  },
  uploadQuota: {
    enabled: readBooleanFrom(['NODE_UPLOAD_QUOTA_ENABLED'], true),
    dailyFilesPerUser: readNumberFrom(['NODE_UPLOAD_QUOTA_DAILY_FILES'], 50),
    dailyImageFilesPerUser: readNumberFrom(
      ['NODE_UPLOAD_QUOTA_DAILY_IMAGE_FILES'],
      30
    ),
    // 256MB：客户端上传前不压图，一次聊天导入（30 张截图）最坏约 150MB，
    // 留出余量避免导入中途被字节上限打断。
    dailyBytesPerUser: readNumberFrom(
      ['NODE_UPLOAD_QUOTA_DAILY_BYTES'],
      256 * 1024 * 1024
    ),
    folderDailyFiles: readNumberRecordFrom(
      ['NODE_UPLOAD_QUOTA_FOLDER_LIMITS'],
      {
        // 聊天导入：一天一批，且豁免全局文件数/图片数计数。
        'chat-imports': 30,
        // 3 帖 × 9 图上限。
        moments: 27,
        'conversation-images': 15,
        avatars: 5,
        'contact-covers': 5,
        // 与纪念馆照片非会员 3 次、会员 10 次的每日生成配额对齐。
        'memorial-source-photos': 10,
      }
    ),
    exemptFolders: readStringListFrom(
      ['NODE_UPLOAD_QUOTA_EXEMPT_FOLDERS'],
      ['chat-imports']
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
          AppPreviewGrantEntity,
          AppTestGrantEntity,
  AppTestGrantEntity,
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
          MemoryEventGroupEntity,
          MemoryOpenItemEntity,
          MemoryPipelineTaskEntity,
          MessengerCallEventEntity,
          OrderEntity,
          OrderRefundEntity,
          PersonTemporalAssertionEntity,
          PersonTemporalProfileEntity,
          PostCommentEntity,
          PostCommentNotificationEntity,
          PostLikeEntity,
          PostNotificationEntity,
          PostEntity,
          UserAccountEntity,
          UserEntity,
          UserIdentityProfileEntity,
          UserKnownPersonEntity,
          UserRelativeFactEntity,
          UserRelativeProfileEntity,
          UserSelfFactEntity,
          UserMembershipEntity,
          VipPlanEntity,
          VoicePackageEntity,
          VoiceServiceSessionEntity,
          VoiceTimbreEntity,
          VoiceTrainingTaskEntity,
        ],
        subscribers: [MessageUserCountSubscriber],
      },
    },
  },
} as MidwayConfig;
