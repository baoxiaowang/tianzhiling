import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  MessageEntity,
  MongoObjectId,
  UserSelfFactConfidence,
  UserSelfFactDomain,
  UserSelfFactEntity,
  UserSelfFactSource,
  UserSelfFactStatus,
} from '@tzl/entities';
import { OpenAIService } from './openai';
import { isSearchableDialogueEvidence, kinshipTermsIn } from './memory-value';

export interface RecordUserSelfFactOptions {
  userId: MongoObjectId;
  domain: UserSelfFactDomain;
  key: string;
  value: string;
  status?: UserSelfFactStatus;
  confidence?: UserSelfFactConfidence;
  sourceAgentId?: MongoObjectId;
  sourceMessageId?: MongoObjectId;
  sourceText?: string;
  effectiveAt?: Date;
  occurredAt?: Date;
  validUntil?: Date;
  resolvedAt?: Date;
}

interface ExtractedUserSelfFact {
  domain?: UserSelfFactDomain;
  key?: string;
  value?: string;
  status?: UserSelfFactStatus;
  occurredAt?: string;
}

interface UserSelfCaptureContext {
  contextMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * 是否值得为用户本人近况调一次模型：
 * - 必须是可搜索证据（空串/纯应答/纯称呼/纯思念/空泛安抚在索引层已排除）；
 * - 出现亲属称谓交给亲属入口，避免抢主体；
 * - 至少 5 个汉字，避免"我没事"这类空话；
 * - 需要是"用户自己在说处境"：本条出现第一人称，或最近一条用户消息是
 *   第一人称（承接式口语，如"（我工作压力大）养娃压力也大"）。
 * 这里只决定"要不要调模型"，事实是否成立仍由模型判断。
 */
export function shouldExtractUserSelf(
  text: string,
  contextMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  if (!isSearchableDialogueEvidence(value)) return false;
  if (kinshipTermsIn(value).length > 0) return false;
  const han = value.replace(/[^\p{Script=Han}]/gu, '');
  if (han.length < 5) return false;
  if (/(?:我|自己|咱)/u.test(value)) return true;
  const previousUser = [...(contextMessages || [])]
    .reverse()
    .find(item => item.role === 'user');
  return Boolean(
    previousUser && /(?:我|自己|咱)/u.test(previousUser.content || '')
  );
}

@Provide()
export class UserSelfMemoryService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @InjectEntityModel(UserSelfFactEntity)
  selfFactModel: MongoRepository<UserSelfFactEntity>;

  async extractFromUserMessage(
    message: MessageEntity,
    sourceText: string,
    context: UserSelfCaptureContext = {}
  ): Promise<number> {
    const text = sourceText?.trim();
    if (!text || !shouldExtractUserSelf(text, context.contextMessages))
      return 0;
    if (!this.openAIService?.isEnabled?.()) return 0;

    const extracted = await this.extract(text, message.createdAt, context);
    let written = 0;
    for (const item of extracted.slice(0, 5)) {
      if (!Object.values(UserSelfFactDomain).includes(item.domain as never)) {
        continue;
      }
      const key = item.key?.trim();
      const value = item.value?.trim();
      if (!key || !value) continue;
      await this.recordFact({
        userId: message.userId,
        domain: item.domain as UserSelfFactDomain,
        key,
        value,
        status: Object.values(UserSelfFactStatus).includes(item.status as never)
          ? item.status
          : UserSelfFactStatus.current,
        confidence: UserSelfFactConfidence.extracted,
        sourceAgentId: message.agentId,
        sourceMessageId: message.id,
        sourceText: text,
        // 来源时间=消息发生时间；事件时间另填 occurredAt（可确定时）。
        effectiveAt: message.createdAt,
        occurredAt: this.parseExactDate(item.occurredAt),
      });
      written += 1;
    }
    return written;
  }

