import { Column, Entity, Index } from "typeorm";
import { BaseEntity, TableName } from "./base";

@Index(["month"], { unique: true, background: true })
@Entity(TableName.order_analytics_snapshot)
export class OrderAnalyticsSnapshotEntity extends BaseEntity {
  @Column()
  month: string;

  @Column()
  calculationVersion: number;

  @Column()
  payload: Record<string, unknown>;

  @Column()
  relationshipFacts: Array<{
    orderId: string;
    relationship: string;
    source: string;
  }>;

  @Column()
  generatedAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
