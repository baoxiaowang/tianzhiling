import { resolve } from 'path';
import { DataSource } from 'typeorm';
import {
  AgentEntity,
  MessageEntity,
  OrderAnalyticsSnapshotEntity,
  OrderMonthlyReportSnapshotEntity,
} from '@tzl/entities';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

async function main(): Promise<void> {
  const apply =
    readStringFrom(['ADMIN_PERFORMANCE_INDEX_MODE'], 'audit') === 'apply';
  if (
    apply &&
    readStringFrom(['ADMIN_PERFORMANCE_INDEX_CONFIRM'], '') !==
      'create-reviewed-admin-indexes'
  ) {
    throw new Error('创建索引需要 ADMIN_PERFORMANCE_INDEX_CONFIRM 确认短语');
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
    port: readNumberFrom(
      ['ADMIN_API_MONGO_PORT', 'NODE_MONGO_PORT', 'MONGO_PORT'],
      17271
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
      ''
    ),
    synchronize: false,
    logging: readBooleanFrom(['ADMIN_API_DB_LOGGING'], false),
    entities: [
      AgentEntity,
      MessageEntity,
      OrderAnalyticsSnapshotEntity,
      OrderMonthlyReportSnapshotEntity,
    ],
  } as never);

  await dataSource.initialize();
  try {
    const specs = [
      {
        repo: dataSource.getMongoRepository(AgentEntity),
        name: 'IDX_agent_messenger_created',
        key: { messengerOfAgentId: 1, createdAt: -1 },
      },
      {
        repo: dataSource.getMongoRepository(MessageEntity),
        name: 'IDX_message_agent_role',
        key: { agentId: 1, role: 1 },
      },
      {
        repo: dataSource.getMongoRepository(MessageEntity),
        name: 'IDX_message_conversation_role',
        key: { conversationId: 1, role: 1 },
      },
      {
        repo: dataSource.getMongoRepository(OrderAnalyticsSnapshotEntity),
        name: 'IDX_order_analytics_snapshot_month',
        key: { month: 1 },
        unique: true,
      },
      {
        repo: dataSource.getMongoRepository(OrderMonthlyReportSnapshotEntity),
        name: 'IDX_order_monthly_report_snapshot_month',
        key: { month: 1 },
        unique: true,
      },
    ];
    const results = [];
    for (const spec of specs) {
      let exists = false;
      let duplicateKeys: Array<{ value: unknown; count: number }> = [];
      try {
        exists = await spec.repo.collectionIndexExists(spec.name);
      } catch (error) {
        const code = (error as { code?: number }).code;
        const message = error instanceof Error ? error.message : String(error);
        if (
          code !== 26 &&
          !/ns does not exist|namespace.*not found/i.test(message)
        ) {
          throw error;
        }
      }
      if (spec.unique) {
        try {
          duplicateKeys = await spec.repo
            .aggregate<{ _id: unknown; count: number }>([
              { $group: { _id: '$month', count: { $sum: 1 } } },
              { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
            ])
            .toArray()
            .then(rows =>
              rows.map(row => ({ value: row._id, count: row.count }))
            );
        } catch (error) {
          const code = (error as { code?: number }).code;
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            code !== 26 &&
            !/ns does not exist|namespace.*not found/i.test(message)
          ) {
            throw error;
          }
        }
      }
      if (apply && duplicateKeys.length > 0) {
        throw new Error(`${spec.name} 存在重复月份，禁止创建唯一索引`);
      }
      if (apply && !exists) {
        await spec.repo.createCollectionIndex(spec.key, {
          name: spec.name,
          background: true,
          ...(spec.unique ? { unique: true } : {}),
        });
      }
      results.push({
        name: spec.name,
        exists,
        duplicateKeys,
        action: apply && !exists ? 'created' : 'none',
      });
    }
    console.log(
      JSON.stringify(
        { mode: apply ? 'apply' : 'audit', indexes: results },
        null,
        2
      )
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
