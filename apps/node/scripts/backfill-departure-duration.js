// 补算所有 departureDuration 为 null 但 deathDate 有值的 agent（复用 DepartureDurationService）
// 用法: node scripts/backfill-departure-duration.js
const path = require('path');
const { DataSource } = require('typeorm');
const { AgentEntity, AgentProfileFactEntity } = require('@tzl/entities');
const { DepartureDurationService } = require('../dist/service/agents/departure-duration.service');

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://admin:qwerasdf@tzl_mongo:27017/tzl?authSource=admin';

async function main() {
  console.log('[backfill-departure-duration] connecting MongoDB...');
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
  console.log('[backfill-departure-duration] connected');

  const service = new DepartureDurationService();
  service.agentModel = dataSource.getMongoRepository(AgentEntity);
  service.factModel = dataSource.getMongoRepository(AgentProfileFactEntity);
  service.logger = {
    info: (...args) => console.log('[departure-duration]', ...args),
    warn: (...args) => console.warn('[departure-duration]', ...args),
    error: (...args) => console.error('[departure-duration]', ...args),
  };

  // 只补算未计算的
  const agents = await service.agentModel.find({
    where: { deathDate: { $ne: null }, departureDuration: null },
  });
  console.log(`[backfill-departure-duration] 待处理 agent: ${agents.length}`);

  let computed = 0;
  let skipped = 0;
  const start = Date.now();

  for (const agent of agents) {
    const agentId = agent._id?.toString() || agent.id?.toString();
    if (!agentId) {
      skipped++;
      continue;
    }
    const success = await service.computeForAgent(agentId);
    if (success) computed++;
    else skipped++;
  }

  const durationMs = Date.now() - start;
  console.log(
    `[backfill-departure-duration] 完成: computed=${computed}, skipped=${skipped}, durationMs=${durationMs}`
  );
  await dataSource.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error('[backfill-departure-duration] fatal:', e);
  process.exit(1);
});
