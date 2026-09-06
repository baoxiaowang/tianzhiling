import { Column, Entity, Index } from "typeorm";
import { BaseEntity, TableName } from "./base";

@Index(["month"], { unique: true, background: true })
@Entity(TableName.order_monthly_report_snapshot)
export class OrderMonthlyReportSnapshotEntity extends BaseEntity {
  @Column()
  month: string;

  @Column()
  calculationVersion: number;

  @Column()
  payload: Record<string, unknown>;

  @Column()
  generatedAt: Date;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
