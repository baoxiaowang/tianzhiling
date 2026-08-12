import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum QuotaTriggerType {
  warned = "warned",
  blocked = "blocked",
  heavyUser = "heavyUser",
}

@Entity({ name: TableName.quota_trigger_event })
@Index(["userId", "agentId", "triggeredAt"], { background: true })
@Index(["triggerType", "triggeredAt"], { background: true })
export class QuotaTriggerEventEntity extends BaseEntity {
  @Column()
  userId!: MongoObjectId;

  @Column()
  agentId!: MongoObjectId;

  @Column()
  triggerType!: QuotaTriggerType;

  @Column()
  triggeredAt!: Date;

  @Column()
  dayMsgs!: number;

  @Column()
  lifetimeMsgs!: number;

  @Column()
  triggered!: boolean;

  @Column("simple-array", { nullable: true })
  matchedConditions?: string[];

  @Column({ nullable: true })
  warnCount?: number;

  @Column({ nullable: true })
  conversationId?: MongoObjectId;
}
