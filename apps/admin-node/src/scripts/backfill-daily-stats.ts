import { resolve } from 'path';
import { DataSource } from 'typeorm';
import {
  AdminDailyStatsEntity,
  AgentEntity,
  MessageEntity,
  OrderEntity,
  OrderRefundEntity,
  UserEntity,
} from '@tzl/entities';
import {
  loadEnvFileIfExists,
  readStringFrom,
} from '@tzl/shared';
import { AdminOperationsService } from '../service/admin-operations.service';
import { AdminDailyStatsService } from '../service/admin-daily-stats.service';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

/**
 * 历史每日统计回填脚本。
 * 遍历指定日期范围，逐日计算并写入 admin_daily_stats 汇总表。
 * 幂等：已存在的日期会被覆盖更新（upsert）。
 *
 * 环境变量：
 *   BACKFILL_START_DATE  起始日期 YYYY-MM-DD，默认 2025-01-01
 *   BACKFILL_END_DATE    结束日期 YYYY-MM-DD，默认昨天
 *
 * 用法：node ./dist/scripts/backfill-daily-stats.js
 */
async function main(): Promise<void> {
  const yesterday = getYesterdayBeijing();
  const startDate = readStringFrom(['BACKFILL_START_DATE'], '2025-01-01');
  const endDate = readStringFrom(['BACKFILL_END_DATE'], yesterday);

  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    throw new Error(`日期格式无效：start=${startDate} end=${endDate}`);
  }
  if (startDate > endDate) {
    throw new Error(`起始日期不能晚于结束日期：${startDate} > ${endDate}`);
  }

  const dataSource = new DataSource({
    type: 'mongodb',
    database: readStringFrom(
      ['ADMIN_API_MONGO_DB', 'NODE_MONGO_DB', 'MONGO_DB'],
      'tzl'
    ),
    host: readStringFrom(
      ['ADMIN_API_MONGO_HOST', 'NODE_MONGO_HOST', 'MONGO_HOST'],
      '127.0.0.1'
    ),
    port: Number(
      readStringFrom(['ADMIN_API_MONGO_PORT', 'NODE_MONGO_PORT', 'MONGO_PORT'], '17271')
    ),
    authSource: readStringFrom(
      [
        'ADMIN_API_MONGO_AUTH_SOURCE',
        'NODE_MONGO_AUTH_SOURCE',
        'MONGO_AUTH_SOURCE',
      ],
      'admin'
    ),
    username: readStringFrom(
      ['ADMIN_API_MONGO_USERNAME', 'NODE_MONGO_USERNAME', 'MONGO_USERNAME'],
      'admin'
    ),
    password: readStringFrom(
      ['ADMIN_API_MONGO_PASSWORD', 'NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'],
      'qwerasdf'
    ),
    synchronize: true,
    logging: false,
    entities: [
      UserEntity,
      AgentEntity,
      MessageEntity,
      OrderEntity,
      OrderRefundEntity,
      AdminDailyStatsEntity,
    ],
  } as never);

  await dataSource.initialize();

  // 手动实例化 service（不启动 Midway 应用）
  const adminOps = new AdminOperationsService();
  (adminOps as unknown as { userModel: unknown }).userModel =
    dataSource.getMongoRepository(UserEntity);
  (adminOps as unknown as { agentModel: unknown }).agentModel =
    dataSource.getMongoRepository(AgentEntity);
  (adminOps as unknown as { messageModel: unknown }).messageModel =
    dataSource.getMongoRepository(MessageEntity);
  (adminOps as unknown as { orderModel: unknown }).orderModel =
    dataSource.getMongoRepository(OrderEntity);
  (adminOps as unknown as { orderRefundModel: unknown }).orderRefundModel =
    dataSource.getMongoRepository(OrderRefundEntity);

  const adminDailyStats = new AdminDailyStatsService();
  (adminDailyStats as unknown as { statsModel: unknown }).statsModel =
    dataSource.getMongoRepository(AdminDailyStatsEntity);
  (adminDailyStats as unknown as { adminOperations: unknown }).adminOperations =
    adminOps;

  const dates = enumerateDates(startDate, endDate);
  console.log(`开始回填每日统计：${startDate} ~ ${endDate}（共 ${dates.length} 天）`);

  let success = 0;
  let failed = 0;
  for (const date of dates) {
    try {
      const point = await adminDailyStats.computeDay(date);
      console.log(
        `  ${date}  users=${point.newUsers} agents=${point.newAgents} ` +
          `msgs=${point.userMessages} netRevenue=${point.netRevenue}`
      );
      success++;
    } catch (err) {
      failed++;
      console.error(`  ${date} 失败：${(err as Error).message}`);
    }
  }

  console.log(`回填完成：成功 ${success} 天，失败 ${failed} 天`);
  await dataSource.destroy();
}

function getYesterdayBeijing(): string {
  const now = new Date();
  const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const yesterday = new Date(
    Date.UTC(
      beijingNow.getUTCFullYear(),
      beijingNow.getUTCMonth(),
      beijingNow.getUTCDate() - 1
    )
  );
  return `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(
    2,
    '0'
  )}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
}

function isValidDate(date: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date);
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  let cursor = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  while (cursor.getTime() <= end.getTime()) {
    result.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(
        2,
        '0'
      )}-${String(cursor.getUTCDate()).padStart(2, '0')}`
    );
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return result;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
