import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { MongoObjectId, OrderEntity, OrderStatus } from '@tzl/entities';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';

const SNAPSHOT_PATH = 'snapshot.voiceMembershipDowngrade';
const REQUIRED_CONFIRMATION = 'old-worker-stopped';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

async function main(): Promise<void> {
  const orderId = readStringFrom(
    ['VOICE_MEMBERSHIP_DOWNGRADE_RECOVERY_ORDER_ID'],
    ''
  ).trim();
  const exactToken = readStringFrom(
    ['VOICE_MEMBERSHIP_DOWNGRADE_RECOVERY_TOKEN'],
    ''
  ).trim();
  const confirmation = readStringFrom(
    ['VOICE_MEMBERSHIP_DOWNGRADE_RECOVERY_CONFIRM'],
    ''
  ).trim();

  if (!orderId || !MongoObjectId.isValid(orderId)) {
    throw new Error(
      'VOICE_MEMBERSHIP_DOWNGRADE_RECOVERY_ORDER_ID 必须是精确订单 ObjectId'
    );
  }

  if (!exactToken) {
    throw new Error(
      'VOICE_MEMBERSHIP_DOWNGRADE_RECOVERY_TOKEN 必须是订单中遗留的精确 token'
    );
  }

  if (confirmation !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `仅在确认旧 admin-node worker 已全部停止后设置 VOICE_MEMBERSHIP_DOWNGRADE_RECOVERY_CONFIRM=${REQUIRED_CONFIRMATION}`
    );
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
      'qwerasdf'
    ),
    // Recovery must never create or reconcile schema/indexes as a side effect.
    synchronize: false,
    logging: readBooleanFrom(['ADMIN_API_DB_LOGGING'], false),
    entities: [OrderEntity],
  } as never);

  await dataSource.initialize();

  try {
    const now = new Date();
    const result = await dataSource.getMongoRepository(OrderEntity).updateOne(
      {
        _id: new MongoObjectId(orderId),
        status: {
          $in: [OrderStatus.completed, OrderStatus.refundRequested],
        },
        [`${SNAPSHOT_PATH}.status`]: {
          $in: ['processing', 'benefits_failed', 'failed'],
        },
        [`${SNAPSHOT_PATH}.wechatRefundStatus`]: 'SUCCESS',
        [`${SNAPSHOT_PATH}.benefitsApplyToken`]: exactToken,
      } as never,
      {
        $set: {
          [`${SNAPSHOT_PATH}.status`]: 'benefits_failed',
          [`${SNAPSHOT_PATH}.failureReason`]:
            '旧 worker 停止后已通过精确 token 释放遗留权益锁，请在管理后台刷新降级状态',
          [`${SNAPSHOT_PATH}.updatedAt`]: now.toISOString(),
          updatedAt: now,
        },
        $unset: {
          [`${SNAPSHOT_PATH}.benefitsApplyToken`]: '',
          [`${SNAPSHOT_PATH}.benefitsApplyStartedAt`]: '',
        },
      } as never
    );

    if (Number(result.matchedCount ?? result.modifiedCount ?? 0) !== 1) {
      throw new Error(
        '未找到同时匹配订单、退款成功状态和精确 token 的遗留锁；未修改任何数据'
      );
    }

    console.log(
      `已释放订单 ${orderId} 的遗留降级权益锁，请在管理后台刷新降级状态。`
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
