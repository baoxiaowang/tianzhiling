import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { MessageEntity, MessageRole } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAIService } from './openai';
import {
  FAMILY_CARE_REGRET_INTENT_PATTERN,
  GRIEF_CRISIS_INTENT_PATTERN,
  GRIEF_OVERWHELMED_INTENT_PATTERN,
  isDreamConnectionIntent,
  isDreamVisitRequestIntent,
  isReturnVisitRequestIntent,
  REPLY_CAPABILITY_CHANNELS,
  REPLY_CAPABILITY_SUBJECTS,
  REPLY_INTENT_EMOTIONS,
  REPLY_INTENT_KINDS,
  REPLY_INTENT_RISK_LEVELS,
  REPLY_INTENT_SUB_INTENTS,
  REPLY_INTENT_TARGETS,
  REPLY_INTENT_TIME_SCOPES,
  ReplyIntentEmotion,
  ReplyIntentKind,
  ReplyIntentRiskLevel,
  ReplyIntentSubIntent,
  ReplyIntentTarget,
  ReplyIntentTimeScope,
  RETURN_REUNION_WISH_INTENT_PATTERN,
  StructuredReplyCapabilityQuestion,
  StructuredReplyIntent,
  StructuredReplyIntentItem,
} from './reply-intent';

interface ReplyIntentClassifierConfig {
  enabled?: boolean;
  model?: string;
  timeoutMs?: number;
}

export interface ClassifyReplyIntentOptions {
  currentQuery: string;
  recentMessages?: MessageEntity[];
  knownFamilyMembers?: string[];
}

const CLASSIFIER_MAX_HISTORY_MESSAGES = 6;
const CLASSIFIER_MAX_MESSAGE_LENGTH = 180;
const CLASSIFIER_MAX_TOKENS = 320;
const FIRST_PERSON_REFERENCE_PATTERN = /(?:^|[，,。！？!?\s])(?:我|俺|咱)/;
const DEATH_MOMENT_REFERENCE_PATTERN =
  /走的时候|离开的时候|临走|临走前|去世|过世|死的时候|那一刻/;
const DIRECT_AGENT_MEAL_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|今天|早上|早晨|中午|下午|晚上|今晚|在那边|还|也|是不是|有没有)\s*){0,4}(?:(?:不|没|没有|还没|是不是没)\s*)?(?:吃饭|吃东西|吃过|吃了)(?:了吗|了没|吗|么|没|没有|呢|呀|啊|[？?]|$)/;
const DIRECT_AGENT_WAKE_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|今天|早上|早晨|中午|下午|晚上|今晚|在那边|还|也|是不是|有没有)\s*){0,4}(?:(?:不|没|没有|还没|是不是没)\s*)?(?:起床|醒来|睡醒|醒)(?:了吗|了没|吗|么|没|没有|呢|呀|啊|[？?]|$)/;
const DIRECT_AGENT_WORK_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|今天|在那边|还|也|是不是|有没有)\s*){0,4}(?:(?:不|没|没有|还没|是不是没)\s*)?(?:上班|工作)(?:了吗|了没|吗|么|没|没有|累不累|忙不忙|累吗|忙吗|呢|呀|啊|[？?]|$)/;
const DIRECT_AGENT_CURRENT_PAIN_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|如今|在那边|在那里|在那儿|那边|那里|还|也|是不是|有没有|会不会|会)\s*){0,4}(?:身上|身体|伤口)?\s*(?:(?:还|会|是不是|有没有)\s*)?(?:疼不疼|痛不痛|难不难受|受不受苦|疼|痛|难受|受苦)(?:了吗|了没|吗|么|不|没有|呢|呀|啊|[？?]|$)|(?:你|您).{0,12}(?:身体|身上).{0,8}(?:怎么样|还好吗|好不好)[？?，,。！!\s]*(?:还)?(?:疼不疼|痛不痛|难不难受|疼|痛|难受)(?:了吗|吗|么|呢|呀|啊|[？?]|$)|(?:你|您)(?:呢)?[？?，,\s]*(?:现在|如今)(?:身上|身体)?\s*(?:还)?(?:疼不疼|痛不痛|难不难受|疼|痛|难受)(?:了吗|吗|么|呢|呀|啊|[？?]|$)/;
const DIRECT_SHARED_MEMORY_QUERY_PATTERN =
  /(?:你|您).{0,8}(?:还)?记得.{0,30}(?:小时候|以前|那时候|当年|那次|那回|我们|咱们|一起|带我|陪我|跟我|和我)|(?:小时候|以前|那时候|当年|那次|那回).{0,18}(?:你|您).{0,18}(?:带我|陪我|跟我|和我|给我)/;
