import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  AgentProfileFactAssertionPolicy,
  AgentProfileFactConfidence,
  AgentProfileFactEntity,
  AgentProfileFactPolarity,
  AgentProfileFactStatus,
  AgentProfileFactType,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { OpenAIService } from './openai';
import { UserIdentityMemoryService } from './user-identity-memory.service';
import {
  buildSharedFamilyMemberFactKey,
  extractSharedFamilyMemberDeclarations,
  getSharedFamilyMemberNameFromFactKey,
} from './shared-family-member';
import {
  extractForgetMemoryTarget,
  isExplicitRememberRequest,
  isDeicticForgetMemoryRequest,
  isForgetMemoryRequest,
  shouldArchiveMemoryValue,
} from './agent-memory-control';
import {
  AGENT_REAL_NAME_FACT_KEY,
  AGENT_REAL_NAME_HISTORY_FACT_PREFIX,
  AGENT_EXPLICIT_ALIAS_FACT_PREFIX,
  AGENT_PREFERRED_NAME_FACT_KEY,
  USER_REAL_NAME_FACT_KEY,
  USER_REAL_NAME_HISTORY_FACT_PREFIX,
  USER_EXPLICIT_ALIAS_FACT_PREFIX,
  USER_PREFERRED_NAME_FACT_KEY,
  extractAgentNameMemory,
  extractUserNameMemory,
  isNameMemoryFactKey,
  isExplicitCanonicalNameReplacement,
  isValidatedNameFactForSource,
} from './agent-name-memory';

export interface AgentProfileFactSummary {
  id?: string;
  type: AgentProfileFactType;
  key: string;
  value: string;
  polarity: AgentProfileFactPolarity;
  confidence: AgentProfileFactConfidence;
  priority: number;
  status?: AgentProfileFactStatus;
  assertionPolicy?: AgentProfileFactAssertionPolicy;
  sourceMessageId?: string;
  sourceText?: string;
  supportCount?: number;
  conflictingValues?: string[];
  updatedAt?: Date;
}

export interface RecordAgentUserCorrectionOptions {
  message: MessageEntity;
  subjectRef: string;
  correctionKind: 'fact' | 'relationship' | 'memory' | 'persona';
  rejectedFact: string;
  replacementFact?: string;
}

interface ExtractProfileFactsOptions {
  message: MessageEntity;
  searchableText: string;
  explicitlyConfirmed?: boolean;
  previousAssistantContent?: string;
}

interface ExtractProfileFactsFromFeedbackOptions {
  feedbackId: MongoObjectId;
  userId: MongoObjectId;
  agentId: MongoObjectId;
  messageId: MongoObjectId;
  feedbackType: string;
  feedbackContent?: string;
  assistantContent?: string;
}

interface ListProfileFactsOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  limit?: number;
}

export type AgentVisualIdentityTarget = 'agent' | 'user' | 'family' | 'unknown';

export type AgentVisualIdentityConfidence = 'low' | 'medium' | 'high';

export type AgentVisualAppearanceTraitKind =
  | 'hair_color'
  | 'hair_length'
  | 'face_shape'
  | 'eyewear'
  | 'facial_hair'
  | 'build'
  | 'distinctive';

export interface AgentVisualAppearanceTrait {
  kind: AgentVisualAppearanceTraitKind;
  value: string;
}

export interface AgentVisualAppearanceObservation {
  personId: string;
  identityTarget: AgentVisualIdentityTarget;
  identityName?: string;
  identityConfidence: AgentVisualIdentityConfidence;
  traits: AgentVisualAppearanceTrait[];
}

interface UpsertVisualAppearanceOptions {
  message: MessageEntity;
  observations: AgentVisualAppearanceObservation[];
}

export interface UpsertHistoricalImportFactOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  sourceMessageId?: MongoObjectId;
  sourceMessageIds?: MongoObjectId[];
  sourceText?: string;
  type: AgentProfileFactType;
  key: string;
  value: string;
  polarity?: AgentProfileFactPolarity;
  priority?: number;
  activate?: boolean;
}

interface ArchiveProfileFactsOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  requestText: string;
}

export type AgentProfileMemorySourceField =
  | 'lifeExperience'
  | 'personalityTraits'
  | 'languageHabits'
  | 'hobbies'
  | 'sharedMemories';

interface SyncAgentProfileMemorySourcesOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  sources: Partial<Record<AgentProfileMemorySourceField, string>>;
  sourceMessageId?: MongoObjectId;
  sourceText?: string;
}

interface UpsertProfileFactInput
  extends Omit<AgentProfileFactSummary, 'sourceMessageId'> {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  sourceMessageId?: MongoObjectId;
  sourceMessageIds?: MongoObjectId[];
  sourceFeedbackId?: MongoObjectId;
  sourceText?: string;
  trustedSource: boolean;
  forceCandidate?: boolean;
}

interface ExtractedProfileFact {
  fact: AgentProfileFactSummary;
  trustedSource: boolean;
  forceCandidate?: boolean;
}

const DEFAULT_FACT_LIMIT = 32;
const VISUAL_APPEARANCE_KEY_PREFIX = 'visual.appearance.';
const VISUAL_APPEARANCE_TRAIT_KINDS = new Set<AgentVisualAppearanceTraitKind>([
  'hair_color',
  'hair_length',
  'face_shape',
  'eyewear',
  'facial_hair',
  'build',
  'distinctive',
]);
export const AGENT_PROFILE_MEMORY_SOURCE_CONFIG: Record<
  AgentProfileMemorySourceField,
  {
    type: AgentProfileFactType;
    key: string;
    valuePrefix: string;
    priority: number;
  }
> = {
  lifeExperience: {
    type: AgentProfileFactType.memory,
    key: 'profile_source.life_experience',
    valuePrefix: '当前角色生平经历：',
    priority: 3,
  },
  personalityTraits: {
    type: AgentProfileFactType.style,
    key: 'profile_source.personality_traits',
    valuePrefix: '当前角色性格特点：',
    priority: 3,
  },
  languageHabits: {
    type: AgentProfileFactType.style,
    key: 'profile_source.language_habits',
    valuePrefix: '当前角色语言习惯：',
    priority: 3,
  },
  hobbies: {
    type: AgentProfileFactType.preference,
    key: 'profile_source.hobbies',
    valuePrefix: '当前角色兴趣爱好：',
    priority: 2,
  },
  sharedMemories: {
    type: AgentProfileFactType.memory,
    key: 'profile_source.shared_memories',
    valuePrefix: '用户与当前角色的共同记忆：',
    priority: 3,
  },
};

