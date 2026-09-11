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
    logging: true,
    entities: [AgentEntity, AgentProfileFactEntity],
  });
  await dataSource.initialize();
  console.log('TypeORM connected');

  const repo = dataSource.getMongoRepository(AgentEntity);

  // 测试1: 用 count
  const count1 = await repo.count();
  console.log('总 agent 数:', count1);

  // 测试2: 用 find 查一条
  const one = await repo.findOne();
  console.log('一条 agent:', one ? JSON.stringify({ name: one.name, deathDate: one.deathDate, _id: one._id }) : 'null');

  // 测试3: 用 MongoDB 原生查询
  const nativeResult = await repo.aggregate([
    { $match: { deathDate: { $ne: null } } },
    { $count: 'count' }
  ]).toArray();
  console.log('原生聚合查询有 deathDate 的数量:', nativeResult);

  // 测试4: 用 find + where
  try {
    const withDeathDate = await repo.find({
      where: {
        deathDate: { $ne: null }
      },
      take: 3
    });
    console.log('find with where deathDate != null:', withDeathDate.length);
    withDeathDate.forEach(a => console.log('  -', a.name, a.deathDate));
  } catch (e) {
    console.log('find with where 失败:', e.message);
  }

  await dataSource.destroy();
  process.exit(0);
}
main().catch(err => { console.error(err); process.exit(1); });
