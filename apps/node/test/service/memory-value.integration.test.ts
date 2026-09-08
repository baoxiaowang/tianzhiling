import { MongoClient } from 'mongodb';
import { AgentEntity, MongoObjectId } from '@tzl/entities';
import { MemoryValueService } from '../../src/service/agents/memory-value.service';
import { AgentProfileFactService } from '../../src/service/agents/agent-profile-fact.service';
import { AgentMemoryProfileService } from '../../src/service/agents/agent-memory-profile.service';
import { UserIdentityMemoryService } from '../../src/service/agents/user-identity-memory.service';
import { MilvusService } from '../../src/service/rag/milvus.service';
import { buildAgentIdentityContract } from '../../src/service/agents/agent-identity-contract';
import { MemoryDecisionModelService } from '../../src/service/agents/memory-decision-model.service';

// Real isolated MongoDB; model and vector transport are deterministic adapters.
// This verifies persistence/projections/read contracts, not live model quality or ANN recall.
const run =
  process.env.MEMORY_INTEGRATION_MONGO === 'yes' ? describe : describe.skip;
run('governed memory persistence to reply context', () => {
  let client: MongoClient;
  let db: any;
  const uid = new MongoObjectId('665000000000000000000001');
  const aid = new MongoObjectId('665000000000000000000002');
  const mid = new MongoObjectId('665000000000000000000003');
  const oldMode = process.env.NODE_MEMORY_VALUE_MODE;
  const oldUsers = process.env.NODE_MEMORY_VALUE_USER_IDS;
  const hydrate = (d: any) => (d ? { ...d, id: d._id } : null);
  function repo(name: string): any {
    const c = db.collection(name);
    return {
      find: async (o: any) =>
        (
          await c
            .find(o.where || {})
            .sort(
              Object.fromEntries(
                Object.entries(o.order || {}).map(([k, v]) => [
                  k,
                  v === 'DESC' ? -1 : 1,
                ])
              )
            )
            .limit(o.take || 100)
            .toArray()
        ).map(hydrate),
      findOne: async (o: any) => hydrate(await c.findOne(o.where || {})),
      insertOne: (d: any) => c.insertOne(d),
      updateOne: (f: any, u: any, o: any) => c.updateOne(f, u, o),
      save: async (d: any) => {
        const { id, _id, ...rest } = d;
        const key = id || _id || new MongoObjectId();
        await c.updateOne({ _id: key }, { $set: rest }, { upsert: true });
        return { ...rest, id: key };
      },
    };
  }
  beforeAll(async () => {
    client = new MongoClient(
      'mongodb://127.0.0.1:28791/?directConnection=true',
      { serverSelectionTimeoutMS: 5000 }
    );
    await client.connect();
    db = client.db(`tzl_memory_test_${process.pid}`);
    process.env.NODE_MEMORY_VALUE_MODE = 'active';
    process.env.NODE_MEMORY_VALUE_USER_IDS = String(uid);
  });
  afterAll(async () => {
    if (db) await db.dropDatabase();
    if (client) await client.close();
    if (oldMode === undefined) delete process.env.NODE_MEMORY_VALUE_MODE;
    else process.env.NODE_MEMORY_VALUE_MODE = oldMode;
    if (oldUsers === undefined) delete process.env.NODE_MEMORY_VALUE_USER_IDS;
    else process.env.NODE_MEMORY_VALUE_USER_IDS = oldUsers;
  });
  it('writes once, projects the account name, refreshes persona, and validates indexed evidence', async () => {
    const agent = Object.assign(new AgentEntity(), {
      id: aid,
      createdUserId: uid,
      name: '爸爸',
      iCallAgent: '爸爸',
      agentCallMe: '闺女',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const message: any = {
      id: mid,
      userId: uid,
      agentId: aid,
      conversationId: new MongoObjectId(),
      role: 'user',
      type: 'text',
      status: 'sent',
      content: '我叫林晓。小时候爸爸在树下给我讲故事。',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await repo('agent').save(agent);
    await repo('message').save(message);
    const memory = new MemoryValueService();
    memory.factModel = repo('agent_profile_fact');
    memory.messageModel = repo('message');
    memory.agentModel = repo('agent');
    memory.personModel = repo('user_known_person');
    const identity = new UserIdentityMemoryService();
    identity.identityModel = repo('user_identity_profile');
    identity.messageModel = repo('message');
    memory.userIdentityMemoryService = identity;
    const common = {
      participants: [],
      kind: 'person',
      retention: 'core',
      certainty: 'explicit',
      timeKind: 'stable',
      operation: 'add',
      protected: true,
      salience: 3,
      reason: '明确身份',
    };
    const decisions = [
      {
        ...common,
        subjectRef: `user:${uid}`,
        type: 'identity',
        key: 'user.identity.real_name',
        value: '用户正式姓名是林晓',
        identity: { realName: '林晓' },
        evidence: [{ messageId: String(mid), quote: '我叫林晓' }],
      },
      {
        ...common,
        subjectRef: `agent:${aid}`,
        kind: 'event',
        type: 'memory',
        key: 'memory.tree',
        value: '小时候爸爸在树下给用户讲故事',
        retention: 'durable',
        timeKind: 'historical',
        protected: false,
        evidence: [
          { messageId: String(mid), quote: '小时候爸爸在树下给我讲故事' },
        ],
      },
    ];
    const generateText = jest.fn(async (o: any) => ({
      content: JSON.stringify(
        o.memoryReview
          ? { approved: [0, 1], reasons: [] }
          : { decisions, newPeople: [] }
      ),
    }));
    const live = process.env.MEMORY_INTEGRATION_MODEL === 'live';
    let realModel: MemoryDecisionModelService | undefined;
    if (live) {
      const values = require('dotenv').parse(
        require('fs').readFileSync('../../.env')
      );
      for (const [key, value] of Object.entries(values))
        if (process.env[key] === undefined) process.env[key] = String(value);
      realModel = new MemoryDecisionModelService();
      realModel.providerConfig =
        require('../../dist/config/config.default').default.openai;
      realModel.configureMemoryModel();
      if (
        new URL(realModel.openAIConfig.baseURL!).hostname !==
          'dashscope.aliyuncs.com' ||
        realModel.openAIConfig.model !== 'qwen-plus'
      )
        throw Error('Unexpected synthetic evaluation provider');
    }
    memory.openAIService =
      realModel || ({ isEnabled: () => true, generateText } as any);
    const written = await memory.process(message, message.content, agent);
    if (live)
      console.info(
        'synthetic memory decisions',
        JSON.stringify(
          written.audit.decisions.map(d => ({
            subjectRef: d.subjectRef,
            key: d.key,
            value: d.value,
          }))
        )
      );
    expect(written.count).toBeGreaterThanOrEqual(2);
    const countBeforeReplay = await db
      .collection('agent_profile_fact')
      .countDocuments();
    expect(
      (await repo('message').findOne({ where: { _id: mid } })).memoryWriteStatus
    ).toBe('written');
    await memory.process(message, message.content, agent);
    expect(await db.collection('agent_profile_fact').countDocuments()).toBe(
      countBeforeReplay
    );
    if (!live) expect(generateText).toHaveBeenCalledTimes(2);
    const facts = new AgentProfileFactService();
    facts.factModel = memory.factModel;
    const promptFacts = await facts.listFactsForPrompt({
      userId: uid,
      agentId: aid,
    });
    expect(promptFacts.every(f => !f.key.includes('real_name'))).toBe(true);
    const treeFact = promptFacts.find(f => f.value.includes('树下'));
    expect(treeFact).toBeDefined();
    const profile = new AgentMemoryProfileService();
    profile.agentModel = memory.agentModel;
    profile.agentProfileFactService = facts;
    profile.openAIService =
      realModel ||
      ({
        isEnabled: () => true,
        generateText: jest.fn(async () => ({
          content: JSON.stringify({
            lifeExperience: '',
            personalityTraits: '',
            languageHabits: '',
            hobbies: '',
            sharedMemories: '小时候在树下给闺女讲故事。',
          }),
        })),
      } as any);
    await profile.refreshFromMemoryNow({
      agent,
      userId: uid,
      deduplicateByFacts: true,
    });
    expect(
      (await repo('agent').findOne({ where: { _id: aid } })).sharedMemories
    ).toContain('树下');
    const contract = buildAgentIdentityContract({
      agent,
      profileFacts: promptFacts,
      userIdentity: await identity.getUserIdentity(uid),
    });
    expect(contract.user.realName).toBe('林晓');
    expect(contract.addresses.agentCallsUser).toBe('闺女');
    const indexed: any[] = [];
    await memory.indexMessage(message, {
      indexConversationMessage: async (r: any) => {
        indexed.push({ ...r, id: r.memoryId });
        return true;
      },
    } as any);
    expect(indexed.length).toBeGreaterThanOrEqual(1);
    const vectors = new MilvusService();
    vectors.governedFactModel = memory.factModel;
    expect(
      await (vectors as any).filterGovernedEvidence(indexed, String(uid))
    ).toHaveLength(indexed.length);
    if (realModel) {
      const response = await realModel.generateText({
        systemPrompt:
          '根据身份和记忆回答用户的问题。未知内容不编造。输出JSON对象{"answer":"回复"}。',
        prompt: JSON.stringify({
          identity: contract,
          profile: agent.sharedMemories,
          evidence: await (vectors as any).filterGovernedEvidence(
            indexed,
            String(uid)
          ),
          question: '我叫什么？小时候你在哪里给我讲故事？',
        }),
      });
      const answer = JSON.parse(response.content).answer;
      expect(answer).toContain('林晓');
      expect(answer).toContain('树下');
    }
    await db
      .collection('agent_profile_fact')
      .updateOne({ key: treeFact!.key }, { $set: { status: 'archived' } });
    const afterArchive = await (vectors as any).filterGovernedEvidence(
      indexed,
      String(uid)
    );
    expect(
      afterArchive.every((r: any) => !r.searchableText.includes('树下'))
    ).toBe(true);
    expect(
      (await facts.listFactsForPrompt({ userId: uid, agentId: aid })).every(
        f => !f.value.includes('树下')
      )
    ).toBe(true);
  }, 240000);
});
