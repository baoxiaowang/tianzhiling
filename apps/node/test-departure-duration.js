const { DataSource } = require('typeorm');
const { AgentEntity, AgentProfileFactEntity } = require('@tzl/entities');

async function main() {
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

  const { DepartureDurationService } = require('./dist/service/agents/departure-duration.service');
  const service = new DepartureDurationService();
  service.agentRepository = dataSource.getMongoRepository(AgentEntity);
  service.agentProfileFactRepository = dataSource.getMongoRepository(AgentProfileFactEntity);
  service.logger = { info: console.log, warn: console.warn, error: console.error, debug: console.debug };

  // 先检查有多少有 deathDate 的 agent
  const totalWithDeathDate = await service.agentRepository.count({ where: { deathDate: { $ne: null } } });
  console.log('有 deathDate 的 agent 总数:', totalWithDeathDate);

  // 运行 computeForActiveUsers
  const result = await service.computeForActiveUsers();
  console.log('computeForActiveUsers 结果:', JSON.stringify(result));

  // 检查计算后的数据
  const computed = await service.agentRepository.count({ where: { departureDuration: { $ne: null } } });
  console.log('计算后有 departureDuration 的数量:', computed);

  // 查看几条计算结果
  const samples = await service.agentRepository.find({
    where: { departureDuration: { $ne: null } },
    take: 3,
  });
  samples.forEach(s => console.log('样本:', s.name, s.deathDate, '->', s.departureDuration));

  await dataSource.destroy();
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
