import { MongoClient, ObjectId } from 'mongodb';
const {
  Rebuild,
  messageRepository,
  manual,
} = require('../../scripts/rebuild-memory-history');
const run =
  process.env.MEMORY_INTEGRATION_MONGO === 'yes' ? describe : describe.skip;
run('full history reconstruction on standalone MongoDB', () => {
  let client: MongoClient, source: any, stage: any, backup: any, job: any;
  const uid = new ObjectId(),
    aid = new ObjectId(),
    cid = new ObjectId();
  const runId = 'memory_rebuild_test_30d';
  const now = new Date(),
    old = new Date(+now - 100 * 864e5),
    recent = new Date(+now - 864e5);
  const env = {
    mode: process.env.NODE_MEMORY_VALUE_MODE,
    ids: process.env.NODE_MEMORY_VALUE_USER_IDS,
  };
  beforeAll(async () => {
    client = new MongoClient(
      'mongodb://127.0.0.1:28791/?directConnection=true'
    );
    await client.connect();
  });
  beforeEach(async () => {
    const prefix = `rebuild_test_${process.pid}_${new ObjectId()}`;
    source = client.db(prefix);
    stage = client.db(`${prefix}_stage`);
    backup = client.db(`${prefix}_backup`);
    job = new Rebuild(source, stage, backup, runId, {
      delayMs: 0,
      pressure: async () => false,
    });
    await source.collection('user').insertOne({ _id: uid, status: 'active' });
    await source
      .collection('agent')
      .insertOne({
        _id: aid,
        createdUserId: uid,
        name: '爸爸',
        iCallAgent: '爸爸',
        agentCallMe: '囡囡',
        customContext: '手工设定',
        createdAt: old,
        updatedAt: old,
      });
    await source
      .collection('message')
      .insertMany(
        [old, recent].map(createdAt => ({
          _id: new ObjectId(),
          userId: uid,
          agentId: aid,
          conversationId: cid,
          role: 'user',
          status: 'sent',
          type: 'text',
          content: '小时候爸爸在树下给我讲故事',
          createdAt,
        }))
      );
    await source
      .collection('agent_profile_fact')
      .createIndex({ userId: 1, agentId: 1, key: 1 }, { unique: true });
    process.env.NODE_MEMORY_VALUE_MODE = 'active';
    process.env.NODE_MEMORY_VALUE_USER_IDS = String(uid);
    await job.init();
  });
  afterEach(async () => {
    await source?.dropDatabase();
    await stage?.dropDatabase();
    await backup?.dropDatabase();
  });
  afterAll(async () => {
    await client.close();
    for (const [k, v] of Object.entries({
      NODE_MEMORY_VALUE_MODE: env.mode,
      NODE_MEMORY_VALUE_USER_IDS: env.ids,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  const proposal = () => ({
    isEnabled: () => true,
    generateText: jest.fn(async (o: any) => {
      const input = JSON.parse(o.prompt);
      if (o.memoryReview)
        return {
          content: JSON.stringify({
            approved: input.proposals.map((p: any) => p.index),
            reasons: [],
          }),
        };
      const m = input.messages[input.messages.length - 1];
      return {
        content: JSON.stringify({
          newPeople: [],
          decisions: [
            {
              subjectRef: `agent:${aid}`,
              participants: [],
              kind: 'event',
              type: 'memory',
              key: `memory.source_${m.id}`,
              value: '爸爸在树下给用户讲故事',
              retention: 'durable',
              certainty: 'explicit',
              timeKind: 'historical',
              operation: 'add',
              reason: '具体共同经历',
              evidence: [{ messageId: m.id, quote: m.content }],
              protected: false,
              salience: 2,
            },
          ],
        }),
      };
    }),
  });
  it('freezes only 30-day active non-canceled accounts, but includes their older history', async () => {
    const inactive = new ObjectId(),
      canceled = new ObjectId();
    await source
      .collection('user')
      .insertMany([{ _id: inactive }, { _id: canceled, status: 'canceled' }]);
    await source.collection('message').insertMany([
      {
        userId: inactive,
        role: 'user',
        status: 'sent',
        createdAt: new Date(+now - 31 * 864e5),
      },
      { userId: canceled, role: 'user', status: 'sent', createdAt: recent },
    ]);
    const r = await job.plan();
    expect(r.activeDays).toBe(30);
    expect(r.accounts).toBe(1);
    expect(r.messages).toBe(2);
    expect(await stage.collection('accounts').countDocuments({})).toBe(1);
  });
  it('stages fresh automatic memories while keeping manual data and original messages unchanged', async () => {
    const m = await source.collection('message').findOne({});
    const bad = {
      _id: new ObjectId(),
      userId: uid,
      agentId: aid,
      key: 'occupation.primary',
      value: '妈妈的骄傲',
      sourceMessageId: m._id,
      updatedAt: old,
      status: 'active',
    };
    await source
      .collection('agent_profile_fact')
      .insertMany([
        bad,
        {
          _id: new ObjectId(),
          userId: uid,
          agentId: aid,
          key: 'profile_source.hobbies',
          value: '手工爱好',
          sourceMessageId: m._id,
          updatedAt: old,
        },
      ]);
    await job.plan();
    await job.seed(await stage.collection('accounts').findOne({ _id: uid }));
    expect(
      await stage
        .collection('agent_profile_fact')
        .findOne({ key: 'occupation.primary' })
    ).toBeNull();
    expect(
      await stage
        .collection('agent_profile_fact')
        .findOne({ key: 'profile_source.hobbies' })
    ).toBeTruthy();
    await job.replay(
      await stage.collection('accounts').findOne({ _id: uid }),
      proposal()
    );
    expect(
      await source.collection('agent_profile_fact').findOne({ _id: bad._id })
    ).toEqual(bad);
    expect(
      (await source.collection('message').findOne({ _id: m._id }))
        .memoryValueAudit
    ).toBeUndefined();
    expect(
      await stage.collection('message_audit').countDocuments({ userId: uid })
    ).toBe(2);
    await job.publish(await stage.collection('accounts').findOne({ _id: uid }));
    expect(
      await source.collection('agent_profile_fact').findOne({ _id: bad._id })
    ).toBeNull();
    expect(
      await backup.collection('agent_profile_fact').findOne({ _id: bad._id })
    ).toEqual(bad);
    expect(
      await source
        .collection('agent_profile_fact')
        .countDocuments({ memoryRebuildRunId: runId })
    ).toBe(2);
    expect(
      (await source.collection('agent').findOne({ _id: aid })).customContext
    ).toBe('手工设定');
    expect(
      (await source.collection('message').findOne({ _id: m._id })).content
    ).toBe(m.content);
    expect(
      await source
        .collection('memory_pipeline_task')
        .countDocuments({ pipelineVersion: runId })
    ).toBe(2);
    await job.publish(await stage.collection('accounts').findOne({ _id: uid }));
    expect(
      await source
        .collection('memory_pipeline_task')
        .countDocuments({ pipelineVersion: runId })
    ).toBe(2);
  });
  it('preserves concurrent live changes instead of replacing them with historical replay', async () => {
    const m = await source.collection('message').findOne({});
    const fid = new ObjectId();
    await source
      .collection('agent_profile_fact')
      .insertOne({
        _id: fid,
        userId: uid,
        agentId: aid,
        key: 'memory.shared',
        value: '旧内容',
        sourceMessageId: m._id,
        updatedAt: old,
      });
    await job.plan();
    await job.seed(await stage.collection('accounts').findOne({ _id: uid }));
    await stage
      .collection('agent_profile_fact')
      .insertOne({
        _id: new ObjectId(),
        userId: uid,
        agentId: aid,
        key: 'memory.shared',
        value: '历史重建',
        sourceMessageId: m._id,
        updatedAt: new Date(),
      });
    await source
      .collection('agent_profile_fact')
      .updateOne(
        { _id: fid },
        { $set: { value: '用户刚才纠正', updatedAt: new Date() } }
      );
    const r = await job.publish({ _id: uid });
    expect(r.preservedConcurrent).toBe(1);
    expect(
      (await source.collection('agent_profile_fact').findOne({ _id: fid }))
        .value
    ).toBe('用户刚才纠正');
  });
  it('does not reuse old audits, and forbids original text writes through adapters', async () => {
    const m = await source.collection('message').findOne({});
    await source
      .collection('message')
      .updateOne(
        { _id: m._id },
        {
          $set: {
            memoryValueAudit: {
              status: 'completed',
              version: 'memory_value_v1',
            },
          },
        }
      );
    const repo = messageRepository(source, stage);
    expect(
      (await repo.findOne({ where: { _id: m._id } })).memoryValueAudit
    ).toBeUndefined();
    await expect(
      repo.updateOne({ _id: m._id }, { $set: { content: '不可改' } })
    ).rejects.toThrow('FIELD_DENIED');
    expect(
      manual('user_identity_profile', {
        source: 'settings',
        sourceMessageId: m._id,
      })
    ).toBe(true);
  });
  it('refuses long sources before publication rather than silently truncating them', async () => {
    await source
      .collection('message')
      .updateOne(
        { userId: uid, createdAt: old },
        { $set: { content: '长'.repeat(6001) } }
      );
    await job.plan();
    await job.seed(await stage.collection('accounts').findOne({ _id: uid }));
    await expect(
      job.replay(
        await stage.collection('accounts').findOne({ _id: uid }),
        proposal()
      )
    ).rejects.toThrow('REQUIRES_CHUNKING');
    expect(
      await source.collection('memory_pipeline_task').countDocuments({})
    ).toBe(0);
  });
});
