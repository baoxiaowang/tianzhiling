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

  /** 原图对象 key（历史字段，新日志不再写入，改用哈希） */
  @Column()
  objectKey?: string;

  /** 对象 key 的 sha256 前 16 位（日志脱敏用） */
  @Column()
  objectKeyHash?: string;

  @Column()
  faces: FaceRecognitionFaceResult[];

  /** 动作：识别 / 登记 / 删除（操作审计用） */
  @Column()
  action?: string;

  /** 关联的人（登记/删除时） */
  @Column()
  personId?: MongoObjectId;

  /** 被清空的模板数量（删除时） */
  @Column()
  deletedCount?: number;

  @Column()
  model?: string;

  @Column()
  latencyMs?: number;

  @Column()
  createdAt: Date;
}
