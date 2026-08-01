import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum MessageRole {
  user = "user",
  assistant = "assistant",
  system = "system",
}

export enum MessageStatus {
  sent = "sent",
  failed = "failed",
}

export enum MessageType {
  text = "text",
  voice = "voice",
  image = "image",
}

export interface MessageReplyIntentItem {
  target: string;
  timeScope: string;
  intent: string;
  subIntent: string;
  confidence: number;
}

export interface MessageReplyMemoryPlanQuery {
  question: string;
  expectedUse: "mention" | "apply" | "suppress";
  importance: "required" | "supporting";
  entityHint: string;
}

export interface MessageReplyMemoryPlan {
  need: "none" | "retrieve" | "helpful" | "required";
  contextCoverage?: "complete" | "missing";
  missingConcepts?: string[];
  queries: MessageReplyMemoryPlanQuery[];
  selectedFactKeys?: string[];
}

@Index(["conversationId", "createdAt"], { background: true })
@Index(["userId", "createdAt"], { background: true })
@Index(["agentId", "userId", "createdAt"], { background: true })
@Index(["conversationId", "isArchived", "createdAt"], { background: true })
@Index(["conversationId", "replyGroupId", "replySegmentIndex"], {
  background: true,
})
@Index(["traceId", "createdAt"], { background: true })
@Entity(TableName.message)
export class MessageEntity extends BaseEntity {
  @Column()
  conversationId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  @Column()
  agentId: MongoObjectId;

  @Column()
  role: MessageRole;

  @Column()
  type: MessageType;

  @Column()
  content: string;

  @Column()
  status: MessageStatus;

  @Column()
  isArchived?: boolean;

  @Column()
  archivedAt?: Date;

  @Column()
  replyGroupId?: string;

  @Column()
  replySegmentIndex?: number;

  @Column()
  clientRequestId?: string;

  @Column()
  traceId?: string;

  @Column()
  quotedMessageId?: MongoObjectId;

  @Column()
  quotedMessageRole?: MessageRole;

  @Column()
  quotedMessageContent?: string;

  @Column()
  mediaObjectKey?: string;

  @Column()
  mediaUrl?: string;

  @Column()
  mediaMimeType?: string;

  @Column()
  mediaAnalysis?: string;

  @Column()
  mediaTranscript?: string;

  @Column()
  mediaDurationMs?: number;

  @Column()
  model?: string;

  @Column()
  promptTokens?: number;

  @Column()
  completionTokens?: number;

  @Column()
  totalTokens?: number;

  @Column()
  replyVisibleCharacters?: number;

  @Column()
  replyIntentTarget?: string;

  @Column()
  replyIntentTimeScope?: string;

  @Column()
  replyIntent?: string;

  @Column()
  replyIntentSubIntent?: string;

  @Column()
  replyIntentSecondary?: string[];

  @Column()
  replyIntents?: MessageReplyIntentItem[];

  @Column()
  replyIntentConfidence?: number;

  @Column()
  replyIntentSource?: string;

  @Column()
  replyPlanningMode?: string;

  @Column()
  replyPlanningReason?: string;

  @Column()
  replyIntentModelCallCount?: number;

  @Column()
  replyScene?: string;

  @Column()
  replySecondaryScenes?: string[];

  @Column()
  replyRoutingSource?: string;

  @Column()
  replyBriefVersion?: string;

  @Column()
  replyBriefMode?: string;

  @Column()
  replyBriefStrictGrounding?: boolean;

  @Column()
  replyBriefFactClaimMode?: string;

  @Column()
  replyBriefPreferredSegments?: number;

  @Column()
  replyBriefMaxSegments?: number;

  @Column()
  replyBriefComplexityHint?: string;

  @Column()
  replyBriefTurnClosure?: string;

  @Column()
  replyBriefLengthClass?: string;

  @Column()
  replyBriefTargetCharacters?: number;

  @Column()
  replyBriefReviewCharacters?: number;

  @Column()
  replyRelationshipSignals?: string[];

  @Column()
  replyFallbackSource?: string;

  @Column()
  replyGenerationFailureStage?: string;

  @Column()
  replyGenerationFailureCode?: string;

  @Column()
  replyGenerationRecoveryAttempted?: boolean;

  @Column()
  replyGenerationRecoverySucceeded?: boolean;

  @Column()
  replyBubbleReflowAttempted?: boolean;

  @Column()
  replyBubbleReflowSucceeded?: boolean;