@Provide()
export class AgentProfileFactService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(AgentProfileFactEntity)
  factModel: MongoRepository<AgentProfileFactEntity>;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  userIdentityMemoryService: UserIdentityMemoryService;

  async extractAndUpsertFromUserMessage(
    options: ExtractProfileFactsOptions
  ): Promise<AgentProfileFactSummary[]> {
    const sourceText = this.normalizeSourceText(options.searchableText);

    if (!sourceText || isForgetMemoryRequest(sourceText)) {
      return [];
    }

    const extractedFacts = await this.extractFacts(sourceText, {
      previousAssistantContent: options.previousAssistantContent,
    });

    let userIdentityWriteSucceeded = false;
    try {
      if (this.userIdentityMemoryService) {
        await this.userIdentityMemoryService.recordFromUserMessage(
          options.message,
          sourceText
        );
        userIdentityWriteSucceeded = true;
      }
    } catch (error) {
      this.logger?.warn?.(
        '[agent-profile-fact] user identity write failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
    }

    for (const extracted of extractedFacts) {
      if (
        userIdentityWriteSucceeded &&
        this.isGlobalUserIdentityFactKey(extracted.fact.key)
      ) {
        continue;
      }
      await this.upsertFact({
        ...extracted.fact,
        userId: options.message.userId,
        agentId: options.message.agentId,
        sourceMessageId: options.message.id,
        sourceText,
        trustedSource:
          !extracted.forceCandidate &&
          (options.explicitlyConfirmed === true ||
            isExplicitRememberRequest(sourceText) ||
            extracted.trustedSource),
        forceCandidate: extracted.forceCandidate,
      });
    }

    return extractedFacts.map(item => item.fact);
  }

  private isGlobalUserIdentityFactKey(key: string): boolean {
    return (
      key === USER_REAL_NAME_FACT_KEY ||
      key.startsWith(USER_REAL_NAME_HISTORY_FACT_PREFIX) ||
      key === 'user.identity.aliases.derived'
    );
  }

  async extractAndUpsertFromFeedback(
    options: ExtractProfileFactsFromFeedbackOptions
  ): Promise<AgentProfileFactSummary[]> {
    const sourceText = this.buildFeedbackSourceText(options);

    if (!sourceText) {
      return [];
    }

    const extractedFacts = await this.extractFacts(sourceText, {
      fromFeedback: true,
      feedbackType: options.feedbackType,
    });

    for (const extracted of extractedFacts) {
      await this.upsertFact({
        ...extracted.fact,
        userId: options.userId,
        agentId: options.agentId,
        sourceMessageId: options.messageId,
        sourceFeedbackId: options.feedbackId,
        sourceText,
        trustedSource: true,
      });
    }

    return extractedFacts.map(item => item.fact);
  }

  async upsertFromHistoricalImport(
    options: UpsertHistoricalImportFactOptions
  ): Promise<AgentProfileFactEntity | null> {
    const key = options.key?.trim().slice(0, 160);
    const value = options.value?.trim().slice(0, 500);

    if (!key || !value) {
      return null;
    }

    return this.upsertFact({
      userId: options.userId,
      agentId: options.agentId,
      sourceMessageId: options.sourceMessageId,
      sourceMessageIds: options.sourceMessageIds,
      sourceText: options.sourceText,
      type: options.type,
      key,
      value,
      polarity: options.polarity ?? AgentProfileFactPolarity.positive,
      confidence: AgentProfileFactConfidence.extracted,
      status: AgentProfileFactStatus.candidate,
      priority: options.priority ?? 1,
      trustedSource: options.activate === true,
    });
  }

  async removeHistoricalSourceMessage(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    sourceMessageId: MongoObjectId;
  }): Promise<number> {
    const facts = await this.factModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        key: { $regex: '^wechat_import\\.' },
        $or: [
          { sourceMessageId: options.sourceMessageId },
          { sourceMessageIds: options.sourceMessageId },
        ],
      } as never,
    });
    const sourceId = this.stringifyObjectId(options.sourceMessageId);
    const now = new Date();
    let archivedCount = 0;

    for (const fact of facts) {
      const remaining = (fact.sourceMessageIds || [])
        .filter(value => this.stringifyObjectId(value) !== sourceId)
        .filter(
          (value, index, values) =>
            values.findIndex(
              candidate =>
                this.stringifyObjectId(candidate) ===
                this.stringifyObjectId(value)
            ) === index
        );

      fact.sourceMessageIds = remaining;
      fact.sourceMessageId = remaining[0];
      if (!remaining.length) {
        fact.status = AgentProfileFactStatus.archived;
        archivedCount += 1;
      }
      fact.updatedAt = now;
      await this.factModel.save(fact);
    }

    return archivedCount;
  }

  async listFactsForPrompt(
    options: ListProfileFactsOptions
  ): Promise<AgentProfileFactSummary[]> {
    const facts = await this.factModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        status: AgentProfileFactStatus.active,
      },
      order: {
        priority: 'DESC',
        updatedAt: 'DESC',
      },
      take: this.normalizeLimit(options.limit),
    });

    return facts
      .map(fact => this.buildSummary(fact))
      .filter((fact): fact is AgentProfileFactSummary => Boolean(fact));
  }

  async listVisualAppearanceMemories(
    options: ListProfileFactsOptions
  ): Promise<AgentProfileFactSummary[]> {
    const facts = await this.factModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        type: AgentProfileFactType.identity,
        key: { $regex: '^visual\\.appearance\\.' },
        status: {
          $in: [
            AgentProfileFactStatus.candidate,
            AgentProfileFactStatus.active,
          ],
        },
      } as never,
      order: {
        updatedAt: 'DESC',
      },
      take: this.normalizeLimit(options.limit ?? 16),
    });

    return facts
      .sort(
        (left, right) =>
          Number(right.status === AgentProfileFactStatus.active) -
          Number(left.status === AgentProfileFactStatus.active)
      )
      .map(fact => this.buildSummary(fact))
      .filter((fact): fact is AgentProfileFactSummary => Boolean(fact));
  }

  async upsertVisualAppearanceObservations(
    options: UpsertVisualAppearanceOptions
  ): Promise<AgentProfileFactSummary[]> {
    const facts: AgentProfileFactSummary[] = [];

    for (const observation of options.observations.slice(0, 4)) {
      const subject = this.resolveVisualAppearanceSubject(observation);

      if (!subject) {
        continue;
      }

      for (const trait of this.normalizeVisualAppearanceTraits(
        observation.traits
      )) {
        const fact: AgentProfileFactSummary = {
          type: AgentProfileFactType.identity,
          key: `${VISUAL_APPEARANCE_KEY_PREFIX}${subject.key}.${trait.kind}`,
          value: `${subject.label}的视觉形象：${trait.value}`,
          polarity: AgentProfileFactPolarity.positive,
          confidence: AgentProfileFactConfidence.extracted,
          priority: 1,
          assertionPolicy: AgentProfileFactAssertionPolicy.contextOnly,
        };

        await this.upsertFact({
          ...fact,
          userId: options.message.userId,
          agentId: options.message.agentId,
          sourceMessageId: options.message.id,
          sourceText: `图片人物${observation.personId}：${fact.value}`,
          trustedSource: false,
        });
        facts.push(fact);
      }
    }

    return facts;
  }

  async listSharedFamilyMemberNames(
    options: ListProfileFactsOptions
  ): Promise<string[]> {
    const facts = await this.factModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        type: AgentProfileFactType.family,
        status: AgentProfileFactStatus.active,
      },
      order: {
        priority: 'DESC',
        updatedAt: 'DESC',
      },
      take: this.normalizeLimit(options.limit),
    });

    return Array.from(
      new Set(
        facts
          .map(fact => getSharedFamilyMemberNameFromFactKey(fact.key))
          .filter((name): name is string => Boolean(name))
      )
    );
  }

  async recordUserCorrection(
    options: RecordAgentUserCorrectionOptions
  ): Promise<AgentProfileFactSummary> {
    const subjectRef = this.normalizeSourceText(options.subjectRef).slice(
      0,
      40
    );
    const rejectedFact = this.normalizeSourceText(options.rejectedFact).slice(
      0,
      160
    );
    const replacementFact = this.normalizeSourceText(
      options.replacementFact || ''
    ).slice(0, 160);
    const now = new Date();
    const fact: AgentProfileFactSummary = {
      type: AgentProfileFactType.correction,
      key: `correction.tool.${options.correctionKind}.${this.hashKey(
        `${subjectRef}|${rejectedFact}`
      )}`,
      value: replacementFact
        ? `用户纠正：${rejectedFact}不成立；替代事实：${replacementFact}`
        : `用户纠正：${rejectedFact}不成立；替代事实未知`,
      polarity: AgentProfileFactPolarity.negative,
      confidence: AgentProfileFactConfidence.userCorrected,
      priority: 3,
      status: AgentProfileFactStatus.active,
      assertionPolicy: AgentProfileFactAssertionPolicy.contextOnly,
      sourceMessageId: this.stringifyObjectId(options.message.id),
      sourceText: options.message.content?.trim().slice(0, 1000) || undefined,
      supportCount: 1,
      updatedAt: now,
    };

    await this.upsertFact({
      ...fact,
      userId: options.message.userId,
      agentId: options.message.agentId,
      sourceMessageId: options.message.id,
      trustedSource: true,
    });

    return fact;
  }

  async syncAgentProfileMemorySources(
    options: SyncAgentProfileMemorySourcesOptions
  ): Promise<void> {
    for (const field of Object.keys(
      options.sources
    ) as AgentProfileMemorySourceField[]) {
      const config = AGENT_PROFILE_MEMORY_SOURCE_CONFIG[field];
      const sourceText = this.normalizeSourceText(options.sources[field] || '');
      const existing = await this.factModel.findOne({
        where: {
          userId: options.userId,
          agentId: options.agentId,
          key: config.key,
        },
      });

      if (!sourceText) {
        if (existing && existing.status !== AgentProfileFactStatus.archived) {
          existing.status = AgentProfileFactStatus.archived;
          existing.updatedAt = new Date();
          await this.factModel.save(existing);
        }
        continue;
      }

      const value = `${config.valuePrefix}${sourceText}`;

      if (
        existing?.status === AgentProfileFactStatus.active &&
        existing.value?.trim() === value
      ) {
        continue;
      }

      await this.upsertFact({
        userId: options.userId,
        agentId: options.agentId,
        type: config.type,
        key: config.key,
        value,
        polarity: AgentProfileFactPolarity.positive,
        confidence: AgentProfileFactConfidence.confirmed,
        priority: config.priority,
        sourceMessageId: options.sourceMessageId,
        sourceText: this.normalizeSourceText(options.sourceText || sourceText),
        trustedSource: true,
      });
    }
  }

  async archiveMatchingFacts(
    options: ArchiveProfileFactsOptions
  ): Promise<number> {
    const target = extractForgetMemoryTarget(options.requestText);
    const archiveMostRecent = isDeicticForgetMemoryRequest(options.requestText);

    if (!target && !archiveMostRecent) {
      return 0;
    }

    const facts = await this.factModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        status: AgentProfileFactStatus.active,
      },
      order: {
        updatedAt: 'DESC',
      },
      take: DEFAULT_FACT_LIMIT,
    });
    const matched = archiveMostRecent
      ? this.selectMostRecentFactGroup(facts)
      : facts.filter(fact =>
          shouldArchiveMemoryValue(target, `${fact.key} ${fact.value}`)
        );
    const now = new Date();

    for (const fact of matched) {
      fact.status = AgentProfileFactStatus.archived;
      fact.updatedAt = now;
      await this.factModel.save(fact);
    }

    return matched.length;
  }

  private selectMostRecentFactGroup(
    facts: AgentProfileFactEntity[]
  ): AgentProfileFactEntity[] {
    const latest = facts[0];

    if (!latest) {
      return [];
    }

    const sourceMessageId = latest.sourceMessageId?.toString();

    if (!sourceMessageId) {
      return [latest];
    }

    return facts.filter(
      fact => fact.sourceMessageId?.toString() === sourceMessageId
    );
  }

  private async extractFacts(
    sourceText: string,
    options: {
      fromFeedback?: boolean;
      feedbackType?: string;
      previousAssistantContent?: string;
    } = {}
  ): Promise<ExtractedProfileFact[]> {
    const fallbackFacts = this.extractFactsWithRules(sourceText, options);

    // Mixed messages may end with a question while still containing a clear
    // name declaration in an earlier clause. Preserve only the strictly
    // validated name facts in that case; ordinary questions still write none.
    if (!options.fromFeedback && this.isQuestionOnly(sourceText)) {
      return fallbackFacts
        .filter(fact => isNameMemoryFactKey(fact.key))
        .map(fact => ({ fact, trustedSource: true }));
    }

    // 事实性信号预筛：无信号的短消息跳过 LLM，只走规则抽取
    const skipLLM =
      !options.fromFeedback &&
      !isExplicitRememberRequest(sourceText) &&
      !this.hasFactualSignal(sourceText);
    const llmFacts = skipLLM
      ? []
      : await this.extractFactsWithLLM(sourceText, options);
    const validatedLLMFacts = llmFacts.filter(fact =>
      isValidatedNameFactForSource(fact.key, fact.value, sourceText)
    );
    const ruleFactKeys = new Set(fallbackFacts.map(fact => fact.key));

    return this.dedupeFacts([...validatedLLMFacts, ...fallbackFacts]).map(
      fact => {
        const modelOnlyNameCandidate =
          isNameMemoryFactKey(fact.key) && !ruleFactKeys.has(fact.key);

        return {
          fact,
          trustedSource:
            !modelOnlyNameCandidate &&
            (options.fromFeedback === true ||
              ruleFactKeys.has(fact.key) ||
              this.isCorrectionText(sourceText)),
          forceCandidate: modelOnlyNameCandidate,
        };
      }
    );
  }

  private isQuestionOnly(sourceText: string): boolean {
    const text = this.normalizeCompactText(sourceText);

    return (
      /[?？]/.test(text) ||
      /^(?:那)?(?:你|您)?(?:为什么|为何|怎么|怎样|是不是|有没有|会不会|能不能|可不可以)/.test(
        text
      ) ||
      /(?:吗|么|呢|什么|谁|哪里|哪儿|几时|何时)$/.test(text)
    );
  }

  // 事实性信号预筛：只有消息包含至少一个事实性信号才进入 LLM 抽取。
  // 过滤掉纯情绪、纯问候、纯闲聊的消息，省掉 ~80% 的无效 LLM 调用。
  private hasFactualSignal(sourceText: string): boolean {
    const text = sourceText.trim();
    if (!text) return false;

    // 很短的消息几乎不可能含事实
    if (text.length <= 4) return false;

    // 纯情绪/问候模式（完整匹配）
    if (
      /^(?:晚安|早安|午安|睡了|去睡了|拜拜|再见|谢谢|多谢|好的|行|嗯+|哦+|哈哈+|嘿嘿+|爱你|想你了?|好想你|想你|吃了没|在吗|干嘛呢|忙什么呢|辛苦了|注意身体|早点休息)[，,。！？!?\s~～！]*$/.test(
        text
      )
    ) {
      return false;
    }

    // 事实性内容信号（满足任一即值得调 LLM）：
    // 1. 数字（年龄、日期、数量）
    if (/\d/.test(text)) return true;

    // 2. 时间标记（年、月、日、岁、号）
    if (/[年月日号岁]/.test(text)) return true;

    // 3. 身份/状态声明
    if (
      /(?:我是|我叫|我姓|我.{0,8}(?:名字|姓名|全名)|你.{0,8}(?:名字|姓名|全名)|你(?:现在|如今)?(?:叫|名叫)|我在.{0,6}(?:工作|上班|住|生活)|我有|我.{0,4}岁|我.{0,4}年|我的.{1,8}是|我家.{0,6}在)/.test(
        text
      )
    )
      return true;

    // 4. 纠正信号
    if (
      /(?:不对|不是这样|别(?:再)?编|你记错了|你忘了|.{0,4}不叫|我不是|我没有|我从来(?:也)?没)/.test(
        text
      )
    )
      return true;

    // 5. 生命事件（出生、离世、去世、走了）
    if (/(?:出生|离世|去世|走了.{0,4}年|不在了.{0,4}年|过世)/.test(text))
      return true;

    // 6. 地点变动
    if (
      /(?:搬到|去.{0,6}(?:工作|上班|打工|生活|定居)|在.{0,6}(?:工作|上班)|离开.{0,6}了|不在.{0,6}了|换到.{0,6}(?:工作|上班)|回.{0,4}家|搬家)/.test(
        text
      )
    )
      return true;

    // 7. 纪念物/遗物
    if (
      /(?:戒指|项链|手链|手表|照片|相片|遗物|纪念|留着|保存|珍藏|送.{0,4}的|留给.{0,4}的|戴着)/.test(
        text
      )
    )
      return true;

    // 8. 承诺/约定
    if (
      /(?:答应|承诺|说好|约好|以后.{0,6}(?:给|买|带|陪|照顾|结婚)|下辈子|婚礼|娶我|嫁给我|补给我)/.test(
        text
      )
    )
      return true;

    // 9. 记忆/共同过去
    if (
      /(?:小时候|以前|那时候|当年|那次|那年|曾经|还记得|我们一起|你带我|你教我|你陪我|你以前|你曾经)/.test(
        text
      )
    )
      return true;

    return false;
  }

  private async extractFactsWithLLM(
    sourceText: string,
    options: {
      fromFeedback?: boolean;
      feedbackType?: string;
      previousAssistantContent?: string;
    }
  ): Promise<AgentProfileFactSummary[]> {
    if (!this.openAIService?.isEnabled?.()) {
      return [];
    }

    try {
      const result = await this.openAIService.generateText({
        temperature: 0,
        topP: 0.1,
        reasoningSplit: false,
        maxTokens: 600,
        systemPrompt:
          '你是角色事实抽取器。只抽取用户明确纠正或补充的“当前智能体/逝去亲人角色”稳定事实，不抽取普通临时情绪，也不抽取轻生、自伤或危险风险标签。输出严格 JSON 数组，不要解释。字段：type、key、value、polarity、confidence、priority。type 只能是 identity/relationship/age/occupation/family/preference/correction/promise/keepsake/grief_trigger/style/memory/taboo；polarity 只能是 positive/negative；confidence 只能是 extracted/confirmed/user_corrected/feedback；priority 为 1-3。没有明确事实输出 []。禁止根据常识推断。姓名只能在用户作无疑问、无否定的明确陈述时提取：当前角色正式姓名用 identity.real_name，值为“当前角色正式姓名是姓名”；用户正式姓名用 user.identity.real_name，值为“用户正式姓名是姓名”。禁止输出 identity.name，禁止从提问、反问、否定、猜测或第三人信息中提取姓名。上一条助手回复的唯一用途是判断用户是否在否认其中的说法；用户没有在本轮消息中明确确认的内容，即使是助手说过的也不得提取为正向事实。指代式否认要记为 negative correction 或 memory。仅出现“大宝想你、某某哭了”等第三人称情绪，不足以确认其家庭关系，不得抽取；只有用户明确说某人是双方共同的家人、孩子、儿子或女儿时才抽取 family。关系不明确时只写共同家人，禁止猜测具体亲属关系。',
        prompt: [
          `来源：${options.fromFeedback ? '用户反馈' : '用户消息'}`,
          options.feedbackType ? `反馈类型：${options.feedbackType}` : '',
          options.previousAssistantContent?.trim()
            ? `上一条助手回复（仅作被否认对象）：${options.previousAssistantContent
                .trim()
                .slice(0, 300)}`
            : '',
          `文本：${sourceText}`,
        ]
          .filter(Boolean)
          .join('\n'),
      });

      return this.parseLLMFacts(result.content, sourceText);
    } catch (error) {
      this.logger?.warn?.(
        '[agent-profile-fact] llm extraction failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  private extractFactsWithRules(
    sourceText: string,
    options: {
      fromFeedback?: boolean;
      feedbackType?: string;
      previousAssistantContent?: string;
    }
  ): AgentProfileFactSummary[] {
    const text = this.normalizeCompactText(sourceText);
    const facts: AgentProfileFactSummary[] = [];
    const confidence = options.fromFeedback
      ? AgentProfileFactConfidence.feedback
      : this.isCorrectionText(text)
      ? AgentProfileFactConfidence.userCorrected
      : AgentProfileFactConfidence.extracted;

    this.addAgeFacts(facts, text, confidence);
    this.addIdentityFacts(facts, text, confidence);
    this.addOccupationFacts(facts, text, confidence);
    this.addFamilyFacts(facts, text, confidence);
    this.addStyleFacts(facts, text, confidence);
    this.addMemoryAndTabooFacts(facts, text, confidence);
    this.addRejectedAssistantClaimFact(
      facts,
      text,
      options.previousAssistantContent,
      confidence
    );

    if (options.feedbackType === 'unlike') {
      facts.push({
        type: AgentProfileFactType.style,
        key: 'style.feedback.unlike',
        value:
          '用户反馈当前角色回复不像本人；说话要更贴近角色资料，避免模板化和过度亲昵',
        polarity: AgentProfileFactPolarity.negative,
        confidence: AgentProfileFactConfidence.feedback,
        priority: 2,
      });
    }

    if (options.feedbackType === 'fabricated') {
      facts.push({
        type: AgentProfileFactType.taboo,
        key: 'taboo.feedback.no_fabrication',
        value:
          '用户反馈当前回复瞎编了；不确定的角色经历、共同记忆和细节必须说记不清，不能补',
        polarity: AgentProfileFactPolarity.negative,
        confidence: AgentProfileFactConfidence.feedback,
        priority: 3,
      });
    }

    return this.dedupeFacts(facts);
  }

  private addAgeFacts(
    facts: AgentProfileFactSummary[],
    text: string,
    confidence: AgentProfileFactConfidence
  ): void {
    const ageAtDeath = text.match(
      /(?:你|他|她|我爸|我妈|爸爸|妈妈)?(?:走的时候|离开的时候|去世的时候|过世的时候)(?:才|是)?(\d{1,3})岁/
    );
    const directAge = text.match(
      /(?:你|他|她|我爸|我妈|爸爸|妈妈)(?:不是\d{1,3}岁[,，。]*)?(?:是|才)?(\d{1,3})岁/
    );

    const age = ageAtDeath?.[1] || directAge?.[1];

    if (!age) {
      return;
    }

    facts.push({
      type: AgentProfileFactType.age,
      key: ageAtDeath ? 'age.age_at_death' : 'age.current_or_stated',
      value: ageAtDeath
        ? `当前角色离开时${age}岁`
        : `用户补充当前角色年龄为${age}岁`,
      polarity: AgentProfileFactPolarity.positive,
      confidence,
      priority: 3,
    });
  }

  private addIdentityFacts(
    facts: AgentProfileFactSummary[],
    text: string,
    confidence: AgentProfileFactConfidence
  ): void {
    const relationMatch = text.match(
      /(?:你|他|她)(?:是|就是)我(爸爸|妈妈|父亲|母亲|老公|老婆|丈夫|妻子|爷爷|奶奶|外公|外婆)/
    );

    if (relationMatch?.[1]) {
      facts.push({
        type: AgentProfileFactType.identity,
        key: 'identity.relationship',
        value: `当前角色是用户的${relationMatch[1]}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence,
        priority: 3,
      });
    }

    const nameMemory = extractAgentNameMemory(text);
    const nameConfidence =
      confidence === AgentProfileFactConfidence.extracted
        ? AgentProfileFactConfidence.confirmed
        : confidence;

    if (nameMemory.canonicalName) {
      facts.push({
        type: AgentProfileFactType.identity,
        key: AGENT_REAL_NAME_FACT_KEY,
        value: `当前角色正式姓名是${nameMemory.canonicalName}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence: nameConfidence,
        priority: 3,
      });
    }

    for (const alias of nameMemory.explicitAliases) {
      facts.push({
        type: AgentProfileFactType.identity,
        key: `${AGENT_EXPLICIT_ALIAS_FACT_PREFIX}${this.hashKey(alias)}`,
        value: `当前角色别名或昵称是${alias}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence: nameConfidence,
        priority: 2,
      });
    }

    if (nameMemory.preferredName) {
      facts.push({
        type: AgentProfileFactType.relationship,
        key: AGENT_PREFERRED_NAME_FACT_KEY,
        value: `当前用户偏好称呼当前角色为${nameMemory.preferredName}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence: nameConfidence,
        priority: 3,
      });
    }

    const userNameMemory = extractUserNameMemory(text);
    if (userNameMemory.canonicalName) {
      facts.push({
        type: AgentProfileFactType.identity,
        key: USER_REAL_NAME_FACT_KEY,
        value: `用户正式姓名是${userNameMemory.canonicalName}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence: nameConfidence,
        priority: 3,
      });
    }

    for (const alias of userNameMemory.explicitAliases) {
      facts.push({
        type: AgentProfileFactType.identity,
        key: `${USER_EXPLICIT_ALIAS_FACT_PREFIX}${this.hashKey(alias)}`,
        value: `用户别名或昵称是${alias}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence: nameConfidence,
        priority: 2,
      });
    }

    if (userNameMemory.preferredName) {
      facts.push({
        type: AgentProfileFactType.relationship,
        key: USER_PREFERRED_NAME_FACT_KEY,
        value: `当前用户希望当前角色称呼其为${userNameMemory.preferredName}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence: nameConfidence,
        priority: 3,
      });
    }
  }

  private addOccupationFacts(
    facts: AgentProfileFactSummary[],
    text: string,
    confidence: AgentProfileFactConfidence
  ): void {
    const match = text.match(
      /(?:你|他|她|我爸|我妈|爸爸|妈妈)(?:以前|生前|原来|一直)?(?:是|做过|干过|当过)([\u4e00-\u9fa5A-Za-z]{2,18})(?:工作|活|的)?/
    );

    if (!match?.[1]) {
      return;
    }

    const occupation = this.normalizeObjectText(match[1]);

    if (!occupation || /(这样|这么|那个|这个|不是|没有)/.test(occupation)) {
      return;
    }

    facts.push({
      type: AgentProfileFactType.occupation,
      key: 'occupation.primary',
      value: `当前角色以前的职业或工作是${occupation}`,
      polarity: AgentProfileFactPolarity.positive,
      confidence,
      priority: 3,
    });
  }

  private addFamilyFacts(
    facts: AgentProfileFactSummary[],
    text: string,
    confidence: AgentProfileFactConfidence
  ): void {
    const sharedMembers = extractSharedFamilyMemberDeclarations(text);

    for (const member of sharedMembers) {
      facts.push({
        type: AgentProfileFactType.family,
        key: buildSharedFamilyMemberFactKey(member.name),
        value:
          member.relationship === 'family'
            ? `${member.name}是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测`
            : `${member.name}是用户和当前角色的${member.relationshipLabel}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence:
          confidence === AgentProfileFactConfidence.extracted
            ? AgentProfileFactConfidence.confirmed
            : confidence,
        priority: 3,
      });
    }

    const childMatch = text.match(
      /(?:我们|咱们|我和你|我俩)(?:有|还有)(?:一个|个)?(儿子|女儿|孩子)(?:叫([\u4e00-\u9fa5A-Za-z·]{2,12}))?/
    );

    if (childMatch?.[1]) {
      facts.push({
        type: AgentProfileFactType.family,
        key: childMatch[2]
          ? buildSharedFamilyMemberFactKey(childMatch[2])
          : `family.${this.normalizeFamilyKey(childMatch[1])}`,
        value: childMatch[2]
          ? `用户和当前角色有${childMatch[1]}，名字叫${childMatch[2]}`
          : `用户和当前角色有${childMatch[1]}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence,
        priority: 3,
      });
    }
  }

  private addStyleFacts(
    facts: AgentProfileFactSummary[],
    text: string,
    confidence: AgentProfileFactConfidence
  ): void {
    if (/不爱说肉麻话|别说肉麻|不会这么肉麻/.test(text)) {
      facts.push({
        type: AgentProfileFactType.style,
        key: 'style.no_sweet_talk',
        value: '当前角色不爱说肉麻话，回复要朴素克制',
        polarity: AgentProfileFactPolarity.negative,
        confidence,
        priority: 3,
      });
    }

    if (/文绉绉|文艺腔|不像.*说话|不会这么说/.test(text)) {
      facts.push({
        type: AgentProfileFactType.style,
        key: 'style.no_literary',
        value: '当前角色说话不能文绉绉，避免文艺腔和模板化安慰',
        polarity: AgentProfileFactPolarity.negative,
        confidence,
        priority: 2,
      });
    }
  }

  private addMemoryAndTabooFacts(
    facts: AgentProfileFactSummary[],
    text: string,
    confidence: AgentProfileFactConfidence
  ): void {
    const neverWentMatch = text.match(
      /(?:我们|咱们|我和你|我俩)(?:没|没有|从来没|从没)去过([\u4e00-\u9fa5A-Za-z·]{2,16})/
    );

    if (neverWentMatch?.[1]) {
      facts.push({
        type: AgentProfileFactType.memory,
        key: `memory.never_went.${neverWentMatch[1]}`,
        value: `用户纠正：用户和当前角色没有去过${neverWentMatch[1]}`,
        polarity: AgentProfileFactPolarity.negative,
        confidence,
        priority: 3,
      });
    }

    const tabooMatch = text.match(
      /(?:以后|之后)?(?:别|不要|不许)(?:再)?(?:提|说)([^，。！？!?]{2,24})/
    );

    if (tabooMatch?.[1]) {
      const taboo = this.normalizeObjectText(tabooMatch[1]);

      if (taboo) {
        facts.push({
          type: AgentProfileFactType.taboo,
          key: `taboo.${this.hashKey(taboo)}`,
          value: `不要主动提${taboo}`,
          polarity: AgentProfileFactPolarity.negative,
          confidence,
          priority: 3,
        });
      }
    }
  }

  private addRejectedAssistantClaimFact(
    facts: AgentProfileFactSummary[],
    text: string,
    previousAssistantContent: string | undefined,
    confidence: AgentProfileFactConfidence
  ): void {
    const rejectedContent = this.normalizeSourceText(
      previousAssistantContent || ''
    ).slice(0, 160);

    if (
      !rejectedContent ||
      !/(?:没有这(?:回)?事|没这(?:回)?事|根本没这回事|不是这样的?|我不记得.{0,8}(?:有|发生|这事)|你(?:又|在)?(?:瞎编|胡编|乱编|乱说)|别(?:再)?编)/.test(
        text
      )
    ) {
      return;
    }

    facts.push({
      type: AgentProfileFactType.memory,
      key: `memory.rejected_assistant.${this.hashKey(rejectedContent)}`,
      value: `用户否认上一条助手所述共同往事：${rejectedContent}`,
      polarity: AgentProfileFactPolarity.negative,
      confidence,
      priority: 3,
    });
  }

  private async upsertFact(
    input: UpsertProfileFactInput
  ): Promise<AgentProfileFactEntity> {
    const now = new Date();
    const existing = await this.factModel.findOne({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        key: input.key,
      },
    });
    const fact = existing ?? new AgentProfileFactEntity();
    const previousValue = existing?.value?.trim();
    const sameValue = existing?.value?.trim() === input.value.trim();
    const sourceMessageIds = this.appendSourceMessageId(
      existing?.sourceMessageIds,
      existing?.sourceMessageId,
      input.sourceMessageId,
      input.sourceMessageIds
    );
    const nextSupportCount = sameValue
      ? Math.max(existing?.supportCount ?? 1, 1) + (existing ? 1 : 0)
      : 1;
    const isCanonicalName =
      input.key === AGENT_REAL_NAME_FACT_KEY ||
      input.key === USER_REAL_NAME_FACT_KEY;
    const canonicalNameReplacementIsAllowed =
      !isCanonicalName ||
      !existing ||
      sameValue ||
      isExplicitCanonicalNameReplacement(
        input.sourceText || '',
        input.key === USER_REAL_NAME_FACT_KEY ? 'user' : 'agent'
      );
    const shouldActivate =
      !input.forceCandidate &&
      canonicalNameReplacementIsAllowed &&
      (input.trustedSource || (sameValue && nextSupportCount >= 2));

    if (existing && !sameValue && !shouldActivate) {
      fact.sourceMessageIds = sourceMessageIds;
      fact.conflictingValues = this.appendConflictingValue(
        existing.conflictingValues,
        input.value
      );
      fact.status =
        existing.status === AgentProfileFactStatus.active
          ? AgentProfileFactStatus.active
          : AgentProfileFactStatus.conflicted;
      fact.updatedAt = now;
      await this.factModel.save(fact);
      return fact;
    }

    if (existing && !sameValue && isCanonicalName && shouldActivate) {
      await this.saveSupersededRealNameHistory(input, existing, now);
    }

    fact.userId = input.userId;
    fact.agentId = input.agentId;
    fact.type = input.type;
    fact.key = input.key;
    fact.value = input.value;
    fact.polarity = input.polarity;
    fact.confidence = input.confidence;
    fact.status = shouldActivate
      ? AgentProfileFactStatus.active
      : AgentProfileFactStatus.candidate;
    fact.priority = this.normalizePriority(input.priority);
    fact.sourceMessageId = input.sourceMessageId;
    fact.sourceMessageIds = sourceMessageIds;
    fact.sourceFeedbackId = input.sourceFeedbackId;
    fact.sourceText = input.sourceText?.trim().slice(0, 1000) || '';
    fact.supportCount = nextSupportCount;
    fact.assertionPolicy =
      input.assertionPolicy ??
      this.resolveAssertionPolicy(input.type, input.key);
    fact.conflictingValues =
      existing && !sameValue
        ? this.appendConflictingValue(existing.conflictingValues, previousValue)
        : existing?.conflictingValues || [];
    fact.createdAt = existing?.createdAt ?? now;
    fact.updatedAt = now;

    return this.factModel.save(fact);
  }

  private async saveSupersededRealNameHistory(
    input: UpsertProfileFactInput,
    existing: AgentProfileFactEntity,
    now: Date
  ): Promise<void> {
    const isUserName = input.key === USER_REAL_NAME_FACT_KEY;
    const valuePrefix = isUserName ? '用户正式姓名是' : '当前角色正式姓名是';
    const previousName = existing.value?.trim().startsWith(valuePrefix)
      ? existing.value.trim().slice(valuePrefix.length).trim()
      : '';

    if (!previousName) return;

    const history = new AgentProfileFactEntity();
    history.userId = input.userId;
    history.agentId = input.agentId;
    history.type = AgentProfileFactType.identity;
    history.key = `${
      isUserName
        ? USER_REAL_NAME_HISTORY_FACT_PREFIX
        : AGENT_REAL_NAME_HISTORY_FACT_PREFIX
    }${this.hashKey(`${previousName}|${now.toISOString()}`)}`;
    const nextName = input.value.trim().startsWith(valuePrefix)
      ? input.value.trim().slice(valuePrefix.length).trim()
      : input.value.trim();
    history.value = isUserName
      ? `用户历史正式姓名是${previousName}；当前姓名已变更为${nextName}`
      : `当前角色历史正式姓名是${previousName}；当前姓名已变更为${nextName}`;
    history.polarity = AgentProfileFactPolarity.positive;
    history.confidence = existing.confidence;
    history.status = AgentProfileFactStatus.active;
    history.priority = 1;
    history.sourceMessageId = existing.sourceMessageId;
    history.sourceMessageIds = existing.sourceMessageIds;
    history.sourceText = existing.sourceText;
    history.supportCount = existing.supportCount;
    history.assertionPolicy = AgentProfileFactAssertionPolicy.contextOnly;
    history.createdAt = existing.createdAt ?? now;
    history.updatedAt = now;
    await this.factModel.save(history);
  }

  private appendSourceMessageId(
    values: MongoObjectId[] | undefined,
    legacyValue?: MongoObjectId,
    nextValue?: MongoObjectId,
    nextValues: MongoObjectId[] = []
  ): MongoObjectId[] {
    const byId = new Map<string, MongoObjectId>();

    for (const value of [
      ...(values || []),
      legacyValue,
      nextValue,
      ...nextValues,
    ]) {
      const id = this.stringifyObjectId(value);

      if (id && value) {
        byId.set(id, value);
      }
    }

    return [...byId.values()].slice(-8);
  }

  private appendConflictingValue(
    values: string[] | undefined,
    value?: string
  ): string[] {
    const normalized = value?.trim();

    return Array.from(
      new Set(
        [...(values || []).map(item => item.trim()), normalized].filter(Boolean)
      )
    ).slice(-8) as string[];
  }

  private resolveAssertionPolicy(
    type: AgentProfileFactType,
    key = ''
  ): AgentProfileFactAssertionPolicy {
    return key.startsWith(VISUAL_APPEARANCE_KEY_PREFIX) ||
      type === AgentProfileFactType.style ||
      type === AgentProfileFactType.taboo ||
      type === AgentProfileFactType.safetySignal
      ? AgentProfileFactAssertionPolicy.contextOnly
      : AgentProfileFactAssertionPolicy.canAssert;
  }

  private resolveVisualAppearanceSubject(
    observation: AgentVisualAppearanceObservation
  ): { key: string; label: string } | null {
    if (
      observation.identityConfidence === 'low' ||
      observation.identityTarget === 'unknown'
    ) {
      return null;
    }

    if (observation.identityTarget === 'agent') {
      return { key: 'agent', label: '当前角色' };
    }

    if (observation.identityTarget === 'user') {
      return { key: 'user', label: '用户' };
    }

    const name = this.normalizeVisualAppearanceValue(
      observation.identityName || ''
    );

    if (!name) {
      return null;
    }

    return {
      key: `family_${this.hashKey(name)}`,
      label: `家人${name}`,
    };
  }

  private normalizeVisualAppearanceTraits(
    traits: AgentVisualAppearanceTrait[]
  ): AgentVisualAppearanceTrait[] {
    const byKind = new Map<
      AgentVisualAppearanceTraitKind,
      AgentVisualAppearanceTrait
    >();

    for (const trait of traits || []) {
      if (!VISUAL_APPEARANCE_TRAIT_KINDS.has(trait?.kind)) {
        continue;
      }

      const value = this.normalizeVisualAppearanceValue(trait.value);

      if (!value || /不清楚|未知|无法判断/.test(value)) {
        continue;
      }

      byKind.set(trait.kind, {
        kind: trait.kind,
        value,
      });
    }

    return [...byKind.values()].slice(0, 4);
  }

  private normalizeVisualAppearanceValue(value: string): string {
    return (value || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, '')
      .replace(/[，。！？!?；;：:]+$/g, '')
      .trim()
      .slice(0, 24);
  }

  private parseLLMFacts(
    value: string,
    sourceText = ''
  ): AgentProfileFactSummary[] {
    const jsonText = this.extractJsonArrayText(value);

    if (!jsonText) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonText);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map(item => this.normalizeLLMFact(item))
        .filter((fact): fact is AgentProfileFactSummary => Boolean(fact))
        .filter(
          fact => !this.shouldRejectBroadFamilyQuestionFact(fact, sourceText)
        );
    } catch {
      return [];
    }
  }

  private shouldRejectBroadFamilyQuestionFact(
    fact: AgentProfileFactSummary,
    sourceText: string
  ): boolean {
    if (fact.type !== AgentProfileFactType.family) {
      return false;
    }

    if (extractSharedFamilyMemberDeclarations(sourceText).length > 0) {
      return false;
    }

    return /[？?]|为什么|怎么|凭什么|是否|是不是|有没有|有吗|了吗|了没|会不会|能不能|该不该|要不要|在一起不/.test(
      sourceText
    );
  }

  private normalizeLLMFact(value: unknown): AgentProfileFactSummary | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const raw = value as Record<string, unknown>;
    const type = this.normalizeType(raw.type);
    const key = typeof raw.key === 'string' ? raw.key.trim() : '';
    const factValue = typeof raw.value === 'string' ? raw.value.trim() : '';

    if (!type || !key || !factValue) {
      return null;
    }

    return {
      type,
      key,
      value: factValue.slice(0, 500),
      polarity: this.normalizePolarity(raw.polarity),
      confidence: this.normalizeConfidence(raw.confidence),
      priority: this.normalizePriority(Number(raw.priority)),
    };
  }

  private buildSummary(
    fact: AgentProfileFactEntity
  ): AgentProfileFactSummary | null {
    const key = fact.key?.trim();
    const value = fact.value?.trim();

    if (!key || !value) {
      return null;
    }

    const summary: AgentProfileFactSummary = {
      type: fact.type,
      key,
      value,
      polarity: fact.polarity,
      confidence: fact.confidence,
      priority: this.normalizePriority(fact.priority),
      status: fact.status,
      assertionPolicy:
        fact.assertionPolicy ?? AgentProfileFactAssertionPolicy.canAssert,
      sourceText: fact.sourceText?.trim() || undefined,
      supportCount: Math.max(fact.supportCount ?? 1, 1),
      conflictingValues: (fact.conflictingValues || [])
        .map(value => value?.trim())
        .filter(Boolean),
      updatedAt: fact.updatedAt,
    };
    const id = this.stringifyObjectId(fact.id);
    const sourceMessageId = this.stringifyObjectId(
      fact.sourceMessageId || fact.sourceMessageIds?.[0]
    );

    if (id) {
      summary.id = id;
    }

    if (sourceMessageId) {
      summary.sourceMessageId = sourceMessageId;
    }

    return summary;
  }

  private buildFeedbackSourceText(
    options: ExtractProfileFactsFromFeedbackOptions
  ): string {
    return [
      options.feedbackType ? `反馈类型：${options.feedbackType}` : '',
      options.feedbackContent?.trim()
        ? `用户补充：${options.feedbackContent.trim()}`
        : '',
      options.assistantContent?.trim()
        ? `被反馈回复：${options.assistantContent.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  private extractJsonArrayText(value: string): string {
    const trimmed = value?.trim() || '';
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');

    if (start < 0 || end <= start) {
      return '';
    }

    return trimmed.slice(start, end + 1);
  }

  private dedupeFacts(
    facts: AgentProfileFactSummary[]
  ): AgentProfileFactSummary[] {
    const byKey = new Map<string, AgentProfileFactSummary>();

    for (const fact of facts) {
      byKey.set(fact.key, fact);
    }

    return [...byKey.values()];
  }

  private isCorrectionText(text: string): boolean {
    return /(不是|记错|说错|纠正|别瞎编|瞎编|胡编|乱造|从来没|从没|没有)/.test(
      text
    );
  }

  private normalizeSourceText(value: string): string {
    return (value || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  }

  private normalizeCompactText(value: string): string {
    return (value || '').replace(/\s+/g, '').trim();
  }

  private normalizeObjectText(value: string): string {
    return (value || '').replace(/[了啊呀呢吧嘛哈]+$/g, '').trim();
  }

  private normalizeFamilyKey(value: string): string {
    const map: Record<string, string> = {
      儿子: 'son',
      女儿: 'daughter',
      孩子: 'child',
    };

    return map[value] || value;
  }

  private normalizeType(value: unknown): AgentProfileFactType | null {
    return Object.values(AgentProfileFactType).includes(
      value as AgentProfileFactType
    )
      ? (value as AgentProfileFactType)
      : null;
  }

  private normalizePolarity(value: unknown): AgentProfileFactPolarity {
    return value === AgentProfileFactPolarity.negative
      ? AgentProfileFactPolarity.negative
      : AgentProfileFactPolarity.positive;
  }

  private normalizeConfidence(value: unknown): AgentProfileFactConfidence {
    return Object.values(AgentProfileFactConfidence).includes(
      value as AgentProfileFactConfidence
    )
      ? (value as AgentProfileFactConfidence)
      : AgentProfileFactConfidence.extracted;
  }

  private normalizePriority(value: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.min(3, Math.floor(value)))
      : 1;
  }

  private normalizeLimit(value?: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_FACT_LIMIT;
  }

  private hashKey(value: string): string {
    let hash = 0;

    for (const char of value) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    return hash.toString(36);
  }

  private stringifyObjectId(value?: MongoObjectId): string {
    return value?.toHexString?.() ?? (value ? String(value) : '');
  }
}
