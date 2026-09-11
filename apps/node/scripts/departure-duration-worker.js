// 独立的 departure-duration worker，绕过 MidwayJS 生命周期问题
const { Worker, Queue } = require('bullmq');
const { DataSource } = require('typeorm');
const { AgentEntity, AgentProfileFactEntity } = require('@tzl/entities');

const connection = { host: 'tzl_redis', port: 6379 };
// 必须与应用队列的前缀一致（MidwayJS bullmq 框架配置的 prefix 为 {tzl-bullmq}），
// 否则独立 worker 会监听错误的队列（默认 bull: 前缀），永远收不到应用入队的 job。
const queuePrefix = '{tzl-bullmq}';

// 注册 daily/monthly 定时任务（原生 BullMQ upsertJobScheduler）。
// 不依赖 MidwayJS 生命周期（其 addJobToQueue 将队列名作为 jobSchedulerId，
// 导致 daily/monthly 相互覆盖丢失），worker 启动时必然执行，保证每次部署后定时任务就位。
async function ensureRepeatJobs() {
  const queue = new Queue('departure-duration', { connection, prefix: queuePrefix });
  try {
    await queue.upsertJobScheduler(
      'departure-duration-daily',
      { pattern: '0 3 * * *' },
      {
        name: 'departure-duration',
        data: { type: 'daily' },
        opts: { removeOnComplete: true, removeOnFail: 30 },
      }
    );
    await queue.upsertJobScheduler(
      'departure-duration-monthly',
      { pattern: '0 3 1 * *' },
      {
        name: 'departure-duration',
        data: { type: 'monthly' },
        opts: { removeOnComplete: true, removeOnFail: 30 },
      }
    );
    console.log('[departure-duration-worker] repeat jobs ensured: daily(03:00), monthly(1st 03:00)');
  } finally {
    await queue.close();
  }
}

async function main() {
  // 初始化 TypeORM 连接
  const dataSource = new DataSource({
    type: 'mongodb',
    host: 'tzl_mongo',
    port: 27017,
    database: 'tzl',
    authSource: 'admin',
    username: 'admin',
    password: 'qwerasdf',
    synchronize: false,
    logging: false,
    entities: [AgentEntity, AgentProfileFactEntity],
  });

  await dataSource.initialize();
  console.log('[departure-duration-worker] TypeORM connected');

  const agentRepo = dataSource.getMongoRepository(AgentEntity);
  const factRepo = dataSource.getMongoRepository(AgentProfileFactEntity);

  // 导入 DepartureDurationService 并手动创建实例
  const { DepartureDurationService } = require('../dist/service/agents/departure-duration.service');
  const service = new DepartureDurationService();
  service.agentModel = agentRepo;
  service.factModel = factRepo;
  // 手动设置 logger
  service.logger = {
    info: (...args) => console.log('[departure-duration-service]', ...args),
    warn: (...args) => console.warn('[departure-duration-service]', ...args),
    error: (...args) => console.error('[departure-duration-service]', ...args),
    debug: (...args) => console.debug('[departure-duration-service]', ...args),
  };

  // 注册 daily/monthly 定时任务（不依赖 MidwayJS 生命周期）
  await ensureRepeatJobs();

  // 创建 worker
  const worker = new Worker(
    'departure-duration',
    async (job) => {
      console.log(`[departure-duration-worker] processing job ${job.id}, type=${job.data?.type || 'daily'}`);
      try {
        if (job.data?.type === 'single' && job.data.agentId) {
          await service.computeForAgent(job.data.agentId);
        } else if (job.data?.type === 'monthly') {
          const result = await service.computeForAll();
          console.log(`[departure-duration-worker] monthly completed, computed=${result.computed}, skipped=${result.skipped}, durationMs=${result.durationMs}`);
        } else {
          const result = await service.computeForActiveUsers();
          console.log(`[departure-duration-worker] daily completed, computed=${result.computed}, skipped=${result.skipped}, durationMs=${result.durationMs}`);
        }
      } catch (err) {
        console.error(`[departure-duration-worker] job failed:`, err.message);
        throw err;
      }
    },
    { connection, prefix: queuePrefix, concurrency: 1 }
  );

  worker.on('ready', () => console.log('[departure-duration-worker] worker ready'));
  worker.on('error', (err) => console.error('[departure-duration-worker] worker error:', err.message));

  // 保持进程运行
  process.on('SIGTERM', async () => {
    await worker.close();
    await dataSource.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[departure-duration-worker] startup failed:', err);
  process.exit(1);
});
