import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export type VoiceTimbreMaterialReviewStatus = "pending" | "accepted" | "unused";

export interface VoiceTimbreMaterialReviewClip {
  sourceMaterialId: string;
  sourceName: string;
  objectKey: string;
  publicUrl: string;
  durationSeconds: number;
  transcript?: string;
  qualityScore?: number;
  qualityLabel?: string;
  qualityIssues?: Array<{
    code: string;
    severity: "warning" | "rejected";
    message?: string;
  }>;
  reviewStatus: VoiceTimbreMaterialReviewStatus;
  reviewedAt?: Date;
}

@Index(["userId", "objectKey"], { unique: true, background: true })
@Index(["userId", "createdAt"], { background: true })
@Entity(TableName.voice_timbre_material)
export class VoiceTimbreMaterialEntity extends BaseEntity {
  @Column()
  userId?: MongoObjectId;

  @Column()
  name: string;

  @Column()
  objectKey: string;

  @Column()
  publicUrl?: string;

  @Column()
  sizeBytes?: number;

  @Column()
  reviewClips?: VoiceTimbreMaterialReviewClip[];

  @Column()
  clippedAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