const CURRENT_OR_FUTURE_WISH_PATTERN =
  /(?:我|俺|咱)(?:现在|最近|这会儿|又|还|也)?想(?:再|又)?(?:去|做|吃|看|玩|试|学)/;

const REPLY_INTENT_CLASSIFIER_SYSTEM_PROMPT = [
  '你是“天之灵”亲情聊天的意图分类器，只做分类，不回复用户。',
  '当前聊天对象 agent 是用户创建的已故亲人角色。必须先判断用户在说谁，再判断时间范围和意图。',
  '重点区分：',
  '1. “你现在还痛吗”是 target=agent、timeScope=current、ask_agent_status/physical_pain。',
  '2. “你走的时候痛吗”是 target=agent、timeScope=death_moment、question_departure/death_pain。',
  '3. “我现在很痛”是 target=user、timeScope=current、share_user_update。',
  '4. “你早上吃饭了吗”是 target=agent、timeScope=current、ask_agent_status/meal。',
  '5. 提到其他亲人的近况是 share_family_update，不要误判成用户本人或当前角色。',
  '6. “我昨晚没睡好”是 target=user、timeScope=current、share_user_update/wake_sleep；睡眠、失眠、早醒都不要标成 other。',
  '7. “我很想你”是 target=relationship、timeScope=timeless、express_longing/grief_support；这里表达的是双方情感连接，即使句中出现“你”，target 也不是 agent。',
  '8. “没有你我撑不住/撑不下去”通常是强烈思念和求安慰；没有明确想死、自伤或通过死亡去陪逝者时，必须标成 seek_comfort，riskLevel=low，不能标成 crisis_support。',
  '9. “我希望你能回来，一家人在一起”是团聚愿望和思念，标成 express_longing/reunion，riskLevel=none；不得因为最近对话里曾出现危机词就把当前愿望标成轻生。',
  '10. “晚上来我梦里可以吗，好久没有梦到你了”是梦中相见请求并包含期待落空，标成 seek_dream_connection/reunion；不能降级成普通 express_longing。',
  '11. “妈妈身体不好，可惜你不能照顾她”重点是对当前角色缺席家庭照护的遗憾；健康近况是这一表达的上下文，不要机械拆成互不相干的用户照护义务。',
  '12. 分享在世家人的看病、检查、慢性健康指标或身体变化时，标成 family/current/share_family_update/family_care；即使检查结果暂时无大碍，也要保留用户庆幸中仍有担心的情绪。',
  '只根据当前用户消息判断当前风险。最近对话只用于消歧，不能把历史高风险状态复制到一条本身不含轻生、自伤或死亡行动意图的当前消息。',
  '若一句话有多个意图，拆成 intents 数组，最多三个；每个意图必须各自判断 target、timeScope、intent、subIntent 和 confidence。',
  'intents[0] 是最需要优先回应的主意图。轻生或自伤意图无论出现在句子哪里都必须放在 intents[0]。',
  '复合示例：“爸你现在还痛吗，我昨晚没睡好，特别想你”依次拆为 agent/current/ask_agent_status/physical_pain、user/current/share_user_update/wake_sleep、relationship/timeless/express_longing/grief_support。',
  '如果当前消息明确询问当前角色能否知道、看见、听见、听到心声、到场、触碰、祝福或了解现实环境，或者追问具体看见/听见了什么，同时输出 capabilityQuestions；普通状态问候、比喻和“你看/听说”等话语标记不要输出能力问题。',
  'capabilityQuestions 最多三个。subject 表示能力类别，channel 表示信息通道，evidence 必须逐字摘自当前用户消息，不能来自历史或自行概括。没有明确能力问题时输出空数组。',
  '能力示例：“你知道现在几点吗”是 time/server_clock；“你看得见我吗/那你具体看见什么”是 vision/live_environment；“我发的话你收到了吗”是 hearing/chat_text；“我喊你能听见吗/你具体听见什么”是 hearing/real_world_audio；“你能听到我的心声吗”是 hearing/inner_voice；“你能回来吗”是 presence/physical_world；“能抱抱我吗”是 physical_contact/physical_world；“你会祝福我吗/是不是你保佑事情办成的”是 blessing/relational_expression。',
  `target 只能是：${REPLY_INTENT_TARGETS.join(', ')}`,
  `timeScope 只能是：${REPLY_INTENT_TIME_SCOPES.join(', ')}`,
  `intent 只能是：${REPLY_INTENT_KINDS.join(', ')}`,
  `subIntent 只能是：${REPLY_INTENT_SUB_INTENTS.join(', ')}`,
  `emotion 只能是：${REPLY_INTENT_EMOTIONS.join(', ')}`,
  `riskLevel 只能是：${REPLY_INTENT_RISK_LEVELS.join(', ')}`,
  `capability subject 只能是：${REPLY_CAPABILITY_SUBJECTS.join(', ')}`,
  `capability channel 只能是：${REPLY_CAPABILITY_CHANNELS.join(', ')}`,
  '每个意图的 confidence 和顶层 confidence 都是 0 到 1 的数字。只有语义非常明确时才高于 0.85；信息不足或依赖上下文时应降低。',
  '严格输出一个 JSON 对象，不要 Markdown，不要解释，不要添加其他字段：',
  '{"intents":[{"target":"agent","timeScope":"current","intent":"ask_agent_status","subIntent":"physical_pain","confidence":0.96}],"capabilityQuestions":[],"emotion":"concern","riskLevel":"none","confidence":0.96}',
].join('\n');

