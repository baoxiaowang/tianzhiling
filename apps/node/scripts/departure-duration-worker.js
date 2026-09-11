// 独立的 departure-duration worker，绕过 MidwayJS 生命周期问题
const { Worker } = require('bullmq');
const { DataSource } = require('typeorm');
const { AgentEntity, AgentProfileFactEntity } = require('@tzl/entities');

const connection = { host: 'tzl_redis', port: 6379 };

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
  const { DepartureDurationService } = require('./dist/service/agents/departure-duration.service');
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
    { connection, concurrency: 1 }
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
