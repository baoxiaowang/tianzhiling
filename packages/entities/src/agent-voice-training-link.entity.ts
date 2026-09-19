import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

/**
 * 声音训练 Agent 工作台唯一链接。
 *
 * 每个账号（userId）只有一条生效链接，token 即访问密钥：
 * 前端页面直接使用 token 鉴权（GET /p/:token），
 * API 调用需要 X-Agent-Vt-Secret + token 双因子。
 *
 * agentId 为该账号的目标「AI 亲人」：通过此链接训练完成的音色
 * 会直接绑定到这个智能体上。
 */
@Entity(TableName.agent_voice_training_link)
export class AgentVoiceTrainingLinkEntity extends BaseEntity {
  @Index({ unique: true, background: true })
  @Column()
  token: string;

  @Index({ background: true })
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  /** 目标亲人名称快照，用于页面展示与对话上下文。 */
  @Column()
  agentName?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;

  @Column()
  lastUsedAt?: Date;
}