  async recordFact(
    options: RecordUserSelfFactOptions
  ): Promise<UserSelfFactEntity | null> {
    const key = options.key.trim().slice(0, 120);
    const value = options.value.trim().slice(0, 500);
    if (!key || !value) return null;

    const now = new Date();
    const status = options.status || UserSelfFactStatus.current;
    if (
      status === UserSelfFactStatus.current ||
      status === UserSelfFactStatus.resolved
    ) {
      const current = await this.selfFactModel.findOne({
        where: {
          userId: options.userId,
          domain: options.domain,
          key,
          status: UserSelfFactStatus.current,
        },
      });
      if (status === UserSelfFactStatus.resolved && current) {
        current.value = value;
        current.status = UserSelfFactStatus.resolved;
        current.resolvedAt = options.resolvedAt || now;
        current.sourceAgentId = options.sourceAgentId || current.sourceAgentId;
        current.sourceMessageId =
          options.sourceMessageId || current.sourceMessageId;
        current.sourceText =
          this.cleanSource(options.sourceText) || current.sourceText;
        current.updatedAt = now;
        await this.selfFactModel.save(current);
        return current;
      }
      if (current?.value === value) {
        current.occurredAt = options.occurredAt || current.occurredAt;
        current.effectiveAt = options.effectiveAt || current.effectiveAt;
        current.sourceAgentId = options.sourceAgentId || current.sourceAgentId;
        current.sourceMessageId =
          options.sourceMessageId || current.sourceMessageId;
        current.sourceText =
          this.cleanSource(options.sourceText) || current.sourceText;
        current.supportCount = Math.max(1, current.supportCount || 1) + 1;
        current.sources = this.appendSource(current.sources, options, now);
        current.updatedAt = now;
        await this.selfFactModel.save(current);
        return current;
      }
      if (current) {
        current.status = UserSelfFactStatus.historical;
        current.updatedAt = now;
        await this.selfFactModel.save(current);
      }
    }

    const fact = new UserSelfFactEntity();
    Object.assign(fact, {
      userId: options.userId,
      domain: options.domain,
      key,
      value,
      status,
      confidence: options.confidence || UserSelfFactConfidence.extracted,
      supportCount: 1,
      sources: this.appendSource([], options, now),
      effectiveAt: options.effectiveAt,
      validUntil: options.validUntil,
      occurredAt: options.occurredAt,
      resolvedAt: options.resolvedAt,
      sourceAgentId: options.sourceAgentId,
      sourceMessageId: options.sourceMessageId,
      sourceText: this.cleanSource(options.sourceText),
      createdAt: now,
      updatedAt: now,
    });
    await this.selfFactModel.save(fact);
    return fact;
  }

  async listFacts(userId: MongoObjectId): Promise<UserSelfFactEntity[]> {
    if (!this.selfFactModel?.find) return [];
    return this.selfFactModel.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 64,
    });
  }

  private async extract(
    sourceText: string,
    referenceAt: Date | undefined,
    context: UserSelfCaptureContext
  ): Promise<ExtractedUserSelfFact[]> {
    try {
      const result = await this.openAIService.generateMemoryText({
        temperature: 0,
        topP: 0.1,
        reasoningSplit: false,
        maxTokens: 420,
        systemPrompt: [
          '你是用户本人近况抽取器，不生成聊天回复。只输出JSON。',
          '只抽取用户在本条消息中明确自述的“用户本人”近况：当前处境（工作、经济、养育、健康、居住、婚姻/家庭状态）、明确偏好或打算。',
          '不要抽取：关于AI亲人或其他人（妈妈、孩子、亲戚）的事实；纯情绪、纯思念、寒暄、疑问、猜测、诊断结论、自动待办。',
          '不得把“我很难受/我撑不住”升级为疾病诊断；保留为用户自述原意。',
          '愿望与计划写status=uncertain并保留原意，不能写成已发生；已了结写resolved，过去的事写historical。',
          '同一处境可用多个事实，每个事实用能区分命题的稳定短键（如work.pressure、marriage.intent_divorce、finance.income_pressure）。',
          'occurredAt只在原话给出可确定的完整日期(YYYY-MM-DD)时填写；不要把消息时间当作事件时间。',
          '没有明确自述输出{"facts":[]}。',
          '{"facts":[{"domain":"situation|work|finance|family|health|emotion|preference|plan|other","key":"稳定短键","value":"用户自述","status":"current|resolved|historical|uncertain","occurredAt":""}]}',
        ].join('\n'),
        prompt: [
          `参考时间（消息发生时间）：${referenceAt?.toISOString?.() || ''}`,
          context.contextMessages?.length
            ? `最近连续对话（只用于解析指代，不当作事实）：${JSON.stringify(
                context.contextMessages.slice(-8).map(item => ({
                  role: item.role,
                  content: item.content.slice(0, 200),
                }))
              )}`
            : '',
          `用户原话：${sourceText.slice(0, 1000)}`,
        ]
          .filter(Boolean)
          .join('\n'),
      });
      const raw = result.content?.trim() || '';
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return [];
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        facts?: unknown;
      };
      return Array.isArray(parsed.facts)
        ? (parsed.facts as ExtractedUserSelfFact[])
        : [];
    } catch (error) {
      this.logger?.warn?.(
        '[user-self] semantic extraction skipped, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  private appendSource(
    sources: UserSelfFactSource[] | undefined,
    options: RecordUserSelfFactOptions,
    now: Date
  ): UserSelfFactSource[] {
    const next = Array.isArray(sources) ? sources.slice() : [];
    if (options.sourceMessageId) {
      next.push({
        messageId: options.sourceMessageId,
        agentId: options.sourceAgentId,
        sourceText: this.cleanSource(options.sourceText),
        observedAt: now,
      });
    }
    return next.slice(-8);
  }

  private cleanSource(value?: string): string | undefined {
    const clean = value?.trim().slice(0, 500);
    return clean || undefined;
  }

  private parseExactDate(value?: string): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return undefined;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
      ? date
      : undefined;
  }
}
