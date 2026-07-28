import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum ConversationEmotionPrimary {
  stable = "stable",
  missing = "missing",
  sadness = "sadness",
  guilt = "guilt",
  angerBlame = "anger_blame",
  fear = "fear",
  expectingPresence = "expecting_presence",
  attachment = "attachment",
  crisisRisk = "crisis_risk",
}

export enum ConversationEmotionRiskLevel {
  none = "none",
  low = "low",
  medium = "medium",
  high = "high",
}

@Index(["conversationId", "userId", "agentId"], {
  unique: true,
  background: true,
})
@Index(["conversationId", "expiresAt"], { background: true })
@Entity(TableName.conversation_emotion_state)
export class ConversationEmotionStateEntity extends BaseEntity {
  @Column()
  conversationId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  primaryEmotion: ConversationEmotionPrimary;

  @Column()
  riskLevel: ConversationEmotionRiskLevel;

  @Column()
  signals: string[];

  @Column()
  sourceMessageId?: MongoObjectId;

  @Column()
  expiresAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
