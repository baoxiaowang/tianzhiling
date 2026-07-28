import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  AgentProfileFactConfidence,
  AgentProfileFactEntity,
  AgentProfileFactPolarity,
  AgentProfileFactStatus,
  AgentProfileFactType,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { OpenAIService } from './openai';
import {
  buildSharedFamilyMemberFactKey,
  extractSharedFamilyMemberDeclarations,
  getSharedFamilyMemberNameFromFactKey,
} from './shared-family-member';

export interface AgentProfileFactSummary {
  type: AgentProfileFactType;
  key: string;
  value: string;
  polarity: AgentProfileFactPolarity;
  confidence: AgentProfileFactConfidence;
  priority: number;
}

interface ExtractProfileFactsOptions {
  message: MessageEntity;
  searchableText: string;
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

interface UpsertProfileFactInput extends AgentProfileFactSummary {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  sourceMessageId?: MongoObjectId;
  sourceFeedbackId?: MongoObjectId;
  sourceText?: string;
}

const DEFAULT_FACT_LIMIT = 32;

@Provide()
export class AgentProfileFactService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(AgentProfileFactEntity)
  factModel: MongoRepository<AgentProfileFactEntity>;

  @Inject()
  openAIService: OpenAIService;

  async extractAndUpsertFromUserMessage(
    options: ExtractProfileFactsOptions
  ): Promise<AgentProfileFactSummary[]> {
    const sourceText = this.normalizeSourceText(options.searchableText);

    if (!sourceText) {
      return [];
    }

    const facts = await this.extractFacts(sourceText);

    for (const fact of facts) {
      await this.upsertFact({
        ...fact,
        userId: options.message.userId,
        agentId: options.message.agentId,
        sourceMessageId: options.message.id,
        sourceText,
      });
    }

    return facts;
  }

  async extractAndUpsertFromFeedback(
    options: ExtractProfileFactsFromFeedbackOptions
  ): Promise<AgentProfileFactSummary[]> {
    const sourceText = this.buildFeedbackSourceText(options);

    if (!sourceText) {
      return [];
    }

    const facts = await this.extractFacts(sourceText, {
      fromFeedback: true,
      feedbackType: options.feedbackType,
    });

    for (const fact of facts) {
      await this.upsertFact({
        ...fact,
        userId: options.userId,
        agentId: options.agentId,
        sourceMessageId: options.messageId,
        sourceFeedbackId: options.feedbackId,
        sourceText,
      });
    }

    return facts;
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

  private async extractFacts(
    sourceText: string,
    options: { fromFeedback?: boolean; feedbackType?: string } = {}
  ): Promise<AgentProfileFactSummary[]> {
    if (!options.fromFeedback && this.isQuestionOnly(sourceText)) {
      return [];
    }

    const llmFacts = await this.extractFactsWithLLM(sourceText, options);
    const fallbackFacts = this.extractFactsWithRules(sourceText, options);

    return this.dedupeFacts([...llmFacts, ...fallbackFacts]);
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

  private async extractFactsWithLLM(
    sourceText: string,
    options: { fromFeedback?: boolean; feedbackType?: string }
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
          '你是角色事实抽取器。只抽取用户明确纠正或补充的“当前智能体/逝去亲人角色”稳定事实，不抽取普通临时情绪。输出严格 JSON 数组，不要解释。字段：type、key、value、polarity、confidence、priority。type 只能是 identity/relationship/age/occupation/family/preference/correction/promise/keepsake/grief_trigger/safety_signal/style/memory/taboo；polarity 只能是 positive/negative；confidence 只能是 extracted/confirmed/user_corrected/feedback；priority 为 1-3。没有明确事实输出 []。禁止根据常识推断。仅出现“大宝想你、某某哭了”等第三人称情绪，不足以确认其家庭关系，不得抽取；只有用户明确说某人是双方共同的家人、孩子、儿子或女儿时才抽取 family。关系不明确时只写共同家人，禁止猜测具体亲属关系。',
        prompt: [
          `来源：${options.fromFeedback ? '用户反馈' : '用户消息'}`,
          options.feedbackType ? `反馈类型：${options.feedbackType}` : '',
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
    options: { fromFeedback?: boolean; feedbackType?: string }
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

    const nameMatch = text.match(
      /(?:你|他|她)(?:叫|名字叫|全名叫)([\u4e00-\u9fa5A-Za-z·]{2,16})/
    );

    if (nameMatch?.[1]) {
      facts.push({
        type: AgentProfileFactType.identity,
        key: 'identity.name',
        value: `用户补充当前角色名字是${nameMatch[1]}`,
        polarity: AgentProfileFactPolarity.positive,
        confidence,
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

  private async upsertFact(input: UpsertProfileFactInput): Promise<void> {
    const now = new Date();
    const existing = await this.factModel.findOne({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        key: input.key,
      },
    });
    const fact = existing ?? new AgentProfileFactEntity();

    fact.userId = input.userId;
    fact.agentId = input.agentId;
    fact.type = input.type;
    fact.key = input.key;
    fact.value = input.value;
    fact.polarity = input.polarity;
    fact.confidence = input.confidence;
    fact.status = AgentProfileFactStatus.active;
    fact.priority = this.normalizePriority(input.priority);
    fact.sourceMessageId = input.sourceMessageId;
    fact.sourceFeedbackId = input.sourceFeedbackId;
    fact.sourceText = input.sourceText?.trim().slice(0, 1000) || '';
    fact.createdAt = existing?.createdAt ?? now;
    fact.updatedAt = now;

    await this.factModel.save(fact);
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

    return {
      type: fact.type,
      key,
      value,
      polarity: fact.polarity,
      confidence: fact.confidence,
      priority: this.normalizePriority(fact.priority),
    };
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
}
