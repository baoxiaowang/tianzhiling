import { Column, Entity, Index } from "typeorm";
import { BaseEntity, TableName } from "./base";

/**
 * 管理后台每日统计预计算汇总表。
 * 由定时任务/回填脚本写入，getReport 优先读取，避免每次请求扫大表聚合。
 * date 为北京时间 YYYY-MM-DD，唯一索引保证幂等 upsert。
 */
@Entity({ name: TableName.admin_daily_stats })
@Index(["date"], { unique: true })
export class AdminDailyStatsEntity extends BaseEntity {
  /** 北京时间日期，格式 YYYY-MM-DD */
  @Column()
  date!: string;

  @Column()
  newUsers!: number;

  @Column()
  newAgents!: number;

  @Column()
  newUserChatUsers!: number;

  @Column()
  newUserMessages!: number;

  @Column()
  newUserFiveMessageUsers!: number;

  @Column()
  allChatUsers!: number;

  @Column()
  userMessages!: number;

  @Column()
  paidUsers!: number;

  @Column()
  paidOrders!: number;

  @Column()
  sameDayPayingUsers!: number;

  /** 已支付收入（元） */
  @Column()
  paidRevenue!: number;

  /** 退款金额（元） */
  @Column()
  refundedRevenue!: number;

  /** 净收入（元）= paidRevenue - refundedRevenue */
  @Column()
  netRevenue!: number;

  /** 按用户注册日 cohort 口径的当日收入（元） */
  @Column()
  cohortRevenue!: number;

  /** 本条记录计算完成时间 */
  @Column()
  computedAt!: Date;
}