@Provide()
export class ReplyIntentClassifierService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @Config('replyIntent')
  config: ReplyIntentClassifierConfig;

  async classify(
    options: ClassifyReplyIntentOptions
  ): Promise<StructuredReplyIntent | undefined> {
    const currentQuery = options.currentQuery?.trim() || '';

    if (
      !currentQuery ||
      this.config?.enabled === false ||
      !this.openAIService?.isEnabled?.()
    ) {
      return undefined;
    }

    if (GRIEF_CRISIS_INTENT_PATTERN.test(currentQuery)) {
      return {
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'crisis_support',
            subIntent: 'grief_support',
            confidence: 1,
          },
        ],
        emotion: 'sadness',
        riskLevel: 'high',
        confidence: 1,
        source: 'hard_rule',
      };
    }

    const deterministicEmotionalIntent =
      this.classifyDeterministicEmotionalIntent(currentQuery);

    if (deterministicEmotionalIntent) {
      return deterministicEmotionalIntent;
    }

    const deterministicMemoryIntent =
      this.classifyDeterministicMemoryIntent(currentQuery);

    if (deterministicMemoryIntent) {
      return deterministicMemoryIntent;
    }

    const deterministicIntent =
      this.classifyDeterministicAgentStatus(currentQuery);

    if (deterministicIntent) {
      return deterministicIntent;
    }

    const timeoutMs = this.resolveTimeoutMs();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          model: this.config?.model?.trim() || undefined,
          temperature: 0,
          topP: 0.2,
          reasoningSplit: false,
          thinking: {
            type: 'disabled',
          },
          max_tokens: CLASSIFIER_MAX_TOKENS,
          messages: [
            {
              role: 'system',
              content: REPLY_INTENT_CLASSIFIER_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: this.buildClassifierInput(options),
            },
          ] as ChatCompletionMessageParam[],
        },
        {
          signal: abortController.signal,
          timeout: timeoutMs,
        }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const intent = this.parseIntent(content, currentQuery);

      if (!intent) {
        this.logger?.warn?.(
          '[reply-intent] classifier returned invalid output, query=%s',
          currentQuery.slice(0, 120)
        );
      }

      return intent;
    } catch (error) {
      this.logger?.warn?.(
        '[reply-intent] classifier failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private classifyDeterministicEmotionalIntent(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    if (GRIEF_OVERWHELMED_INTENT_PATTERN.test(currentQuery)) {
      return {
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'seek_comfort',
            subIntent: 'grief_support',
            confidence: 0.99,
          },
        ],
        emotion: 'sadness',
        riskLevel: 'low',
        confidence: 0.99,
        source: 'hard_rule',
      };
    }

    if (isDreamConnectionIntent(currentQuery)) {
      return {
        intents: [
          {
            target: 'relationship',
            timeScope: isDreamVisitRequestIntent(currentQuery)
              ? 'future'
              : 'timeless',
            intent: 'seek_dream_connection',
            subIntent: 'reunion',
            confidence: 0.99,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      };
    }

    if (
      RETURN_REUNION_WISH_INTENT_PATTERN.test(currentQuery) ||
      isReturnVisitRequestIntent(currentQuery)
    ) {
      return {
        intents: [
          {
            target: 'relationship',
            timeScope: 'future',
            intent: 'express_longing',
            subIntent: 'reunion',
            confidence: 0.99,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      };
    }

    if (FAMILY_CARE_REGRET_INTENT_PATTERN.test(currentQuery)) {
      return {
        intents: [
          {
            target: 'family',
            timeScope: 'current',
            intent: 'share_family_update',
            subIntent: 'family_care',
            confidence: 0.98,
          },
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'express_family_care_regret',
            subIntent: 'family_care',
            confidence: 0.96,
          },
        ],
        emotion: 'sadness',
        riskLevel: 'none',
        confidence: 0.97,
        source: 'hard_rule',
      };
    }

    return undefined;
  }

  private classifyDeterministicMemoryIntent(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    if (!DIRECT_SHARED_MEMORY_QUERY_PATTERN.test(currentQuery)) {
      return undefined;
    }

    const intents: StructuredReplyIntentItem[] = [
      {
        target: 'agent',
        timeScope: 'shared_past',
        intent: 'recall_memory',
        subIntent: 'shared_memory',
        confidence: 0.99,
      },
    ];

    if (CURRENT_OR_FUTURE_WISH_PATTERN.test(currentQuery)) {
      intents.push({
        target: 'user',
        timeScope: 'future',
        intent: 'share_user_update',
        subIntent: 'other',
        confidence: 0.96,
      });
    }

    return {
      intents,
      emotion: 'longing',
      riskLevel: 'none',
      confidence: intents.length > 1 ? 0.97 : 0.99,
      source: 'hard_rule',
    };
  }

  private classifyDeterministicAgentStatus(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    if (
      FIRST_PERSON_REFERENCE_PATTERN.test(currentQuery) ||
      DEATH_MOMENT_REFERENCE_PATTERN.test(currentQuery)
    ) {
      return undefined;
    }

    const subIntent: ReplyIntentSubIntent | undefined =
      DIRECT_AGENT_CURRENT_PAIN_QUERY_PATTERN.test(currentQuery)
        ? 'physical_pain'
        : DIRECT_AGENT_MEAL_QUERY_PATTERN.test(currentQuery)
        ? 'meal'
        : DIRECT_AGENT_WAKE_QUERY_PATTERN.test(currentQuery)
        ? 'wake_sleep'
        : DIRECT_AGENT_WORK_QUERY_PATTERN.test(currentQuery)
        ? 'work_routine'
        : undefined;

    if (!subIntent) {
      return undefined;
    }

    return {
      intents: [
        {
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent,
          confidence: 0.99,
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      confidence: 0.99,
      source: 'hard_rule',
    };
  }

  private buildClassifierInput(options: ClassifyReplyIntentOptions): string {
    const currentQuery = options.currentQuery.trim();
    const recentMessages = (options.recentMessages || []).filter(
      message =>
        (message.role === MessageRole.user ||
          message.role === MessageRole.assistant) &&
        Boolean(message.content?.trim())
    );
    const duplicateCurrentIndex = this.findLastDuplicateCurrentMessageIndex(
      recentMessages,
      currentQuery
    );
    const history = recentMessages
      .filter((_, index) => index !== duplicateCurrentIndex)
      .slice(-CLASSIFIER_MAX_HISTORY_MESSAGES)
      .map(message => {
        const role =
          message.role === MessageRole.user ? '用户' : '当前亲人角色';
        return `${role}：${message.content
          .trim()
          .slice(0, CLASSIFIER_MAX_MESSAGE_LENGTH)}`;
      })
      .join('\n');
    const knownFamilyMembers = Array.from(
      new Set(
        (options.knownFamilyMembers || [])
          .map(name => name.trim())
          .filter(Boolean)
      )
    )
      .slice(0, 12)
      .join('、');

    return [
      knownFamilyMembers
        ? `已确认的其他共同家人：${knownFamilyMembers}`
        : '已确认的其他共同家人：无',
      history ? `最近对话：\n${history}` : '最近对话：无',
      `当前用户消息：${currentQuery}`,
    ].join('\n\n');
  }

  private findLastDuplicateCurrentMessageIndex(
    messages: MessageEntity[],
    currentQuery: string
  ): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (
        message.role === MessageRole.user &&
        message.content?.trim() === currentQuery
      ) {
        return index;
      }
    }

    return -1;
  }

  private parseIntent(
    value: string,
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    const jsonText = this.extractJsonObjectText(value);

    if (!jsonText) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const emotion = this.readEnum(parsed.emotion, REPLY_INTENT_EMOTIONS);
      const riskLevel = this.readEnum(
        parsed.riskLevel,
        REPLY_INTENT_RISK_LEVELS
      );
      const confidence = this.readConfidence(parsed.confidence);
      const rawIntents = Array.isArray(parsed.intents)
        ? parsed.intents.slice(0, 3)
        : [];
      const parsedIntents = rawIntents.map(item => this.parseIntentItem(item));
      const capabilityQuestions = this.parseCapabilityQuestions(
        parsed.capabilityQuestions,
        currentQuery
      );

      if (
        !rawIntents.length ||
        parsedIntents.some(item => !item) ||
        !emotion ||
        !riskLevel ||
        confidence === undefined
      ) {
        return undefined;
      }

      const intents = (parsedIntents as StructuredReplyIntentItem[]).filter(
        (item, index, values) =>
          values.findIndex(
            candidate =>
              candidate.intent === item.intent &&
              candidate.target === item.target &&
              candidate.timeScope === item.timeScope &&
              candidate.subIntent === item.subIntent
          ) === index
      );

      const result: StructuredReplyIntent = {
        intents,
        emotion: emotion as ReplyIntentEmotion,
        riskLevel: riskLevel as ReplyIntentRiskLevel,
        confidence,
        source: 'semantic_model',
      };

      if (capabilityQuestions.length) {
        result.capabilityQuestions = capabilityQuestions;
      }

      return result;
    } catch {
      return undefined;
    }
  }

  private parseIntentItem(
    value: unknown
  ): StructuredReplyIntentItem | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const target = this.readEnum(item.target, REPLY_INTENT_TARGETS);
    const timeScope = this.readEnum(item.timeScope, REPLY_INTENT_TIME_SCOPES);
    const intent = this.readEnum(item.intent, REPLY_INTENT_KINDS);
    const subIntent = this.readEnum(item.subIntent, REPLY_INTENT_SUB_INTENTS);
    const confidence = this.readConfidence(item.confidence);

    if (
      !target ||
      !timeScope ||
      !intent ||
      !subIntent ||
      confidence === undefined
    ) {
      return undefined;
    }

    return {
      target: target as ReplyIntentTarget,
      timeScope: timeScope as ReplyIntentTimeScope,
      intent: intent as ReplyIntentKind,
      subIntent: subIntent as ReplyIntentSubIntent,
      confidence,
    };
  }

  private parseCapabilityQuestions(
    value: unknown,
    currentQuery: string
  ): StructuredReplyCapabilityQuestion[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .slice(0, 3)
      .map(item => this.parseCapabilityQuestion(item, currentQuery))
      .filter((item): item is StructuredReplyCapabilityQuestion =>
        Boolean(item)
      )
      .filter(
        (item, index, items) =>
          items.findIndex(
            candidate =>
              candidate.subject === item.subject &&
              candidate.channel === item.channel
          ) === index
      );
  }

  private parseCapabilityQuestion(
    value: unknown,
    currentQuery: string
  ): StructuredReplyCapabilityQuestion | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const subject = this.readEnum(item.subject, REPLY_CAPABILITY_SUBJECTS);
    const channel = this.readEnum(item.channel, REPLY_CAPABILITY_CHANNELS);
    const evidence =
      typeof item.evidence === 'string' ? item.evidence.trim() : '';
    const confidence = this.readConfidence(item.confidence);

    if (
      !subject ||
      !channel ||
      !evidence ||
      !currentQuery.includes(evidence) ||
      confidence === undefined
    ) {
      return undefined;
    }

    return {
      subject,
      channel,
      evidence: evidence.slice(0, 80),
      confidence,
    };
  }

  private extractJsonObjectText(value: string): string {
    const trimmed = value?.trim() || '';
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');

    return start >= 0 && end > start ? trimmed.slice(start, end + 1) : '';
  }

  private readEnum<T extends readonly string[]>(
    value: unknown,
    allowed: T
  ): T[number] | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return allowed.includes(normalized as T[number])
      ? (normalized as T[number])
      : undefined;
  }

  private readConfidence(value: unknown): number | undefined {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
        ? Number(value)
        : NaN;

    if (!Number.isFinite(parsed)) {
      return undefined;
    }

    return Math.max(0, Math.min(1, parsed));
  }

  private resolveTimeoutMs(): number {
    const value = this.config?.timeoutMs;

    return typeof value === 'number' && Number.isFinite(value) && value >= 500
      ? Math.min(Math.round(value), 10000)
      : 8000;
  }
}
