import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum VoiceServiceSessionStatus {
  collecting = "collecting",
  analyzing = "analyzing",
  reviewing = "reviewing",
  training = "training",
  previewReady = "preview_ready",
  completed = "completed",
  failed = "failed",
}

export enum VoiceServiceProcessingMode {
  assisted = "assisted",
  readyToUse = "ready_to_use",
}

export enum VoiceServiceFailureStage {
  clipping = "clipping",
  training = "training",
}

export enum VoiceServiceDataDeletionStatus {
  pending = "pending",
  completed = "completed",
  partialFailed = "partial_failed",
}

export enum VoiceServiceClipReviewStatus {
  pending = "pending",
  accepted = "accepted",
  rejected = "rejected",
}

export type VoiceServiceClipRecutStatus =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export enum VoiceServiceMessageRole {
  user = "user",
  assistant = "assistant",
}

export enum VoiceServiceEventType {
  sessionCreated = "session_created",
  materialsAdded = "materials_added",
  materialRemoved = "material_removed",
  materialsSubmitted = "materials_submitted",
  returnedToMaterials = "returned_to_materials",
  returnedToReview = "returned_to_review",
  reviewClipsReady = "review_clips_ready",
  clipReviewed = "clip_reviewed",
  clipRecutRequested = "clip_recut_requested",
  clipRecutCompleted = "clip_recut_completed",
  clipRecutFailed = "clip_recut_failed",
  trainingStarted = "training_started",
  trainingCompleted = "training_completed",
  trainingFailed = "training_failed",
  agentSelected = "agent_selected",
  agentVoiceBound = "agent_voice_bound",
  voiceAccessRevoked = "voice_access_revoked",
  dataDeletionRequested = "data_deletion_requested",
  dataDeletionCompleted = "data_deletion_completed",
  dataDeletionPartialFailed = "data_deletion_partial_failed",
}

export type VoiceServiceBindingStatus =
  | "ready"
  | "purchase_required"
  | "bound"
  | "existing_voice_preserved";

export interface VoiceServiceMaterialItem {
  id: string;
  name: string;
  objectKey: string;
  publicUrl?: string;
  durationSeconds?: number;
  createdAt: Date;
}

export type VoiceServiceClipQualityIssueCode =
  | "too_short"
  | "mostly_silent"
  | "severe_clipping"
  | "volume_unrecoverable"
  | "background_noise_severe"
  | "silence_high"
  | "clipping_detected"
  | "volume_adjusted"
  | "background_noise_high";

export interface VoiceServiceClipQualityMetrics {
  durationSeconds: number;
  silenceRatio: number;
  rmsDb?: number;
  peakDb?: number;
  clippingRatio: number;
  noiseFloorDb?: number;
  signalToNoiseDb?: number;
  volumeAdjusted?: boolean;
  volumeGainDb?: number;
}

export interface VoiceServiceClipQualityIssue {
  code: VoiceServiceClipQualityIssueCode;
  severity: "warning" | "rejected";
  message: string;
}

export interface VoiceServiceReviewClipItem {
  id: string;
  sourceMaterialId?: string;
  sourceName?: string;
  objectKey: string;
  publicUrl?: string;
  durationSeconds?: number;
  transcript?: string;
  speakerId?: string;
  qualityScore?: number;
  qualityLabel?: string;
  qualityMetrics?: VoiceServiceClipQualityMetrics;
  qualityIssues?: VoiceServiceClipQualityIssue[];
  reviewStatus: VoiceServiceClipReviewStatus;
  rejectionReason?: string;
  recutStatus?: VoiceServiceClipRecutStatus;
  recutInstruction?: string;
  recutJobId?: string;
  recutRequestedAt?: Date;
  recutStartedAt?: Date;
  recutCompletedAt?: Date;
  recutFailureCode?: string;
  recutFailureReason?: string;
  recutHistory?: VoiceServiceClipRecutAttemptItem[];
  createdAt: Date;
  reviewedAt?: Date;
}

export interface VoiceServiceClipRecutAttemptItem {
  id: string;
  jobId: string;
  instruction: string;
  status: VoiceServiceClipRecutStatus;
  sourceObjectKeyHash: string;
  sourceDurationSeconds?: number;
  sourceTranscript?: string;
  previousReviewStatus: VoiceServiceClipReviewStatus;
  previousRejectionReason?: string;
  requestedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  queueDurationMs?: number;
  processingDurationMs?: number;
  resultObjectKeyHash?: string;
  resultDurationSeconds?: number;
  failureCode?: string;
  failureReason?: string;
}

export interface VoiceServiceFilteredClipItem {
  id: string;
  sourceMaterialId?: string;
  sourceName?: string;
  durationSeconds?: number;
  transcript?: string;
  speakerId?: string;
  qualityMetrics?: VoiceServiceClipQualityMetrics;
  qualityIssues: VoiceServiceClipQualityIssue[];
  createdAt: Date;
}

export interface VoiceServiceMessageItem {
  id: string;
  role: VoiceServiceMessageRole;
  text: string;
  createdAt: Date;
}

export interface VoiceServiceEventItem {
  id: string;
  type: VoiceServiceEventType;
  summary: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: Date;
}

export type VoiceServiceProcessingStage = "clipping" | "training";

