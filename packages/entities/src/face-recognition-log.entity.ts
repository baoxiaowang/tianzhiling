import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum FaceRecognitionDecision {
  confirmed = 'confirmed',
  ask = 'ask',
  unknown = 'unknown',
}

export interface FaceRecognitionCandidate {
  personId?: string;
  name?: string;
  score: number;
}

export interface FaceRecognitionFaceResult {
  box?: { top: number; right: number; bottom: number; left: number };
  decision: FaceRecognitionDecision;
  top1?: FaceRecognitionCandidate;
  margin?: number;
  quality?: {
    faceSize?: number;
    blur?: number;
    brightness?: number;
    yaw?: number;
  };
  /** 被质量门禁拦下的原因（size/blur/pose） */
  gatedBy?: string;
}

/**
 * 一次图片识别记录：用于评测、阈值调整和误认追溯。
 * 只存人 id / 分数，不存原图 URL 之外的可定位信息。
 */
@Index(['userId', 'createdAt'], { background: true })
@Entity(TableName.face_recognition_log)
export class FaceRecognitionLogEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  agentId?: MongoObjectId;

  @Column()
  messageId?: MongoObjectId;

  @Column()
  objectKey?: string;

  @Column()
  faces: FaceRecognitionFaceResult[];

  @Column()
  model?: string;

  @Column()
  latencyMs?: number;

  @Column()
  createdAt: Date;
}
