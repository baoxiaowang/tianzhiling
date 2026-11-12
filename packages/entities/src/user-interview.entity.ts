import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export type UserInterviewStatus = "draft" | "structured";

/** 访谈表单单题回答。 */
export interface UserInterviewAnswer {
  /** 大纲题号（1 起，对应 用户访谈提问大纲） */
  no: number;
  question: string;
  answer: string;
  /** 逐字稿中的原话摘录，便于核对 */
  quotes?: string[];
}

/**
 * 付费用户电话访谈记录。
 *
 * 运营上传访谈逐字稿，后台按《用户访谈提问大纲》调用 LLM 整理成结构化表单，
 * 人工可再编辑。一条记录对应一次访谈。
 */
@Entity(TableName.user_interview)
export class UserInterviewEntity extends BaseEntity {
  @Index({ background: true })
  @Column()
  userId: MongoObjectId;

  @Column()
  title: string;

  @Column()
  interviewDate: string;

  /** 原始逐字稿（纯文本，docx 已在前端/接口侧转为文本） */
  @Column()
  transcript: string;

  @Column()
  transcriptFileName?: string;

  @Column()
  answers: UserInterviewAnswer[];

  @Column()
  status: UserInterviewStatus;

  @Column()
  model?: string;

  @Column()
  structuredAt?: Date;

  @Column()
  lastError?: string;

  @Column()
  operatorId?: string;

  @Column()
  operatorName?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
