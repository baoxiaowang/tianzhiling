import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import { MessageEntity, MessageRole, MongoObjectId } from '@tzl/entities';
import {
  extractConversationEntityDeclarations,
  isValidConversationEntityName,
  type ConversationEntityLedgerDeclaration,
  type ConversationEntityLedgerPromptEntry,
} from './conversation-entity-ledger.shared';

export {
  extractConversationEntityDeclarations,
  renderConversationEntityPrompt,
  type ConversationEntityLedgerDeclaration,
  type ConversationEntityLedgerPromptEntry,
} from './conversation-entity-ledger.shared';

const LEDGER_TTL_SECONDS = 30 * 24 * 60 * 60;
const LEDGER_STATUS_ACTIVE = 'active';
const LEDGER_STATUS_CONFLICTED = 'conflicted';

interface StoredLedgerEntry {
  name: string;
  normalizedName: string;
  aliases: string[];
  relationToUser?: string;
  relationToAgent?: string;
  status: string;
  confidence: 'explicit' | 'inferred';
  sourceMessageId?: string;
  sourceText?: string;
  mentionCount: number;
  lastMentionedAt: string;
  createdAt: string;
  updatedAt: string;
}

@Provide()
export class ConversationEntityLedgerService {
  @Logger()
  logger: ILogger;

