import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

export enum UserKnownPersonFaceStatus {
  active = 'active',
  deleted = 'deleted',
}

export enum UserKnownPersonFaceSource {
  /** 运营在后台手动上传 */
  admin = 'admin',
  /** 用户在聊天里确认“这是我妈妈”后回写 */
  userConfirmed = 'user_confirmed',
  /** 从用户头像/素材自动提取 */
  auto = 'auto',
}

/** 人脸模板质量分（sidecar 计算）。 */
export interface UserKnownPersonFaceQuality {
  faceSize?: number;
  blur?: number;
  brightness?: number;
  yaw?: number;
  score?: number;
}

/**
 * 某个「认识的人」（user_known_person）的人脸模板。
 * 一个人可有多张（多角度 / 多年代），识别时取最大相似度。
 */
@Index(['personId', 'status'], { background: true })
@Index(['userId', 'status'], { background: true })
@Entity(TableName.user_known_person_face)
export class UserKnownPersonFaceEntity extends BaseEntity {
  @Column()
  personId: MongoObjectId;

  @Column()
  userId: MongoObjectId;

  /**
   * 128 维特征向量（dlib / face_recognition）。
   * 配置了 NODE_FACE_EMBEDDING_KEY 时改为加密存储，此字段为空。
   */
  @Column()
  embedding?: number[];

  /** 加密后的特征向量（AES-256-GCM，格式 v1:iv:tag:cipher） */
  @Column()
  embeddingEnc?: string;

  @Column()
  dim: number;

  @Column()
  model: string;

  @Column()
  modelVersion: string;

  @Column()
  quality?: UserKnownPersonFaceQuality;

  /** 原图对象存储 key（按删除策略清理；识别不需要它） */
  @Column()
  objectKey?: string;

  @Column()
  source: UserKnownPersonFaceSource;

  @Column()
  status: UserKnownPersonFaceStatus;

  /** 用户单独同意的记录（人脸属于敏感个人信息） */
  @Column()
  consentAt?: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
