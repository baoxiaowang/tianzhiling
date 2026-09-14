import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MessageEntity, MessageRole, MongoObjectId } from '@tzl/entities';
import OpenAI from 'openai';
import { MongoRepository } from 'typeorm';
import { isFactBearingUtterance } from '../agents/memory-value';
import { OpenAIService } from '../agents/openai';
import { MemoryEventEngine } from './memory-event.engine';
import {
  buildOpenItemExtractionPrompt,
  OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT,
  OpenItemExtractionMessage,
  parseOpenItemExtractionOutput,
  selectOpenItemExtractionWindow,
} from './memory-open-item-extraction';

const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MAX_MESSAGES = 60;

export interface OpenItemExtractionOutcome {
  status: 'ok' | 'empty' | 'skipped' | 'failed';
  reason?: string;
  consideredMessages: number;
  candidates: number;
  rejected: number;
  created: number;
  updated: number;
  skipped: number;
}

/**
 * 未了结条目的离线抽取任务（模型判定）。
 *
 * 线上实测：规则抽取在这类碎片化聊天里两头不讨好（收紧后召回几乎归零，留下的仍是回忆与情绪）。
 * 所以候选窗口只做"事实型原话 + 最近一段时间"的收窄，真正的判定交给模型；
 * 程序只保留校验职责：引用必须逐字来自原话、类别必须在允许集合内、每人最多 5 条活跃条目。
 */