  @Inject()
  redisService: RedisService;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  async ingestUserMessage(
    message: MessageEntity,
    sourceText?: string
  ): Promise<void> {
    if (!this.redisService || message.role !== MessageRole.user) return;
    const text = (sourceText || message.content || '').trim();
    if (!text) return;

    const declarations = extractConversationEntityDeclarations(text);
    const entries = await this.loadEntries(message.conversationId);
    const now = new Date();
    const nowIso = now.toISOString();

    for (const declaration of declarations) {
      const normalizedName = normalizeName(declaration.name);
      const existing = entries.find(
        entry => entry.normalizedName === normalizedName
      );
      await this.saveEntry(
        message.conversationId,
        mergeDeclaration(existing, declaration, message, text, nowIso)
      );
    }

    const normalizedText = normalizeName(text);
    for (const entry of entries) {
      if (
        declarations.some(
          item => normalizeName(item.name) === entry.normalizedName
        )
      ) {
        continue;
      }
      if (!normalizedText.includes(entry.normalizedName)) continue;
      await this.saveEntry(message.conversationId, {
        ...entry,
        mentionCount: entry.mentionCount + 1,
        lastMentionedAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }

  async loadForPrompt(options: {
    conversationId: MongoObjectId;
  }): Promise<ConversationEntityLedgerPromptEntry[]> {
    let entries = await this.loadEntries(options.conversationId);
    if (!entries.length) {
      await this.seedFromRecentMessages(options.conversationId);
      entries = await this.loadEntries(options.conversationId);
    }
    return entries
      .filter(entry => isValidConversationEntityName(entry.name))
      .filter(
        entry =>
          entry.status === LEDGER_STATUS_ACTIVE ||
          entry.status === LEDGER_STATUS_CONFLICTED
      )
      .sort(
        (left, right) =>
          Date.parse(right.lastMentionedAt) - Date.parse(left.lastMentionedAt)
      )
      .slice(0, 8)
      .map(entry => ({
        id: entry.normalizedName,
        name: entry.name,
        relationToUser: entry.relationToUser,
        relationToAgent: entry.relationToAgent,
        status: entry.status,
        sourceMessageId: entry.sourceMessageId,
        sourceText: entry.sourceText,
        lastMentionedAt: new Date(entry.lastMentionedAt),
      }));
  }

  async loadPinnedMessageIds(
    conversationId: MongoObjectId
  ): Promise<string[]> {
    const entries = await this.loadForPrompt({ conversationId });
    return entries
      .map(entry => entry.sourceMessageId)
      .filter((id): id is string => Boolean(id))
      .slice(0, 6);
  }

  /**
   * 账本是会话投影；Redis 冷启动或老会话没有账本时，从最近用户消息回填一次。
   * 只回填显式“名字 + 关系”，不把模型猜测写进来。
   */
  private async seedFromRecentMessages(
    conversationId: MongoObjectId
  ): Promise<void> {
    if (!this.messageModel || !this.redisService) return;
    const markerKey = `conversation:entity-ledger:seeded:${String(
      conversationId
    )}`;
    try {
      if (await this.redisService.get(markerKey)) return;
      const messages = await this.messageModel.find({
        where: {
          conversationId,
          role: MessageRole.user,
        },
        order: { createdAt: 'DESC' },
        take: 100,
      } as never);
      if (!messages.length) {
        await this.redisService.set(markerKey, '1', 'EX', LEDGER_TTL_SECONDS);
        return;
      }

      const entries: StoredLedgerEntry[] = [];
      let seeded = 0;
      for (const message of [...messages].reverse()) {
        const text = (message.content || message.mediaTranscript || '').trim();
        if (!text) continue;
        const declarations = extractConversationEntityDeclarations(text);
        if (!declarations.length) continue;
        const at = (
          message.createdAt instanceof Date
            ? message.createdAt
            : new Date(message.createdAt)
        ).toISOString();
        for (const declaration of declarations) {
          const normalizedName = normalizeName(declaration.name);
          const existing = entries.find(
            entry => entry.normalizedName === normalizedName
          );
          const merged = mergeDeclaration(
            existing,
            declaration,
            message,
            text,
            at
          );
          const index = entries.findIndex(
            entry => entry.normalizedName === normalizedName
          );
          if (index >= 0) entries[index] = merged;
          else entries.push(merged);
          seeded += 1;
        }
      }
      for (const entry of entries) {
        await this.saveEntry(conversationId, entry);
      }
      await this.redisService.set(markerKey, '1', 'EX', LEDGER_TTL_SECONDS);
      if (seeded > 0) {
        this.logger?.info?.(
          '[entity-ledger] seeded from messages, conversationId=%s entries=%s',
          String(conversationId),
          entries.length
        );
      }
    } catch (error) {
      this.logger?.warn?.(
        '[entity-ledger] seed failed, conversationId=%s reason=%s',
        String(conversationId),
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private ledgerKey(conversationId: MongoObjectId | string): string {
    return `conversation:entity-ledger:${String(conversationId)}`;
  }

  private async loadEntries(
    conversationId: MongoObjectId
  ): Promise<StoredLedgerEntry[]> {
    try {
      const raw = await this.redisService.hgetall(this.ledgerKey(conversationId));
      if (!raw) return [];
      const entries: StoredLedgerEntry[] = [];
      for (const value of Object.values(raw)) {
        try {
          const parsed = JSON.parse(value) as StoredLedgerEntry;
          if (parsed?.name && parsed?.normalizedName) entries.push(parsed);
        } catch {
          // ignore one malformed field, keep the rest of the ledger
        }
      }
      return entries;
    } catch (error) {
      this.logger?.warn?.(
        '[entity-ledger] load failed, conversationId=%s reason=%s',
        String(conversationId),
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  private async saveEntry(
    conversationId: MongoObjectId,
    entry: StoredLedgerEntry
  ): Promise<void> {
    try {
      const key = this.ledgerKey(conversationId);
      await this.redisService.hset(
        key,
        entry.normalizedName,
        JSON.stringify(entry)
      );
      await this.redisService.expire(key, LEDGER_TTL_SECONDS);
    } catch (error) {
      this.logger?.warn?.(
        '[entity-ledger] save failed, conversationId=%s name=%s reason=%s',
        String(conversationId),
        entry.name,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

function normalizeName(value: string): string {
  return value
    .replace(/[，,。！？!?；;：:、\s"'“”‘’]/g, '')
    .trim();
}

function mergeDeclaration(
  existing: StoredLedgerEntry | undefined,
  declaration: ConversationEntityLedgerDeclaration,
  message: MessageEntity,
  text: string,
  nowIso: string
): StoredLedgerEntry {
  const nextUserRelation = declaration.relationToUser?.trim();
  const nextAgentRelation = declaration.relationToAgent?.trim();
  if (!existing) {
    return {
      name: declaration.name,
      normalizedName: normalizeName(declaration.name),
      aliases: [],
      relationToUser: nextUserRelation,
      relationToAgent: nextAgentRelation,
      status: LEDGER_STATUS_ACTIVE,
      confidence: 'explicit',
      sourceMessageId: String(message.id),
      sourceText: text.slice(0, 200),
      mentionCount: 1,
      lastMentionedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  const conflict =
    (nextUserRelation &&
      existing.relationToUser &&
      nextUserRelation !== existing.relationToUser) ||
    (nextAgentRelation &&
      existing.relationToAgent &&
      nextAgentRelation !== existing.relationToAgent);
  return {
    ...existing,
    name: declaration.name || existing.name,
    ...(nextUserRelation ? { relationToUser: nextUserRelation } : {}),
    ...(nextAgentRelation ? { relationToAgent: nextAgentRelation } : {}),
    status: conflict ? LEDGER_STATUS_CONFLICTED : LEDGER_STATUS_ACTIVE,
    confidence: 'explicit',
    // sourceMessageId 保留关系声明原话，不被后来的 bare name 提及覆盖。
    ...(nextUserRelation || nextAgentRelation
      ? {
          sourceMessageId: String(message.id),
          sourceText: text.slice(0, 200),
        }
      : {}),
    mentionCount: existing.mentionCount + 1,
    lastMentionedAt: nowIso,
    updatedAt: nowIso,
  };
}
