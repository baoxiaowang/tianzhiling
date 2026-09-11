const { DataSource, ObjectId } = require('typeorm');
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
  service.agentModel = dataSource.getMongoRepository(AgentEntity);
  service.factModel = dataSource.getMongoRepository(AgentProfileFactEntity);
  service.logger = { info: console.log, warn: console.warn, error: console.error, debug: console.debug };

  // 先找一个有 deathDate 的 agent
  const agent = await service.agentModel.findOne({
    where: { deathDate: { $ne: null } }
  });
  console.log('找到 agent:', agent.name, 'deathDate:', agent.deathDate, '_id:', agent._id?.toString());

  if (agent) {
    const agentId = agent._id.toString();
    console.log('agentId:', agentId);

    // 测试1: 用 new Object(agentId) 查询
    try {
      const found1 = await service.agentModel.findOne({
        where: { _id: new Object(agentId) }
      });
      console.log('测试1 new Object(agentId):', found1 ? '找到' : '未找到');
    } catch (e) {
      console.log('测试1 失败:', e.message);
    }

    // 测试2: 用 new ObjectId(agentId) 查询
    try {
      const found2 = await service.agentModel.findOne({
        where: { _id: new ObjectId(agentId) }
      });
      console.log('测试2 new ObjectId(agentId):', found2 ? '找到' : '未找到');
    } catch (e) {
      console.log('测试2 失败:', e.message);
    }

    // 测试3: 直接调用 computeForAgent
    const result = await service.computeForAgent(agentId);
    console.log('computeForAgent 结果:', result);

    // 检查是否保存成功
    const updated = await service.agentModel.findOne({
      where: { _id: new ObjectId(agentId) }
    });
    console.log('更新后 departureDuration:', updated?.departureDuration);
    console.log('更新后 nodeReminder:', updated?.nodeReminder);
    console.log('更新后 departureDurationComputedAt:', updated?.departureDurationComputedAt);
  }

  await dataSource.destroy();
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
