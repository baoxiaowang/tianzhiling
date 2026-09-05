import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum VoiceTimbreProvider {
  minimax = "minimax",
  cosyvoice = "cosyvoice",
  qwen = "qwen",
  doubao = "doubao",
}

export enum VoiceTimbreStatus {
  creating = "creating",
  active = "active",
  failed = "failed",
  disabled = "disabled",
}

export interface VoiceTimbreGeneratedAudioItem {
  id: string;
  text: string;
  objectKey: string;
  publicUrl?: string;
  speechSpeed: number;
  speechVolume: number;
  createdAt: Date;
}

@Index(["provider", "providerVoiceId"], { unique: true, background: true })
@Index(["status", "updatedAt"], { background: true })
@Index(["userId", "status", "createdAt"], {
  sparse: true,
  background: true,
})
@Index(["voiceServiceSessionId", "updatedAt"], {
  sparse: true,
  background: true,
})
@Entity(TableName.voice_timbre)
export class VoiceTimbreEntity extends BaseEntity {
  @Column()
  userId?: MongoObjectId;

  @Column()
  name: string;

  @Column()
  provider: VoiceTimbreProvider;

  @Column()
  providerVoiceId: string;

  @Column()
  retainedProviderVoiceId?: string;

  @Column()
  providerFileId?: string;

  @Column()
  voiceServiceSessionId?: MongoObjectId;

  @Column()
  trainingClipIds?: string[];

  @Column()
  audioObjectKey: string;

  @Column()
  audioUrl?: string;

  @Column()
  cloneLanguage: string;

  @Column()
  speechDialect?: string;

  @Column()
  speechInstruction?: string;

  @Column()
  voiceDescription?: string;

  @Column()
  previewText?: string;

  @Column()
  previewModel?: string;

  @Column()
  previewAudioUrl?: string;

  @Column()
  previewAudioObjectKey?: string;

  @Column()
  speechSpeed?: number;

  @Column()
  speechVolume?: number;

  @Column()
  speechPitch?: number;

  @Column()
  generatedAudios?: VoiceTimbreGeneratedAudioItem[];

  @Column()
  status: VoiceTimbreStatus;

  @Column()
  errorCode?: string;

  @Column()
  errorMessage?: string;

  @Column()
  remark?: string;

  @Column()
  providerCreatedAt?: Date;

  @Column()
  providerLastUsedAt?: Date;

  @Column()
  providerEstimatedCleanupAt?: Date;

  @Column()
  retentionStatus?: "protected" | "due_soon" | "attention_required";

  @Column()
  retentionLastAttemptAt?: Date;

  @Column()
  retentionLastSucceededAt?: Date;

  @Column()
  retentionFailureCode?: string;

  @Column()
  retentionFailureReason?: string;

  @Column()
  deletionStatus?: "pending" | "completed" | "partial_failed";

  @Column()
  deletionRequestedAt?: Date;

  @Column()
  providerDeletedAt?: Date;

  @Column()
  deletedAt?: Date;

  @Column()
  deletionFailureReason?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
