import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum ConversationEntityLedgerStatus {
  active = "active",
  conflicted = "conflicted",
  archived = "archived",
}

export enum ConversationEntityLedgerConfidence {
  explicit = "explicit",
  inferred = "inferred",
}

/**
 * 会话级人物账本：只记录用户在本会话中明确说过的人物与关系。
 *
 * 它是从消息派生出来的投影，不是长期事实的唯一来源；同步写入用于保证
 * 本轮/下一轮就能看到，不依赖摘要更新或最近历史窗口。
 */
@Index(["conversationId", "normalizedName"], {
  unique: true,
  background: true,
})
@Index(["conversationId", "status", "lastMentionedAt"], {
  background: true,
})
@Entity(TableName.conversation_entity_ledger)
export class ConversationEntityLedgerEntity extends BaseEntity {
  @Column()
  conversationId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  name: string;

  @Column()
  normalizedName: string;

  @Column()
  aliases?: string[];

  /** 用户明确说“我儿子/我女儿”时才写。 */
  @Column()
  relationToUser?: string;

  /** 用户明确说“你儿子/你女儿”时才写。 */
  @Column()
  relationToAgent?: string;

  @Column()
  status: ConversationEntityLedgerStatus;

  @Column()
  confidence: ConversationEntityLedgerConfidence;

  @Column()
  sourceMessageId?: MongoObjectId;

  @Column()
  sourceText?: string;

  @Column()
  mentionCount: number;

  @Column()
  lastMentionedAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
