import { Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ILogger } from '@midwayjs/logger';
import { MongoRepository } from 'typeorm';
import {
  ConversationEntityLedgerConfidence,
  ConversationEntityLedgerEntity,
  ConversationEntityLedgerStatus,
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';

import {
  extractConversationEntityDeclarations,
  renderConversationEntityPrompt,
  type ConversationEntityLedgerDeclaration,
  type ConversationEntityLedgerPromptEntry,
} from './conversation-entity-ledger.shared';

export {
  extractConversationEntityDeclarations,
  renderConversationEntityPrompt,
  type ConversationEntityLedgerDeclaration,
  type ConversationEntityLedgerPromptEntry,
} from './conversation-entity-ledger.shared';

@Provide()
export class ConversationEntityLedgerService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationEntityLedgerEntity)
  ledgerModel: MongoRepository<ConversationEntityLedgerEntity>;

  async ingestUserMessage(
    message: MessageEntity,
    sourceText?: string
  ): Promise<void> {
    if (!this.ledgerModel || message.role !== MessageRole.user) return;
    const text = (sourceText || message.content || '').trim();
    if (!text) return;

    const declarations = extractConversationEntityDeclarations(text);
    const entries = await this.loadEntries(message.conversationId);
    const now = new Date();

    for (const declaration of declarations) {
      await this.upsertDeclaration({
        message,
        declaration,
        text,
        now,
        existing: entries.find(
          entry => entry.normalizedName === normalizeName(declaration.name)
        ),
      });
    }

    // 用户只提名字、没有再说关系时，也刷新最后一次提及，不让它被历史窗口遗忘。
    const normalizedText = normalizeName(text);
    for (const entry of entries) {
      if (declarations.some(item => normalizeName(item.name) === entry.normalizedName)) {
        continue;
      }
      if (!normalizedText.includes(entry.normalizedName)) continue;
      entry.mentionCount = (entry.mentionCount || 0) + 1;
      entry.lastMentionedAt = now;
      entry.updatedAt = now;
      await this.ledgerModel.save(entry);
    }
  }

  async loadForPrompt(options: {
    conversationId: MongoObjectId;
  }): Promise<ConversationEntityLedgerPromptEntry[]> {
    if (!this.ledgerModel) return [];
    const entries = await this.ledgerModel.find({
      where: {
        conversationId: options.conversationId,
        status: {
          $in: [
            ConversationEntityLedgerStatus.active,
            ConversationEntityLedgerStatus.conflicted,
          ],
        },
      } as never,
      order: { lastMentionedAt: 'DESC' } as never,
      take: 8,
    });
    return entries.map(entry => ({
      id: String(entry.id),
      name: entry.name,
      relationToUser: entry.relationToUser,
      relationToAgent: entry.relationToAgent,
      status: entry.status,
      sourceMessageId: entry.sourceMessageId
        ? String(entry.sourceMessageId)
        : undefined,
      sourceText: entry.sourceText,
      lastMentionedAt: entry.lastMentionedAt,
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

  private async loadEntries(
    conversationId: MongoObjectId
  ): Promise<ConversationEntityLedgerEntity[]> {
    if (!this.ledgerModel) return [];
    return this.ledgerModel.find({
      where: {
        conversationId,
        status: {
          $ne: ConversationEntityLedgerStatus.archived,
        },
      } as never,
    });
  }

  private async upsertDeclaration(options: {
    message: MessageEntity;
    declaration: ConversationEntityLedgerDeclaration;
    text: string;
    now: Date;
    existing?: ConversationEntityLedgerEntity;
  }): Promise<void> {
    const { message, declaration, text, now } = options;
    const normalizedName = normalizeName(declaration.name);
    const existing = options.existing;
    const nextUserRelation = declaration.relationToUser?.trim();
    const nextAgentRelation = declaration.relationToAgent?.trim();

    if (!existing) {
      const entry = new ConversationEntityLedgerEntity();
      entry.conversationId = message.conversationId;
      entry.userId = message.userId;
      entry.agentId = message.agentId;
      entry.name = declaration.name;
      entry.normalizedName = normalizedName;
      entry.aliases = [];
      entry.relationToUser = nextUserRelation;
      entry.relationToAgent = nextAgentRelation;
      entry.status = ConversationEntityLedgerStatus.active;
      entry.confidence = ConversationEntityLedgerConfidence.explicit;
      entry.sourceMessageId = message.id;
      entry.sourceText = text.slice(0, 200);
      entry.mentionCount = 1;
      entry.lastMentionedAt = now;
      entry.createdAt = now;
      entry.updatedAt = now;
      try {
        await this.ledgerModel.save(entry);
      } catch (error) {
        // 并发下唯一索引可能被另一条消息抢先写入：回读后按更新处理。
        const raced = await this.ledgerModel.findOne({
          where: {
            conversationId: message.conversationId,
            normalizedName,
          } as never,
        });
        if (raced) {
          await this.mergeInto(raced, options);
        } else {
          this.logger?.warn?.(
            '[entity-ledger] upsert failed, conversationId=%s name=%s reason=%s',
            String(message.conversationId),
            declaration.name,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      return;
    }

    await this.mergeInto(existing, options);
  }

  private async mergeInto(
    entry: ConversationEntityLedgerEntity,
    options: {
      message: MessageEntity;
      declaration: ConversationEntityLedgerDeclaration;
      text: string;
      now: Date;
    }
  ): Promise<void> {
    const nextUserRelation = options.declaration.relationToUser?.trim();
    const nextAgentRelation = options.declaration.relationToAgent?.trim();
    const conflict =
      (nextUserRelation &&
        entry.relationToUser &&
        nextUserRelation !== entry.relationToUser) ||
      (nextAgentRelation &&
        entry.relationToAgent &&
        nextAgentRelation !== entry.relationToAgent);

    entry.name = options.declaration.name || entry.name;
    if (nextUserRelation) entry.relationToUser = nextUserRelation;
    if (nextAgentRelation) entry.relationToAgent = nextAgentRelation;
    entry.status = conflict
      ? ConversationEntityLedgerStatus.conflicted
      : ConversationEntityLedgerStatus.active;
    entry.confidence = ConversationEntityLedgerConfidence.explicit;
    // sourceMessageId 保留“关系声明”的原话，不被后来的 bare name 提及覆盖；
    // 这样人物消息固定时 pin 的是“豆丁，你的儿子”，而不是“豆丁呢”。
    if (nextUserRelation || nextAgentRelation) {
      entry.sourceMessageId = options.message.id;
      entry.sourceText = options.text.slice(0, 200);
    }
    entry.mentionCount = (entry.mentionCount || 0) + 1;
    entry.lastMentionedAt = options.now;
    entry.updatedAt = options.now;
    await this.ledgerModel.save(entry);
  }
}