  @Column()
  replyBubbleStructureIssues?: string[];

  @Column()
  replyGuardrailRewritten?: boolean;

  @Column()
  replyGuardrailReason?: string;

  @Column()
  replyGuardrailInterventionLevel?: string;

  @Column()
  replyGuardrailRevisionAttempted?: boolean;

  @Column()
  replyGuardrailRevisionRoundCount?: number;

  @Column()
  replyGuardrailFinalReviewResult?: string;

  @Column()
  replyGuardrailReviewMode?: string;

  @Column()
  replyGuardrailFocuses?: string[];

  @Column()
  replyEvidenceCount?: number;

  @Column()
  replyFactClaimCount?: number;

  @Column()
  replyUnsupportedClaimCount?: number;

  @Column()
  replyPromptVersion?: string;

  @Column()
  replySystemPromptCharacters?: number;

  @Column()
  replyHistoryMessageCount?: number;

  @Column()
  replyRelevantMemoryCount?: number;

  @Column()
  replyConversationReadingAnchorCount?: number;

  @Column()
  replyStrategyVersion?: string;

  @Column()
  replyStrategySource?: string;

  @Column()
  replyParticipationStrategy?: string;

  @Column()
  replyParticipationExecution?: string;

  @Column()
  replyParticipationFallbackReason?: string;

  @Column()
  replyConversationStance?: string;

  @Column()
  replyConversationStanceTarget?: string;

  @Column()
  replyConversationMoves?: string[];

  @Column()
  replyConversationMoveGoals?: string[];

  @Column()
  replySocialStrategy?: string;

  @Column()
  replyStrategyPurpose?: string;

  @Column()
  replyQuestionNeed?: string;

  @Column()
  replyConversationTurnClosure?: string;

  @Column()
  replyUserConversationState?: string;

  @Column()
  replyOpenLoop?: string;

  @Column()
  replyContinuationGoal?: string;

  @Column()
  replyAssistantContribution?: string;

  @Column()
  replyMustContribute?: string;

  @Column()
  replyAvoidRepeatingMove?: string;

  @Column()
  replyClosureReadiness?: string;

  @Column()
  replyPersonaActivations?: string[];

  @Column()
  replyPersonaSource?: string;

  @Column()
  replyRealityDependencyKinds?: string[];

  @Column()
  replyCorrectionFactMode?: string;

  @Column()
  replyActiveContributionSource?: string;

  @Column()
  replyStrategyRepeatedMoves?: string[];

  @Column()
  replyStrategyAlternative?: string;

  @Column()
  replyExperiencePlanVersion?: string;

  @Column()
  replyProfileTier?: string;

  @Column()
  replyProfileScore?: number;

  @Column()
  replyProfileDimensionCount?: number;

  @Column()
  replyProfileTrustedFactCount?: number;

  @Column()
  replyRelationshipStage?: string;

  @Column()
  replyRelationshipMaturity?: string;

  @Column()
  replyRelationshipState?: string;

  @Column()
  replyRelationshipUserTurnCount?: number;

  @Column()
  replyRelationshipActiveDayCount?: number;

  @Column()
  replyConversationDepth?: string;

  @Column()
  replyExperienceFactScope?: string;

  @Column()
  replyExperienceIntimacyLevel?: string;

  @Column()
  replyExperienceContributionMode?: string;

  @Column()
  replyExperienceMemoryPolicy?: string;

  @Column()
  replyExperienceQuestionPolicy?: string;

  @Column()
  replyExperienceClosurePolicy?: string;

  @Column()
  replyMemoryPlan?: MessageReplyMemoryPlan;

  @Column()
  replyMemoryCandidateCount?: number;

  @Column()
  replyMemorySelectedCandidateKeys?: string[];

  @Column()
  replyMemoryRetrievalMode?: string;

  @Column()
  replyMemoryRetrievalRequestCount?: number;

  @Column()
  replyMemoryRetrievalConceptCount?: number;

  @Column()
  replyMemoryRetrievedEvidenceCount?: number;

  @Column()
  replyMemoryUsedEvidenceIds?: string[];

  @Column()
  replyMemoryUsedClaimCount?: number;

  @Column()
  memoryWriteStatus?: string;

  @Column()
  memoryWriteLegacyFactCount?: number;

  @Column()
  memoryWriteProfileFactCount?: number;

  @Column()
  memoryWriteCompletedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