export type VoiceServiceProcessingOutcome =
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface VoiceServicePlatformErrorItem {
  id: string;
  provider: string;
  operation: string;
  code: string;
  message: string;
  requestId?: string;
  httpStatus?: number;
  workerAttempt?: number;
  createdAt: Date;
}

export interface VoiceServiceProcessingAttemptItem {
  id: string;
  stage: VoiceServiceProcessingStage;
  jobId: string;
  processingMode?: VoiceServiceProcessingMode;
  queuedAt: Date;
  processingStartedAt?: Date;
  completedAt?: Date;
  queueDurationMs?: number;
  recognitionStartedAt?: Date;
  recognitionCompletedAt?: Date;
  recognitionDurationMs?: number;
  recognitionMaterialCount?: number;
  residualAnalysisObjectKeys?: string[];
  generatedClipCount?: number;
  filteredClipCount?: number;
  volumeAdjustedClipCount?: number;
  reviewedClipCount?: number;
  acceptedClipCount?: number;
  rejectedClipCount?: number;
  userAdoptionRate?: number;
  outcome: VoiceServiceProcessingOutcome;
  platformErrors?: VoiceServicePlatformErrorItem[];
}

export interface VoiceServiceDataDeletionFailureItem {
  id: string;
  artifactType: string;
  target: string;
  code: string;
  message: string;
  createdAt: Date;
}

export interface VoiceServiceDeletedArtifactAuditItem {
  id: string;
  artifactType: "original_material" | "review_clip";
  sourceRecordId: string;
  sourceMaterialId?: string;
  durationSeconds?: number;
  reviewStatus?: VoiceServiceClipReviewStatus;
  rejectionReason?: string;
  objectKeyHash: string;
  deletedAt: Date;
}

export interface VoiceServiceObservabilityMetrics {
  clippingQueueDurationMs?: number;
  recognitionDurationMs?: number;
  recognitionMaterialCount?: number;
  generatedClipCount?: number;
  filteredClipCount?: number;
  volumeAdjustedClipCount?: number;
  reviewedClipCount?: number;
  acceptedClipCount?: number;
  rejectedClipCount?: number;
  userAdoptionRate?: number;
  trainingQueueDurationMs?: number;
  trainingAttemptCount?: number;
  trainingSuccessCount?: number;
  trainingFailureCount?: number;
  trainingSuccessRate?: number;
  lastPlatformErrorCode?: string;
  lastPlatformErrorAt?: Date;
}

@Index(["userId", "updatedAt"], { background: true })
@Index(["userId", "status", "updatedAt"], { background: true })
@Index(["selectedAgentId", "updatedAt"], { sparse: true, background: true })
@Entity(TableName.voice_service_session)
export class VoiceServiceSessionEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  status: VoiceServiceSessionStatus;

  @Column()
  processingMode?: VoiceServiceProcessingMode;

  @Column()
  materials?: VoiceServiceMaterialItem[];

  @Column()
  reviewClips?: VoiceServiceReviewClipItem[];

  @Column()
  filteredClips?: VoiceServiceFilteredClipItem[];

  @Column()
  messages?: VoiceServiceMessageItem[];

  @Column()
  events?: VoiceServiceEventItem[];

  @Column()
  observability?: VoiceServiceObservabilityMetrics;

  @Column()
  processingAttempts?: VoiceServiceProcessingAttemptItem[];

  @Column()
  pendingDeletionObjectKeys?: string[];

  @Column()
  dataDeletionStatus?: VoiceServiceDataDeletionStatus;

  @Column()
  dataDeletionRequestedAt?: Date;

  @Column()
  dataDeletionCompletedAt?: Date;

  @Column()
  dataDeletionFailureReason?: string;

  @Column()
  dataDeletionFailures?: VoiceServiceDataDeletionFailureItem[];

  @Column()
  deletedArtifactAudit?: VoiceServiceDeletedArtifactAuditItem[];

  @Column()
  voiceTimbreId?: MongoObjectId;

  @Column()
  selectedAgentId?: MongoObjectId;

  @Column()
  previewAgentId?: MongoObjectId;

  @Column()
  previewText?: string;

  @Column()
  voiceAccessSource?: string;

  @Column()
  voiceAccessReferenceId?: string;

  @Column()
  voiceAccessVerifiedAt?: Date;

  @Column()
  voiceBindingStatus?: VoiceServiceBindingStatus;

  @Column()
  voiceBoundAgentIds?: MongoObjectId[];

  @Column()
  voiceBoundAt?: Date;

  @Column()
  voiceAccessRevokedAt?: Date;

  @Column()
  voiceAccessRevokedReason?: string;

  @Column()
  voiceAccessRevokedReferenceId?: string;

  @Column()
  previewAudioUrl?: string;

  @Column()
  previewAudioObjectKey?: string;

  @Column()
  failureReason?: string;

  @Column()
  failureStage?: VoiceServiceFailureStage;

  @Column()
  clippingJobId?: string;

  @Column()
  clippingStartedAt?: Date;

  @Column()
  clippingCompletedAt?: Date;

  @Column()
  trainingJobId?: string;

  @Column()
  trainingAudioObjectKey?: string;

  @Column()
  trainingStartedAt?: Date;

  @Column()
  trainingCompletedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
