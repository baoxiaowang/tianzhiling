const { DataSource } = require('typeorm');
const { AgentEntity, AgentProfileFactEntity, MongoObjectId } = require('@tzl/entities');
const { DepartureDurationService } = require('../dist/service/agents/departure-duration.service');

(async () => {
  const dataSource = new DataSource({
    type: 'mongodb', host: 'tzl_mongo', port: 27017, database: 'tzl',
    authSource: 'admin', username: 'admin', password: 'qwerasdf',
    synchronize: false, logging: false, entities: [AgentEntity, AgentProfileFactEntity],
  });
  await dataSource.initialize();
  const service = new DepartureDurationService();
  service.agentModel = dataSource.getMongoRepository(AgentEntity);
  service.factModel = dataSource.getMongoRepository(AgentProfileFactEntity);
  service.logger = { info: console.log, warn: console.warn, error: console.error, debug: console.debug };

  // 找第一个未计算的 agent
  const target = await service.agentModel.findOne({
    where: { deathDate: { $ne: null }, departureDuration: null },
  });
  if (!target) { console.log('没有未计算的 agent'); process.exit(0); }
  const targetId = target._id?.toString() || target.id?.toString();
  console.log('目标:', target.name, targetId);
  const result = await service.computeForAgent(targetId);
  console.log('computeForAgent 结果:', result);

  // 验证
  const after = await service.agentModel.findOne({
    where: { _id: new MongoObjectId(targetId) },
  });
  console.log('计算后:', after.departureDuration, after.nodeReminder);

  await dataSource.destroy();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