@Provide()
export class MemoryOpenItemExtractorService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  eventEngine: MemoryEventEngine;

  @Inject()
  openAIService: OpenAIService;

  private dedicatedProvider?: { client: OpenAI; model: string } | null;

  /** 在线即时抽取的节流：同一用户 90 秒内只跑一次，避免一句话一次模型调用。 */
  private readonly lastInlineRunAt = new Map<string, number>();

  /**
   * 这个任务可以单独指定模型。
   * 没配专用 key 时，回落到项目已有的向量服务（DashScope 兼容接口）——实测默认的
   * 人物扮演对话模型做这种结构化判定不听话，而这个接口上的指令模型明显更准。
   */
  private resolveDedicatedProvider():
    | { client: OpenAI; model: string }
    | undefined {
    if (this.dedicatedProvider !== undefined) {
      return this.dedicatedProvider || undefined;
    }
    const apiKey = (
      process.env.NODE_MEMORY_OPEN_ITEM_API_KEY ||
      process.env.NODE_EMBEDDING_API_KEY ||
      ''
    ).trim();
    const baseURL = (
      process.env.NODE_MEMORY_OPEN_ITEM_BASE_URL ||
      process.env.NODE_EMBEDDING_BASE_URL ||
      ''
    ).trim();
    const model = (
      process.env.NODE_MEMORY_OPEN_ITEM_MODEL || 'qwen-plus'
    ).trim();
    this.dedicatedProvider =
      apiKey && baseURL && model
        ? { client: new OpenAI({ apiKey, baseURL }), model }
        : null;
    return this.dedicatedProvider || undefined;
  }

  /**
   * 在线即时抽取：用户说话时调用，让条目在下一次开口之前就存在。
   * 节流 90 秒；失败不影响任何流程。
   */
  async extractForUserInline(options: {
    userId: string;
    windowDays?: number;
    now?: Date;
  }): Promise<OpenItemExtractionOutcome | undefined> {
    const key = String(options.userId || '').toLowerCase();
    if (!key) return undefined;
    const now = (options.now || new Date()).getTime();
    const last = this.lastInlineRunAt.get(key) || 0;
    if (now - last < 90 * 1000) return undefined;
    this.lastInlineRunAt.set(key, now);
    return this.extractForUser(options);
  }

  async extractForUser(options: {
    userId: string;
    windowDays?: number;
    maxMessages?: number;
    now?: Date;
  }): Promise<OpenItemExtractionOutcome> {
    const empty: OpenItemExtractionOutcome = {
      status: 'empty',
      consideredMessages: 0,
      candidates: 0,
      rejected: 0,
      created: 0,
      updated: 0,
      skipped: 0,
    };
    const userId = toObjectId(options.userId);
    if (!userId) return { ...empty, status: 'failed', reason: 'invalid_user' };
    if (!this.openAIService?.isEnabled?.()) {
      return { ...empty, status: 'skipped', reason: 'model_disabled' };
    }

    const now = options.now || new Date();
    const windowDays = options.windowDays || DEFAULT_WINDOW_DAYS;
    const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const rows = await this.messageModel.find({
      where: {
        userId,
        role: MessageRole.user,
        isArchived: { $ne: true },
        createdAt: { $gte: since },
      } as never,
      order: { createdAt: 'DESC' } as never,
      take: options.maxMessages || DEFAULT_MAX_MESSAGES,
    });

    // 实测：消息少的用户只给"事实型"会把召回压掉 6 倍，所以小窗口给全部原话。
    const picked = selectOpenItemExtractionWindow(
      rows
        .slice()
        .sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
        ),
      {
        textOf: message => message.content || '',
        isFactBearing: text => isFactBearingUtterance(text),
      }
    );

    if (!picked.length) return empty;

    const messages: OpenItemExtractionMessage[] = picked.map(message => ({
      messageId: stringifyObjectId(message.id),
      content: (message.content || '').trim(),
      occurredAt: message.createdAt.toISOString(),
    }));

    let content = '';
    try {
      const prompt = buildOpenItemExtractionPrompt(messages);
      const dedicated = this.resolveDedicatedProvider();
      if (dedicated) {
        // 判定质量决定清单质量：允许给这个任务单独配一个"听话的指令模型"。
        const completion = await dedicated.client.chat.completions.create({
          model: dedicated.model,
          temperature: 0,
          top_p: 0.1,
          max_tokens: 1200,
          messages: [
            { role: 'system', content: OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: prompt },
          ],
        });
        content = completion.choices?.[0]?.message?.content || '';
      } else {
        const result = await this.openAIService.generateText({
          temperature: 0,
          topP: 0.1,
          reasoningSplit: false,
          maxTokens: 1200,
          systemPrompt: OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT,
          prompt,
        });
        content = result.content || '';
      }
    } catch (error) {
      this.logger?.warn?.(
        '[memory] open item extraction failed, userId=%s reason=%s',
        options.userId,
        error instanceof Error ? error.message : String(error)
      );
      return { ...empty, status: 'failed', reason: describeError(error) };
    }

    const parsed = parseOpenItemExtractionOutput(content, messages);
    if (!parsed.candidates.length) {
      return {
        ...empty,
        status: parsed.rejected.length ? 'failed' : 'ok',
        reason: parsed.rejected.length ? 'all_candidates_rejected' : undefined,
        consideredMessages: messages.length,
        rejected: parsed.rejected.length,
      };
    }

    const byMessageId = new Map(
      picked.map(message => [stringifyObjectId(message.id), message])
    );
    const groups = new Map<
      string,
      {
        conversationId: string;
        agentId: string;
        candidates: Array<
          (typeof parsed.candidates)[number] & { occurredAt: Date }
        >;
      }
    >();
    for (const candidate of parsed.candidates) {
      const message = byMessageId.get(candidate.messageId);
      if (!message) continue;
      const conversationId = stringifyObjectId(message.conversationId);
      const agentId = stringifyObjectId(message.agentId);
      const key = `${conversationId}|${agentId}`;
      if (!groups.has(key)) {
        groups.set(key, { conversationId, agentId, candidates: [] });
      }
      groups.get(key)!.candidates.push({
        ...candidate,
        occurredAt: message.createdAt,
      });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const group of groups.values()) {
      const written = await this.eventEngine.applyExtractedOpenItems({
        userId: options.userId,
        conversationId: group.conversationId,
        agentId: group.agentId,
        candidates: group.candidates,
        now,
      });
      created += written.created;
      updated += written.updated;
      skipped += written.skipped;
    }

    // 重要度高的先写：每人最多 5 条活跃条目，别让"纪念日"这类把真正的事挤掉。
    for (const group of groups.values()) {
      group.candidates.sort(
        (left, right) => right.importance - left.importance
      );
    }

    return {
      status: 'ok',
      consideredMessages: messages.length,
      candidates: parsed.candidates.length,
      rejected: parsed.rejected.length,
      created,
      updated,
      skipped,
    };
  }
}

function toObjectId(value?: string): MongoObjectId | undefined {
  const text = (value || '').trim();
  return text && MongoObjectId.isValid(text)
    ? new MongoObjectId(text)
    : undefined;
}

function stringifyObjectId(value?: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const candidate = value as {
    toHexString?: () => string;
    toString?: () => string;
  };
  if (typeof candidate.toHexString === 'function')
    return candidate.toHexString();
  return typeof candidate.toString === 'function' ? candidate.toString() : '';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
