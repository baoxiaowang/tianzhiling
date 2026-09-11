import { Entity, Column, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum AgentSex {
  woman = 0,
  man = 1,
  unknown = 2,
}

export interface AgentPersonaLanguageProfile {
  sentenceLength?: string;
  modalParticles?: string;
  replyBubblePattern?: string;
  directness?: string;
  emotionalExpression?: string;
  addressStyle?: string;
  distinctiveRhythm?: string;
}

export interface AgentDepartedTransformation {
  released?: string[];
  strengthened?: string[];
  retainedEdges?: string[];
}

export interface AgentPersonaProfile {
  version?: string;
  demographics?: {
    relationshipType?: string;
    sex?: string;
    ageAtDeath?: number;
    ageBand?: string;
  };
  lifeTraits?: string[];
  coreValues?: string[];
  personalityContradictions?: string[];
  careStyle?: string;
  praiseStyle?: string;
  criticismStyle?: string;
  conflictStyle?: string;
  concealmentStyle?: string;
  questionStyle?: string;
  humorStyle?: string;
  languageProfile?: AgentPersonaLanguageProfile;
  departedTransformation?: AgentDepartedTransformation;
  highEqStrategies?: string[];
  evidenceSummary?: string[];
  uncertainties?: string[];
  confidence?: number;
}

export interface AgentMemoryProfileFactSnapshot {
  key: string;
  signature: string;
  priority: number;
}

@Index(["createdUserId", "updatedAt"], { background: true })
@Index(["createdUserId", "isDefault"], { background: true })
@Index(["messengerOfAgentId", "createdAt"], { background: true })
@Index(["voiceTimbreId"], { sparse: true, background: true })
@Index(["pendingVoiceTimbreId"], { sparse: true, background: true })
@Entity(TableName.agent)
export class AgentEntity extends BaseEntity {
  @Column()
  createdUserId: MongoObjectId;

  @Column()
  name: string;

  @Column()
  realName?: string;

  @Column()
  avatar: string;

  @Column()
  sex: AgentSex;

  @Column()
  agentCallMe?: string;

  @Column()
  iCallAgent?: string;

  @Column()
  birthday?: Date;

  @Column()
  deathDate?: Date;

  /**
   * 预计算的离世时长字符串，每轮聊天直接注入，不需要实时计算。
   * 由每日凌晨3点的批量预计算任务更新，修改 deathDate 时即时更新。
   * 示例："3个月" / "大约一周前" / "二十多年前"
   */
  @Column()
  departureDuration?: string;

  /**
   * 节点提醒，未来7天内有重要节点（头七/百日/周年）时填写，否则为 null。
   * 由每日预计算任务更新。
   * 示例："明天是头七" / "3天后是百日"
   */
  @Column()
  nodeReminder?: string;

  /**
   * 上次预计算时间，用于监控和健康检查。
   */
  @Column()
  departureDurationComputedAt?: Date;

  @Column({ type: "json", nullable: true })
  timeMarkers?: Array<{
    monthDay: string; // mm-dd format
    label: string;
    source: "deathDate" | "birthday" | "user_mentioned";
  }>;

  @Column()
  description: string;

  @Column()
  lifeExperience?: string;

  @Column()
  personalityTraits?: string;

  @Column()
  languageHabits?: string;

  @Column()
  hobbies?: string;

  @Column()
  sharedMemories?: string;

  @Column()
  profileCompletionGuideCreatedAt?: Date;

  @Column()
  agentHomeGuideSeenAt?: Date;

  @Column()
  agentProfileGuideSeenAt?: Date;

  /**
   * The memory versions covered by the latest low-frequency profile synthesis.
   * This is workflow metadata only; the long-term facts remain the source of
   * truth and generated profile paragraphs are never queried as memory.
   */
  @Column()
  memoryProfileFactSnapshot?: AgentMemoryProfileFactSnapshot[];

  @Column()
  memoryProfileVersion?: string;

  @Column()
  memoryProfileGeneratedAt?: Date;

  @Column()
  memoryProfileGenerationCount?: number;

  @Column()
  customContext?: string;

  /**
   * Optional chat-derived style profile. It guides expression only and never
   * overrides confirmed facts, capability boundaries, or released clients.
   */
  @Column()
  personaProfile?: AgentPersonaProfile;

  @Column()
  status: number;

  @Column()
  isDefault?: boolean;

  /**
   * When present, this agent is the internal "小使者" for the referenced AI 亲人.
   * Messenger agents are not user-managed relatives; they only collect and write
   * the parent agent's profile memory.
   */
  @Column()
  messengerOfAgentId?: MongoObjectId;

  @Column()
  voiceTimbreId?: MongoObjectId;

  @Column()
  pendingVoiceTimbreId?: MongoObjectId;

  /** Materialized count of user-authored messages for admin reporting. */
  @Column()
  userMessageCount?: number;

  @Column()
  userMessageCountBackfilledAt?: Date;

  @Column()
  voiceTimbreSelectedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
