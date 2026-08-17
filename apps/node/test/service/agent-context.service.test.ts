import { AgentContextService } from '../../src/service/agents/agent.context';
import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { resolveAgentChatToolTurnPlan } from '../../src/service/agents/agent-chat-tools';
import type { StructuredReplyIntent } from '../../src/service/agents/reply-intent';
import {
  AgentEntity,
  AgentRelationshipSignalAssertionPolicy,
  AgentRelationshipSignalStatus,
  AgentRelationshipSignalSubject,
  AgentRelationshipSignalTopic,
  AgentRelationshipSignalType,
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';

describe('AgentContextService', () => {
  it('adds the compact tool decision contract only to sampled shadow turns', () => {
    const service = new AgentContextService();
    const replyBrief = buildReplyBrief({
      currentQuery: '你还记得我们以前去过哪里吗',
    });
    const plan = resolveAgentChatToolTurnPlan({
      config: { mode: 'shadow', shadowSampleRate: 1 },
      stableKey: 'shadow-case',
      currentQuery: '你还记得我们以前去过哪里吗',
      replyBrief,
      planningMode: 'semantic',
      planningReason: 'memory_candidate',
      plannerMemoryRequested: true,
    });
    const prompt = (service as any).buildModelReplyBriefPrompt(
      replyBrief,
      plan
    );

    expect(prompt).toContain('# 工具决策影子');
    expect(prompt).toContain('"toolDecisions"');
    expect(prompt).toContain('本轮不执行工具');
  });

  it('keeps only the current correction as assertable evidence after a fact reset', () => {
    const service = new AgentContextService();
    const evidence = (
      service as unknown as {
        buildEvidencePack: (options: Record<string, unknown>) => Array<{
          id: string;
          source: string;
          text: string;
          assertionPolicy: string;
        }>;
      }
    ).buildEvidencePack({
      currentQuery: '没有这回事，你别再编了',
      recentMessages: [],
      agent: null,
      profileFacts: [],
      hardFacts: [],
      retrievedMemories: [],
      suppressPriorFacts: true,
      currentUserCanAssert: true,
    });

    expect(evidence).toEqual([
      expect.objectContaining({
        id: 'U0',
        source: 'current_user',
        text: '没有这回事，你别再编了',
        assertionPolicy: 'can_assert',
        factKey: 'correction.current',
        useMode: 'uptake',
        status: 'active',
      }),
    ]);
  });

  it('keeps confirmed facts scoped to different conversation objects', () => {
    const service = new AgentContextService();
    const evidence = (service as any).buildEvidencePack({
      currentQuery: '小雨十一岁了，小雪十二岁了',
      recentMessages: [],
      agent: null,
      profileFacts: [
        {
          type: 'family',
          key: 'family.shared_member.xiaoyu.age',
          value: '小雨十一岁',
          polarity: 'positive',
          confidence: 'confirmed',
          priority: 2,
        },
        {
          type: 'family',
          key: 'family.shared_member.xiaoxue.age',
          value: '小雪十二岁',
          polarity: 'positive',
          confidence: 'confirmed',
          priority: 2,
        },
      ],
      hardFacts: [],
      retrievedMemories: [],
      objectPlan: {
        objects: [
          {
            ref: 'o1',
            mention: '小雨',
            kind: 'family',
            binding: 'family_xiaoyu',
            confidence: 'high',
          },
          {
            ref: 'o2',
            mention: '小雪',
            kind: 'family',
            binding: 'family_xiaoxue',
            confidence: 'high',
          },
        ],
        focusRefs: ['o1', 'o2'],
        ambiguousMentions: [],
      },
    });

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factKey: 'family.shared_member.xiaoyu.age',
          subjectRef: 'family_xiaoyu',
        }),
        expect.objectContaining({
          factKey: 'family.shared_member.xiaoxue.age',
          subjectRef: 'family_xiaoxue',
        }),
      ])
    );
  });

  it('scopes memory candidates to the current request instead of old topics', () => {
    const service = new AgentContextService();
    const candidates = (
      service as unknown as {
        buildMemoryPlanCandidates: (
          facts: Array<{
            key: string;
            value: string;
            priority: number;
          }>,
          currentQuery: string,
          recentMessages: MessageEntity[]
        ) => Array<{ key: string }>;
      }
    ).buildMemoryPlanCandidates(
      [
        {
          key: 'relationship.agent_calls_user',
          value: '用户希望当前角色称呼用户为安安',
          priority: 3,
        },
        {
          key: 'relationship.forbidden_user_address.乖乖',
          value: '用户不希望当前角色称呼用户为乖乖',
          priority: 3,
        },
        {
          key: 'ritual.date.清明',
          value: '清明去老地方纪念',
          priority: 3,
        },
        {
          key: 'user.preference.food_update',
          value: '用户当前喜欢温牛奶',
          priority: 3,
        },
      ],
      '还是按后来定的称呼叫我，禁用的别碰。',
      [
        {
          role: MessageRole.user,
          type: MessageType.text,
          content: '清明那天我会去老地方，也想喝温牛奶。',
        } as MessageEntity,
      ]
    );

    expect(candidates.map(candidate => candidate.key)).toEqual([
      'relationship.agent_calls_user',
      'relationship.forbidden_user_address.乖乖',
    ]);
  });

  it('supplements multi-domain candidates when noisy wording hides a slot', () => {
    const service = new AgentContextService();
    const facts = [
      ['family.boundary.household', '用户要求家事先听，不劝和'],
      ['family.address_update.儿子', '用户现在称呼儿子为小乐'],
      ['family.son', '用户和当前角色有儿子'],
      ['family.father.name', '用户的爸爸叫建国'],
      ['style.update.facts', '事实问题直接回答'],
      ['style.mode.anger', '用户生气时不要顶嘴'],
      ['style.segment.reply', '先回应事情再安慰'],
      ['style.preference.metaphor', '用户不喜欢太多比喻'],
      ['correction.hard_fact.birthday', '用户纠正硬事实：生日是六月初三'],
      ['correction.response_style.once', '用户纠错时不希望连续道歉'],
      ['user.preference.food_update', '用户当前喜欢温牛奶'],
    ].map(([key, value]) => ({
      key,
      value,
      priority: 3,
    }));
    const candidates = (
      service as unknown as {
        buildMemoryPlanCandidates: (
          candidateFacts: typeof facts,
          currentQuery: string,
          recentMessages: MessageEntity[]
        ) => Array<{ key: string }>;
      }
    ).buildMemoryPlanCandidates(
      facts,
      '家里那位现在怎莫叫，矛盾时怎么陪，还有我纠证过的事实，都按最新版。',
      []
    );

    expect(candidates).toHaveLength(10);
    expect(candidates.map(candidate => candidate.key)).toEqual(
      expect.arrayContaining([
        'family.boundary.household',
        'family.address_update.儿子',
        'correction.hard_fact.birthday',
        'correction.response_style.once',
      ])
    );
  });

  it('uses high-relevance candidates as a low-context coverage fallback only', () => {
    const service = new AgentContextService();
    const currentQuery = '照后来定的称呼叫我，禁掉的那个别碰。';
    const facts = [
      {
        key: 'relationship.agent_calls_user',
        value: '用户希望当前角色称呼用户为安安',
        priority: 3,
      },
      {
        key: 'relationship.forbidden_user_address.乖乖',
        value: '用户不希望当前角色称呼用户为乖乖',
        priority: 3,
      },
    ];
    const candidates = [
      {
        key: facts[0].key,
        slot: 'address.current',
        summary: facts[0].value,
      },
      {
        key: facts[1].key,
        slot: 'address.forbidden',
        summary: facts[1].value,
      },
    ];
    const completeIntent = {
      intents: [],
      emotion: 'neutral',
      riskLevel: 'none',
      confidence: 0.9,
      source: 'semantic_model',
      memoryPlan: {
        need: 'none',
        contextCoverage: 'complete',
        missingConcepts: [],
        queries: [],
      },
    };
    const reconcile = (
      service as unknown as {
        reconcileMemoryPlanCoverage: (
          intent: typeof completeIntent,
          memoryCandidates: typeof candidates,
          candidateFacts: typeof facts,
          query: string,
          recentMessages: MessageEntity[]
        ) => typeof completeIntent;
      }
    ).reconcileMemoryPlanCoverage.bind(service);
    const currentMessage = {
      role: MessageRole.user,
      type: MessageType.text,
      content: currentQuery,
    } as MessageEntity;

    expect(
      reconcile(completeIntent, candidates, facts, currentQuery, [
        currentMessage,
      ]).memoryPlan
    ).toMatchObject({
      need: 'retrieve',
      contextCoverage: 'missing',
      missingConcepts: ['address.current', 'address.forbidden'],
    });
    expect(
      reconcile(completeIntent, candidates, facts, currentQuery, [
        {
          role: MessageRole.user,
          type: MessageType.text,
          content: '以后叫我安安，不要叫乖乖。',
        } as MessageEntity,
        currentMessage,
      ])
    ).toBe(completeIntent);
  });

  it('recovers an omitted memory plan only when recent context covers every candidate', () => {
    const service = new AgentContextService();
    const currentQuery =
      '按刚才上下文里的称呼新版、禁称和使用方式回我，这几项都在眼前。';
    const facts = [
      {
        key: 'relationship.agent_calls_user',
        value: '用户希望当前角色称呼用户为阿舟',
        priority: 3,
      },
      {
        key: 'relationship.forbidden_user_address.丫头',
        value: '用户不希望当前角色称呼用户为丫头',
        priority: 3,
      },
      {
        key: 'relationship.address_usage_style',
        value: '用户对称呼使用方式的偏好：别一开头就叫我，先接我的话',
        priority: 3,
      },
    ];
    const candidates = [
      {
        key: facts[0].key,
        slot: 'address.current',
        summary: facts[0].value,
      },
      {
        key: facts[1].key,
        slot: 'address.forbidden',
        summary: facts[1].value,
      },
      {
        key: facts[2].key,
        slot: 'address.usage',
        summary: facts[2].value,
      },
    ];
    const planlessIntent = {
      intents: [],
      emotion: 'neutral',
      riskLevel: 'none',
      confidence: 0.9,
      source: 'semantic_model',
    } as StructuredReplyIntent;
    const reconcile = (
      service as unknown as {
        reconcileMemoryPlanCoverage: (
          intent: StructuredReplyIntent,
          memoryCandidates: typeof candidates,
          candidateFacts: typeof facts,
          query: string,
          recentMessages: MessageEntity[]
        ) => StructuredReplyIntent;
      }
    ).reconcileMemoryPlanCoverage.bind(service);
    const currentMessage = {
      role: MessageRole.user,
      type: MessageType.text,
      content: currentQuery,
    } as MessageEntity;

    expect(
      reconcile(planlessIntent, candidates, facts, currentQuery, [
        {
          role: MessageRole.user,
          type: MessageType.text,
          content: '以后叫我阿舟吧。',
        } as MessageEntity,
        {
          role: MessageRole.user,
          type: MessageType.text,
          content: '别叫我丫头，我听着难受。',
        } as MessageEntity,
        {
          role: MessageRole.user,
          type: MessageType.text,
          content: '别一开头就叫我，先接我的话。',
        } as MessageEntity,
        currentMessage,
      ]).memoryPlan
    ).toEqual({
      need: 'none',
      contextCoverage: 'complete',
      missingConcepts: [],
      queries: [],
    });

    expect(
      reconcile(planlessIntent, candidates, facts, currentQuery, [
        {
          role: MessageRole.user,
          type: MessageType.text,
          content: '以后叫我阿舟吧。',
        } as MessageEntity,
        currentMessage,
      ])
    ).toBe(planlessIntent);
  });

  it('builds system prompt as a plain string for chat completions', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([
        {
          content: '记得用户说过最近睡得晚',
          role: MessageRole.user,
          createdAt: '2026-05-30',
        },
        {
          content: '用户最爱吃红烧鲫鱼',
          role: MessageRole.assistant,
          createdAt: '2026-05-29',
        },
      ]),
    } as never;
    service.agentMemoryFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          value: '用户是女生',
          priority: 3,
        },
        {
          value: '用户不爱吃辣，禁止说用户爱吃辣',
          priority: 3,
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');
    conversation.continuitySummary = '用户此前主要聊到最近睡得晚。';

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '现在几点了',
    });

    const systemMessage = context.messages[0];

    expect(systemMessage.role).toBe('system');
    expect(typeof systemMessage.content).toBe('string');
    expect(systemMessage.content).toContain('# 感知背景');
    expect(systemMessage.content).toContain('每项只写可直接发送的中文正文');
    expect(String(systemMessage.content).match(/# 输出合同/g)).toHaveLength(1);
    expect(systemMessage.content).not.toContain('# 工具');
    expect(systemMessage.content).toContain('# 当前对话参考模式：boundary');
    expect(systemMessage.content).toContain('本轮证据包');
    expect(systemMessage.content).toContain('对话连续性摘要');
    expect(systemMessage.content).toContain('摘要只用于理解此前聊到哪里');
    expect(systemMessage.content).toContain('用户是女生');
    expect(systemMessage.content).toContain('用户不爱吃辣，禁止说用户爱吃辣');
    expect(systemMessage.content).toContain('[L1|长期|conversation|回忆]');
    expect(systemMessage.content).not.toContain('用户最爱吃红烧鲫鱼');
    expect(context.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'confirmed_fact',
          text: '用户是女生',
          assertionPolicy: 'can_assert',
        }),
        expect.objectContaining({
          source: 'retrieved_user',
          text: '记得用户说过最近睡得晚',
        }),
      ])
    );
    expect(context.diagnostics).toEqual(
      expect.objectContaining({
        promptVersion: 'agent_chat_v11',
        outputContractVersion: 'reply_envelope_v1',
        boundaryContractVersion: 'reply_boundary_v1',
        toolInstructionMode: 'orchestrated_none',
        chatToolVersion: 'agent_chat_tools_v1',
        chatToolMode: 'off',
        evidenceVersion: 'evidence_atom_v1',
        identityVersion: 'agent_identity_v1',
        knownObjectCount: 2,
        historyMessageCount: 0,
        relevantMemoryCount: 3,
      })
    );
    expect(
      service.agentMemoryFactService.listFactsForPrompt
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 48,
      })
    );
  });

  it('lets a sampled active turn replace planner memory prefetch', async () => {
    const service = new AgentContextService();
    const retrieveConversationMemories = jest.fn().mockResolvedValue([]);
    service.chatToolConfig = {
      mode: 'active',
      activeSampleRate: 1,
      maxCallsPerTurn: 4,
      timeoutMs: 2500,
    };
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = { retrieveConversationMemories } as never;
    service.agentMemoryFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');
    const agent = new AgentEntity();
    agent.id = conversation.agentId;
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '你还记得以前带我去过哪里吗',
      currentTurnMessageIds: ['665000000000000000000099'],
    });

    expect(context.chatToolPlan.mode).toBe('active');
    expect(context.diagnostics).toEqual(
      expect.objectContaining({
        chatToolPlannerMemoryRequested: true,
        chatToolPlannerRetrievalBypassed: true,
        memoryRetrievalMode: 'tool_takeover',
        memoryRetrievalRequestCount: 0,
      })
    );
    expect(retrieveConversationMemories).not.toHaveBeenCalled();
  });

  it('places a merged consecutive-input turn after the latest assistant reply', async () => {
    const previousUser = new MessageEntity();
    previousUser.id = new MongoObjectId();
    previousUser.role = MessageRole.user;
    previousUser.type = MessageType.text;
    previousUser.content = '我最近工作有点累';
    previousUser.status = MessageStatus.sent;
    previousUser.createdAt = new Date('2026-07-31T03:53:07.000Z');

    const firstCurrent = new MessageEntity();
    firstCurrent.id = new MongoObjectId();
    firstCurrent.role = MessageRole.user;
    firstCurrent.type = MessageType.text;
    firstCurrent.content = '先不说工作了';
    firstCurrent.status = MessageStatus.sent;
    firstCurrent.createdAt = new Date('2026-07-31T03:53:13.000Z');

    const secondCurrent = new MessageEntity();
    secondCurrent.id = new MongoObjectId();
    secondCurrent.role = MessageRole.user;
    secondCurrent.type = MessageType.text;
    secondCurrent.content = '爸，你吃饭了吗';
    secondCurrent.status = MessageStatus.sent;
    secondCurrent.createdAt = new Date('2026-07-31T03:53:17.000Z');

    const assistantReply = new MessageEntity();
    assistantReply.id = new MongoObjectId();
    assistantReply.role = MessageRole.assistant;
    assistantReply.type = MessageType.text;
    assistantReply.content = '工作慢慢来，别太累';
    assistantReply.status = MessageStatus.sent;
    assistantReply.createdAt = new Date('2026-07-31T03:53:19.000Z');

    const service = new AgentContextService();
    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([
          previousUser,
          firstCurrent,
          secondCurrent,
          assistantReply,
        ]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;
    service.replyIntentClassifierService = {
      getPlanningDecision: jest
        .fn()
        .mockReturnValue({ mode: 'semantic', reason: 'forced' }),
      classify: jest.fn().mockResolvedValue(undefined),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');
    const currentQuery =
      '用户连续输入（按发送顺序，共2条）：\n1. 先不说工作了\n2. 爸，你吃饭了吗';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery,
      currentTurnMessageIds: [
        firstCurrent.id.toHexString(),
        secondCurrent.id.toHexString(),
      ],
      forceSemanticPlanning: true,
    });

    expect(context.layers[1].messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: previousUser.content,
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining(assistantReply.content),
      }),
      {
        role: 'user',
        content: currentQuery,
      },
    ]);
    expect(context.messages[0].content).toContain('# 连续输入理解');
    expect(context.messages[0].content).toContain(
      '后句改变核心意图时，以最新仍有效的核心意图为主'
    );
    expect(service.replyIntentClassifierService.classify).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery,
        recentMessages: [previousUser, assistantReply],
        forceSemanticPlanning: true,
      })
    );
  });

  it('keeps low-confidence image guesses question-first without user explanation', () => {
    const service = new AgentContextService();
    const prompt = (
      service as unknown as {
        buildConversationReadingPrompt: (
          replyBrief: undefined,
          currentQuery: string
        ) => string;
      }
    ).buildConversationReadingPrompt(
      undefined,
      [
        '用户发送了一张图片：',
        '画面：照片里有一位中年男性站在门口',
        '身份推测（非事实）：P1也许是家人爸爸，依据：年龄阶段和当前称呼',
      ].join('\n')
    );

    expect(prompt).toContain('# 图片消息策略');
    expect(prompt).toContain('低置信“也许是”只是试探线索');
    expect(prompt).toContain('以试探性确认和提问为主');
    expect(prompt).toContain('不要直接把人物关系说定');
  });

  it('uses user relation explanation after a low-confidence image guess', () => {
    const service = new AgentContextService();
    const prompt = (
      service as unknown as {
        buildConversationReadingPrompt: (
          replyBrief: undefined,
          currentQuery: string
        ) => string;
      }
    ).buildConversationReadingPrompt(
      undefined,
      [
        '用户连续输入（按发送顺序，共2条）：',
        '1. 用户发送了一张图片：',
        '画面：一张老照片里有位年长男性',
        '身份推测（非事实）：P1也许是当前角色爷爷',
        '2. 这是爷爷年轻时候',
      ].join('\n')
    );

    expect(prompt).toContain('# 图片消息策略');
    expect(prompt).toContain('以用户说明为准自然承接');
    expect(prompt).not.toContain('用户本轮没有补充关系说明');
  });

  it('uses profile-source facts from memory instead of raw profile paragraphs', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentProfileFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          type: 'preference',
          key: 'profile_source.hobbies',
          value: '当前角色兴趣爱好：下象棋',
          polarity: 'positive',
          confidence: 'confirmed',
          priority: 2,
          assertionPolicy: 'can_assert',
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');
    const agent = new AgentEntity();
    agent.id = conversation.agentId;
    agent.name = '爸爸';
    agent.iCallAgent = '爸爸';
    agent.lifeExperience = '原资料字段：年轻时在码头工作';
    agent.personalityTraits = '原资料字段：脾气很急';
    agent.languageHabits = '原资料字段：常说快一点';
    agent.hobbies = '原资料字段：喜欢钓鱼';
    agent.sharedMemories = '原资料字段：一起去过海边';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '爸，你以前有什么爱好',
    });

    const systemContent = String(context.messages[0].content);

    expect(systemContent).toContain('当前角色兴趣爱好：下象棋');
    expect(systemContent).not.toContain('原资料字段');
    expect(
      service.agentProfileFactService.listFactsForPrompt
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: conversation.userId,
        agentId: conversation.agentId,
      })
    );
  });

  it('marks a memory question as context-only evidence without injecting a reply plan', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '你还记得我小时候你带我钓鱼吗',
    });

    const systemMessage = context.messages[0];

    expect(context.replyBrief.mode).toBe('memory');
    expect(context.replyBrief.strictGrounding).toBe(true);
    expect(context.replyBrief.factClaimMode).toBe('grounded');
    expect(systemMessage.content).toContain('本轮证据包');
    expect(systemMessage.content).toContain('# 当前对话参考模式：memory');
    expect(systemMessage.content).toContain('沿用户已说片段回应感受和意义');
    expect(systemMessage.content).not.toContain('不足就说记不清');
    expect(systemMessage.content).toContain(
      '[U0|本轮|mixed|待确认] 你还记得我小时候你带我钓鱼吗'
    );
    expect(systemMessage.content).toContain('问句不能证明其假设');
    expect(systemMessage.content).toContain(
      '证据只约束具体事实，不限制称呼、关系立场、愿望和共情'
    );
    expect(systemMessage.content).toContain('邀请用户多说那位亲人或那件事');
    expect(systemMessage.content).toContain('# 输出合同');
    expect(systemMessage.content).toContain('"claims"');
    expect(systemMessage.content).toContain('证据没有的细节不写');
    const userEvidence = context.evidence.find(e => e.id === 'U0');
    expect(userEvidence).toEqual(
      expect.objectContaining({
        assertionPolicy: 'context_only',
      })
    );
    expect(systemMessage.content).not.toContain('本轮命中的回复策略');
    expect(systemMessage.content).not.toContain('本轮唯一回复简报');
    expect(systemMessage.content).not.toContain('主场景：');
  });

  it('injects taboo memory facts as context-only evidence', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentMemoryFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          type: 'preference',
          key: 'taboo.no_live_for_agent',
          value: '用户不喜欢被要求替当前角色好好活或替当前角色承担照顾责任',
          polarity: 'negative',
          priority: 3,
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '爸，我最近真的好累',
    });

    expect(context.evidence).toContainEqual(
      expect.objectContaining({
        source: 'confirmed_fact',
        text: '用户不喜欢被要求替当前角色好好活或替当前角色承担照顾责任',
        assertionPolicy: 'context_only',
      })
    );
    expect(context.messages[0].content).toContain(
      '[F1|确认|user|回忆] 用户不喜欢被要求替当前角色好好活'
    );
  });

  it('uses structured semantic planning without duplicating legacy reply moves', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;
    service.replyIntentClassifierService = {
      classify: jest.fn().mockResolvedValue({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.95,
          },
          {
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.88,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.93,
        source: 'semantic_model',
        reading: {
          primaryNeed: '想确认爸爸现在是否还受疼，也想回应这份想念',
          emotionalSource: '担心爸爸还在受疼',
          anchors: [
            {
              text: '身子可还遭罪',
              importance: 'high',
              reason: '用户正在询问当前身体状态',
            },
            {
              text: '我真想你',
              importance: 'high',
              reason: '用户直接表达想念',
            },
          ],
          corrections: [],
          negations: [],
          questionsToAnswer: ['身子可还遭罪'],
          relationshipSignal: '关心并表达想念',
          uncertainties: ['当前真实身体状态'],
          suggestedTone: '直接、安稳、亲近',
        },
        conversationPlan: {
          stance: 'tender',
          stanceTarget: '用户担心爸爸现在还受疼',
          moves: [
            {
              type: 'answer',
              goal: '先直接回应现在是否还受疼',
            },
            {
              type: 'comfort',
              goal: '接住用户的想念',
            },
          ],
          socialStrategy: 'direct',
          strategyPurpose: '用户仍在等待当前状态的直接回答',
          questionNeed: 'none',
          turnClosure: 'continue',
          personaActivation: ['父亲式安稳回应'],
          turnPlan: {
            state: 'deepening',
            open: [
              {
                object: 'user',
                need: 'direct_answer',
                detail: '用户仍在等待爸爸直接回答现在是否还受疼',
                priority: 'must',
              },
            ],
            goal: 'hold',
            action: 'answer',
            target: '先直接回答当前状态，再回应用户的想念',
            avoid: 'generic_comfort',
            close: 'blocked',
          },
          engagement: {
            userConversationState: 'deepening',
            openLoop: '用户仍在等待爸爸直接回答现在是否还受疼',
            continuationGoal: 'hold',
            assistantContribution: 'answer',
            mustContribute: '先直接回答当前状态，再回应用户的想念',
            avoidRepeatingMove: '泛泛安慰',
            closureReadiness: 'blocked',
          },
        },
        memoryPlan: {
          need: 'retrieve',
          contextCoverage: 'missing',
          missingConcepts: ['用户此前提到的父亲疼痛记忆'],
          queries: [
            {
              question: '用户此前提到过哪些与父亲疼痛相关的记忆？',
              expectedUse: 'apply',
              importance: 'supporting',
              entityHint: '父亲身体',
            },
          ],
        },
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '爸，身子可还遭罪？我真想你',
    });

    const systemMessage = context.messages[0];

    expect(context.replyRoute.routingSource).toBe('semantic');
    expect(context.replyRoute.primaryScene?.scene).toBe('afterlife_status');
    expect(context.replyRoute.secondaryScenes[0]?.scene).toBe('miss_longing');
    expect(context.replyIntent?.intents).toHaveLength(2);
    expect(context.replyBrief.mode).toBe('status');
    expect(context.replyBrief.replyMoves).toEqual([
      '自然回答当前角色状态',
      '直接回应想念或团聚愿望',
    ]);
    expect(systemMessage.content).toContain('# 当前对话参考模式：status');
    expect(systemMessage.content).toContain('# 本轮回复任务');
    expect(systemMessage.content).toContain(
      '行动：answer:先直接回应现在是否还受疼；comfort:接住用户的想念'
    );
    expect(systemMessage.content).not.toContain('自然回答当前角色状态');
    expect(systemMessage.content).not.toContain('直接回应想念或团聚愿望');
    expect(systemMessage.content).toContain('气泡语义规划');
    expect(systemMessage.content).toContain('本轮需要两颗气泡');
    expect(systemMessage.content).toContain('以上为内部约束；自然表达');
    expect(systemMessage.content).not.toContain('本轮结构化意图');
    expect(systemMessage.content).toContain('# 本轮 Conversation Reading');
    expect(systemMessage.content).toContain('身子可还遭罪');
    expect(systemMessage.content).toContain('我真想你');
    expect(systemMessage.content).toContain('须答');
    expect(systemMessage.content).toContain(
      '本轮：在深入；未完：用户必须“用户仍在等待爸爸直接回答现在是否还受疼”'
    );
    expect(systemMessage.content).toContain(
      '接住/直接回答“先直接回答当前状态，再回应用户的想念”'
    );
    expect(systemMessage.content).not.toContain('续聊：deepening/hold');
    expect(systemMessage.content).not.toContain('须贡献：answer:');
    expect(systemMessage.content).toContain('开放点未解决');
    expect(context.diagnostics.conversationReadingAnchorCount).toBe(2);
    expect(context.diagnostics).toEqual(
      expect.objectContaining({
        userConversationState: 'deepening',
        openLoop: '用户仍在等待爸爸直接回答现在是否还受疼',
        continuationGoal: 'hold',
        assistantContribution: 'answer',
        mustContribute: '先直接回答当前状态，再回应用户的想念',
        avoidRepeatingMove: '泛泛安慰',
        closureReadiness: 'blocked',
        turnPlanVersion: 'turn_plan_v1',
        turnPlanOpenPointCount: 1,
        turnPlanOpenNeeds: ['direct_answer'],
        turnPlanAvoid: 'generic_comfort',
      })
    );
    expect(context.diagnostics.memoryPlan).toEqual({
      need: 'retrieve',
      contextCoverage: 'missing',
      missingConcepts: ['用户此前提到的父亲疼痛记忆'],
      queries: [
        {
          question: '用户此前提到过哪些与父亲疼痛相关的记忆？',
          expectedUse: 'apply',
          importance: 'supporting',
          entityHint: '父亲身体',
        },
      ],
    });
    expect(
      service.retrieveService.retrieveConversationMemories
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        query: [
          '用户此前提到的父亲疼痛记忆',
          '用户此前提到过哪些与父亲疼痛相关的记忆？',
          '父亲身体',
        ].join('\n'),
      })
    );
    expect(context.diagnostics).toEqual(
      expect.objectContaining({
        memoryRetrievalMode: 'memory_plan',
        memoryRetrievalRequestCount: 1,
        memoryRetrievalConceptCount: 1,
      })
    );
    expect(systemMessage.content).not.toContain(
      '用户此前提到过哪些与父亲疼痛相关的记忆'
    );
  });

  it('uses missing concepts to retrieve and rank long-term facts when plan queries are empty', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentMemoryFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          type: 'relationship',
          key: 'relationship.agent_calls_user',
          value: '用户希望当前角色称呼用户为安安',
          priority: 3,
        },
        {
          type: 'relationship',
          key: 'relationship.forbidden_user_address.乖乖',
          value: '用户不希望当前角色称呼用户为乖乖',
          priority: 3,
        },
        {
          type: 'relationship',
          key: 'relationship.address_usage_style',
          value: '用户希望称呼自然放在句子里',
          priority: 2,
        },
        {
          type: 'preference',
          key: 'user.preference.food_update',
          value: '用户当前喜欢温牛奶',
          priority: 3,
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;
    service.replyIntentClassifierService = {
      classify: jest.fn().mockResolvedValue({
        intents: [],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.9,
        source: 'semantic_model',
        memoryPlan: {
          need: 'retrieve',
          contextCoverage: 'missing',
          missingConcepts: ['用户当前有效称呼', '禁用称呼', '称呼使用方式'],
          selectedFactKeys: ['relationship.agent_calls_user'],
          queries: [],
        },
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '就按后来定的方式叫我。',
    });

    expect(
      service.retrieveService.retrieveConversationMemories
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        query: [
          '用户当前有效称呼',
          '禁用称呼',
          '称呼使用方式',
          'relationship.agent_calls_user',
          'relationship.forbidden_user_address.乖乖',
          'relationship.address_usage_style',
        ].join('\n'),
      })
    );
    expect(context.diagnostics.relevantHardFactKeys).toEqual([
      'relationship.agent_calls_user',
      'relationship.forbidden_user_address.乖乖',
      'relationship.address_usage_style',
    ]);
    expect(service.replyIntentClassifierService.classify).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryCandidates: [
          expect.objectContaining({
            key: 'relationship.agent_calls_user',
          }),
          expect.objectContaining({
            key: 'relationship.forbidden_user_address.乖乖',
          }),
          expect.objectContaining({
            key: 'relationship.address_usage_style',
          }),
        ],
      })
    );
    expect(context.diagnostics).toEqual(
      expect.objectContaining({
        memoryCandidateCount: 3,
        memoryCandidateKeys: [
          'relationship.agent_calls_user',
          'relationship.forbidden_user_address.乖乖',
          'relationship.address_usage_style',
        ],
        memoryModelSelectedCandidateKeys: ['relationship.agent_calls_user'],
        memorySelectedCandidateKeys: [
          'relationship.agent_calls_user',
          'relationship.forbidden_user_address.乖乖',
          'relationship.address_usage_style',
        ],
        memoryRetrievalMode: 'memory_plan',
        memoryRetrievalRequestCount: 1,
        memoryRetrievalConceptCount: 3,
      })
    );
  });

  it('suppresses long-term retrieval when the memory plan says recent context is complete', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentMemoryFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          type: 'relationship',
          key: 'relationship.agent_calls_user',
          value: '用户希望当前角色称呼用户为安安',
          priority: 3,
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue(null),
    } as never;
    service.replyIntentClassifierService = {
      classify: jest.fn().mockResolvedValue({
        intents: [],
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.9,
        source: 'semantic_model',
        memoryPlan: {
          need: 'none',
          contextCoverage: 'complete',
          missingConcepts: [],
          queries: [],
        },
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '前面说得很清楚了，直接照着回。',
    });

    expect(
      service.retrieveService.retrieveConversationMemories
    ).not.toHaveBeenCalled();
    expect(service.replyIntentClassifierService.classify).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryCandidates: [],
      })
    );
    expect(context.diagnostics).toEqual(
      expect.objectContaining({
        relevantMemoryCount: 1,
        relevantHardFactKeys: ['relationship.agent_calls_user'],
        memoryCandidateCount: 0,
        memoryCandidateKeys: [],
        memorySelectedCandidateKeys: [],
        memoryRetrievalMode: 'suppressed',
        memoryRetrievalRequestCount: 0,
        memoryRetrievalConceptCount: 0,
      })
    );
  });

  it('does not query long-term memory on the ordinary direct path', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.replyIntentClassifierService = {
      getPlanningDecision: jest.fn().mockReturnValue({
        mode: 'direct',
        reason: 'ordinary_message',
      }),
      classify: jest.fn().mockResolvedValue(undefined),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '晚安妈妈',
    });

    expect(
      service.retrieveService.retrieveConversationMemories
    ).not.toHaveBeenCalled();
    expect(context.diagnostics).toEqual(
      expect.objectContaining({
        replyPlanningMode: 'direct',
        replyPlanningReason: 'ordinary_message',
        replyIntentModelCallCount: 0,
        strategyVersion: 'conversation_strategy_v8',
        strategySource: 'deterministic_light',
        conversationMoveGoals: expect.any(Array),
        conversationTurnClosure: expect.any(String),
        memoryRetrievalMode: 'suppressed',
        memoryRetrievalRequestCount: 0,
      })
    );
    expect(context.diagnostics.conversationMoveGoals.length).toBeGreaterThan(0);
    expect(context.messages[0].content).toContain('体验：P0/R0/D0');
  });

  it('does not let a stale high-risk state override a new neutral message', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue({
        primaryEmotion: ConversationEmotionPrimary.crisisRisk,
        riskLevel: ConversationEmotionRiskLevel.high,
        signals: ['crisis_risk.high'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '嗯',
    });

    const systemMessage = context.messages[0];

    expect(systemMessage.content).not.toContain('风险等级：高');
    expect(systemMessage.content).toContain('# 当前对话参考模式：emotional');
    expect(systemMessage.content).toContain('仅作弱参考');
    expect(context.replyRoute.primaryScene?.scene).toBe('comfort_request');
  });

  it('treats legacy high-risk state as strong distress conversation context', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue({
        primaryEmotion: ConversationEmotionPrimary.crisisRisk,
        riskLevel: ConversationEmotionRiskLevel.high,
        signals: ['crisis_risk.high'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '我不想活了，我想去陪你',
    });
    const systemMessage = context.messages[0];

    expect(systemMessage.content).toContain('感知背景');
    expect(systemMessage.content).toContain('强烈痛苦');
    expect(systemMessage.content).not.toContain('当前用户情绪状态');
    expect(context.replyBrief.mode).toBe('emotional');
    expect(systemMessage.content).toContain('# 当前对话参考模式：emotional');
    expect(systemMessage.content).toContain('用户：强烈痛苦');
    expect(systemMessage.content).not.toContain('# 当前时间参考');
    expect(systemMessage.content).not.toContain('北京时间');
    expect(systemMessage.content).not.toContain('风险等级：高');
    expect(systemMessage.content).not.toContain('本轮唯一回复简报');
  });

  it('uses confirmed shared family members for scene routing', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentProfileFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          type: 'family',
          key: 'family.shared_member.大宝',
          value:
            '大宝是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测',
          priority: 3,
        },
      ]),
    } as never;
    service.agentEmotionStateService = {
      getCurrentState: jest.fn().mockResolvedValue({
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing', 'grief.sadness'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      }),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '大宝想你想得哭了',
    });
    const systemMessage = context.messages[0];

    expect(systemMessage.content).toContain(
      '大宝是用户与当前角色共同的重要家人'
    );
    expect(context.replyBrief.mode).toBe('family');
    expect(systemMessage.content).toContain('# 当前对话参考模式：family');
    expect(systemMessage.content).toContain('仅作弱参考');
    expect(context.replyBrief.replyMoves).toEqual([
      '回应家人的当前处境',
      '表达牵挂，但不给用户追加责任',
    ]);
    expect(systemMessage.content).not.toContain('主场景：');
  });

  it('does not include legacy media url assistant messages in chat history', async () => {
    const service = new AgentContextService();
    const badAssistantMessage = new MessageEntity();
    Object.assign(badAssistantMessage, {
      id: new MongoObjectId('665000000000000000000031'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content:
        'https://zk.yaoxuankeji.club:8199/images/aiDeceased/b9a71d6a9e144fbca8d99ba89a6ec036.mp3 1',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:00:00.000Z'),
      updatedAt: new Date('2026-05-30T08:00:00.000Z'),
    });
    const goodAssistantMessage = new MessageEntity();
    Object.assign(goodAssistantMessage, {
      id: new MongoObjectId('665000000000000000000032'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content:
        '【历史助手回复，仅供理解对话顺序和语气，不是事实来源；其中具体回忆、菜名、地点、动作必须有用户原话或角色资料确认才可使用】早安媳妇儿',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:01:00.000Z'),
      updatedAt: new Date('2026-05-30T08:01:00.000Z'),
    });
    const spatialOverclaimMessage = new MessageEntity();
    Object.assign(spatialOverclaimMessage, {
      id: new MongoObjectId('665000000000000000000033'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '爸爸一直在天上看着你，你的事我都看在眼里。',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:02:00.000Z'),
      updatedAt: new Date('2026-05-30T08:02:00.000Z'),
    });
    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([
          badAssistantMessage,
          goodAssistantMessage,
          spatialOverclaimMessage,
        ]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '早安',
    });

    expect(context.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('早安媳妇儿'),
        }),
      ])
    );
    const assistantHistoryMessage = context.messages.find(
      message => message.role === 'assistant'
    );
    expect(assistantHistoryMessage?.content).not.toContain('历史助手回复');
    expect(assistantHistoryMessage?.content).not.toContain('不是事实来源');
    expect(JSON.stringify(context.messages)).not.toContain('aiDeceased');
    expect(JSON.stringify(context.messages)).not.toContain(
      'zk.yaoxuankeji.club'
    );
    expect(JSON.stringify(context.messages)).not.toContain('在天上看着你');
    expect(JSON.stringify(context.messages)).not.toContain('看在眼里');
  });

  it('does not include assistant image messages or let them crowd recent chat history', async () => {
    const service = new AgentContextService();
    const textAssistantMessage = new MessageEntity();
    Object.assign(textAssistantMessage, {
      id: new MongoObjectId('665000000000000000000051'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '这是真正的聊天内容',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:04:00.000Z'),
      updatedAt: new Date('2026-05-30T08:04:00.000Z'),
    });
    const assistantImageMessages = Array.from({ length: 12 }, (_, index) => {
      const message = new MessageEntity();
      Object.assign(message, {
        id: new MongoObjectId(
          `6650000000000000000000${String(52 + index).padStart(2, '0')}`
        ),
        conversationId: new MongoObjectId('665000000000000000000020'),
        userId: new MongoObjectId('665000000000000000000001'),
        agentId: new MongoObjectId('665000000000000000000010'),
        role: MessageRole.assistant,
        type: MessageType.image,
        content: 'AI生成纪念合照',
        mediaAnalysis: 'AI生成纪念合照',
        mediaObjectKey: `memorial-photos/generated-${index}.png`,
        status: MessageStatus.sent,
        createdAt: new Date(
          `2026-05-30T08:${String(5 + index).padStart(2, '0')}:00.000Z`
        ),
        updatedAt: new Date(
          `2026-05-30T08:${String(5 + index).padStart(2, '0')}:00.000Z`
        ),
      });
      return message;
    });

    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([textAssistantMessage, ...assistantImageMessages]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '方方';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '继续说',
    });

    const serializedMessages = JSON.stringify(context.messages);
    expect(serializedMessages).toContain('这是真正的聊天内容');
    expect(serializedMessages).not.toContain('AI生成纪念合照');
    expect(serializedMessages).not.toContain('memorial-photos');
  });

  it('allows memory-grounded image identity guesses without presenting them as facts', () => {
    const service = new AgentContextService();
    const message = new MessageEntity();
    Object.assign(message, {
      role: MessageRole.user,
      type: MessageType.image,
      content: '[图片]',
      mediaAnalysis:
        '画面：一位戴眼镜的老人坐在窗边\n身份推测（非事实）：P1可能是当前角色奶奶',
    });

    const built = (service as any).buildImageChatMessage(message);

    expect(built.content).toContain('亲人聊天里的记忆材料');
    expect(built.content).toContain('当前角色口吻接住图片本身');
    expect(built.content).toContain('只有图片理解明确写出“身份推测”');
    expect(built.content).toContain('不能说成确定事实');
    expect(built.content).toContain('“也许是”视为低置信');
    expect(built.content).toContain('以试探性确认和提问为主');
    expect(built.content).toContain('不要直接把人物关系说定');
    expect(built.content).toContain('直接问这是谁');
    expect(built.content).toContain('不得补编闺女、儿子、爸妈');
    expect(built.content).toContain('不要说成识别失败');
    expect(built.content).not.toContain('不要猜测图片中的人是谁');
  });

  it('does not include archived messages in recent chat history', async () => {
    const service = new AgentContextService();
    const archivedAssistantMessage = new MessageEntity();
    Object.assign(archivedAssistantMessage, {
      id: new MongoObjectId('665000000000000000000041'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '傻孩子 爸也想你',
      status: MessageStatus.sent,
      isArchived: true,
      archivedAt: new Date('2026-05-30T08:02:00.000Z'),
      createdAt: new Date('2026-05-30T08:02:00.000Z'),
      updatedAt: new Date('2026-05-30T08:02:00.000Z'),
    });
    const activeAssistantMessage = new MessageEntity();
    Object.assign(activeAssistantMessage, {
      id: new MongoObjectId('665000000000000000000042'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '我也想你',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:03:00.000Z'),
      updatedAt: new Date('2026-05-30T08:03:00.000Z'),
    });
    service.messageModel = {
      find: jest
        .fn()
        .mockResolvedValue([archivedAssistantMessage, activeAssistantMessage]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '方方';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '我很想你',
    });

    const assistantHistoryMessages = context.messages.filter(
      message => message.role === 'assistant'
    );
    expect(JSON.stringify(assistantHistoryMessages)).toContain('我也想你');
    expect(JSON.stringify(assistantHistoryMessages)).not.toContain('爸也想你');
  });

  it('formats quoted user messages so the model understands the reference target', async () => {
    const service = new AgentContextService();
    const userMessage = new MessageEntity();
    Object.assign(userMessage, {
      id: new MongoObjectId('665000000000000000000061'),
      conversationId: new MongoObjectId('665000000000000000000020'),
      userId: new MongoObjectId('665000000000000000000001'),
      agentId: new MongoObjectId('665000000000000000000010'),
      role: MessageRole.user,
      type: MessageType.text,
      content: '我不爱吃辣',
      quotedMessageRole: MessageRole.assistant,
      quotedMessageContent: '你以前总爱吃辣',
      status: MessageStatus.sent,
      createdAt: new Date('2026-05-30T08:05:00.000Z'),
      updatedAt: new Date('2026-05-30T08:05:00.000Z'),
    });

    service.messageModel = {
      find: jest.fn().mockResolvedValue([userMessage]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = new MongoObjectId('665000000000000000000010');
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '我不爱吃辣',
      currentTurnMessageIds: [userMessage.id.toHexString()],
    });

    const historyMessage = context.messages.find(
      message => message.role === 'user'
    );

    expect(historyMessage?.content).toContain('用户本条消息使用了“引用”操作。');
    expect(historyMessage?.content).toContain('被引用的AI回复：你以前总爱吃辣');
    expect(historyMessage?.content).toContain(
      '用户本次要表达的内容：我不爱吃辣'
    );
    expect(historyMessage?.content).toContain(
      '不要把被引用内容当作用户本次新说的话'
    );
  });

  it('injects stored concern as relationship context for a pain query', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.replyIntentClassifierService = {
      classify: jest.fn().mockResolvedValue({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.99,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      }),
    } as never;
    const storedSignal = {
      key: 'concern.agent_physical_suffering',
      signalType: AgentRelationshipSignalType.concern,
      topic: AgentRelationshipSignalTopic.agentPhysicalSuffering,
      subject: AgentRelationshipSignalSubject.agent,
      confidence: 0.99,
      supportCount: 2,
      status: AgentRelationshipSignalStatus.active,
      assertionPolicy: AgentRelationshipSignalAssertionPolicy.userStateOnly,
      firstSeenAt: new Date('2026-07-27T08:00:00.000Z'),
      lastSeenAt: new Date('2026-07-28T08:00:00.000Z'),
    };
    service.agentRelationshipSignalService = {
      listSignals: jest.fn().mockResolvedValue([storedSignal]),
      selectRelevantSignals: jest.fn().mockReturnValue([storedSignal]),
    } as never;

    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const agent = new AgentEntity();
    agent.id = conversation.agentId;
    agent.name = '爸爸';

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent,
      currentQuery: '那你呢？现在身上还疼吗？',
    });

    expect(context.replyBrief.relationshipContext).toEqual([
      expect.objectContaining({
        key: 'concern.agent_physical_suffering',
        assertionPolicy: 'user_state_only',
      }),
    ]);
    expect(context.replyBrief.evidence).not.toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('多次表达'),
      })
    );
    expect(context.replyBrief.prompt).toContain('关系背景（不是主体事实）');
    expect(context.replyBrief.prompt).toContain(
      '不得据此推断疾病、伤口、病因或治疗经历'
    );
    expect(context.messages[0].content).not.toContain(
      '关系背景（不是主体事实）'
    );
    expect(context.messages[0].content).not.toContain(
      '不得据此推断疾病、伤口、病因或治疗经历'
    );
  });

  it('injects verified memory-control results instead of trusting model narration', async () => {
    const service = new AgentContextService();
    service.messageModel = {
      find: jest.fn().mockResolvedValue([]),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '请忘掉我不爱吃辣这件事',
      memoryControlResult: {
        action: 'forget',
        target: '我不爱吃辣',
        affectedCount: 2,
        succeeded: true,
      },
    });

    expect(context.replyBrief.mode).toBe('memory_control');
    expect(context.messages[0].content).toContain(
      '# 当前对话参考模式：memory_control'
    );
    expect(context.messages[0].content).toContain(
      '[S1|系统|system|可确认] 系统已归档与“我不爱吃辣”匹配的2条长期记忆'
    );
  });

  it('selects relevant facts and limits ordinary chat history by mode', async () => {
    const service = new AgentContextService();
    const messages = Array.from({ length: 10 }, (_, index) => {
      const message = new MessageEntity();
      Object.assign(message, {
        id: new MongoObjectId(
          `665000000000000000000${String(80 + index).padStart(3, '0')}`
        ),
        conversationId: new MongoObjectId('665000000000000000000020'),
        userId: new MongoObjectId('665000000000000000000001'),
        agentId: new MongoObjectId('665000000000000000000010'),
        role: index % 2 === 0 ? MessageRole.user : MessageRole.assistant,
        type: MessageType.text,
        content: `历史消息${index}`,
        status: MessageStatus.sent,
        createdAt: new Date(1_700_000_000_000 + index * 1000),
        updatedAt: new Date(1_700_000_000_000 + index * 1000),
      });
      return message;
    });
    service.messageModel = {
      find: jest.fn().mockResolvedValue(messages),
    } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentProfileFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([
        {
          key: 'preference.food',
          value: '用户喜欢清淡饮食',
          priority: 3,
        },
        {
          key: 'family.member',
          value: '用户有一个妹妹',
          priority: 3,
        },
        {
          key: 'hobby.music',
          value: '用户喜欢听老歌',
          priority: 3,
        },
        {
          key: 'occupation.work',
          value: '用户从事设计工作',
          priority: 3,
        },
        {
          key: 'focus.exam',
          value: '用户正在准备考研',
          priority: 1,
        },
      ]),
    } as never;
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId('665000000000000000000020');
    conversation.agentId = new MongoObjectId('665000000000000000000010');
    conversation.userId = new MongoObjectId('665000000000000000000001');

    const context = await service.buildConversationContext({
      auth: {
        sub: '665000000000000000000001',
        accountId: '665000000000000000000101',
        account: 'test-account',
        iat: 0,
        exp: 0,
        nonce: 'test-nonce',
      },
      conversation,
      agent: null,
      currentQuery: '我今天考研复习又学不进去了',
    });

    expect(context.replyBrief.mode).toBe('daily');
    expect(context.messages[0].content).toContain('用户正在准备考研');
    expect(context.diagnostics.historyMessageCount).toBe(10);
    expect(context.diagnostics.relevantMemoryCount).toBe(5);
  });

  it('ranks associated memory slots above unrelated high-priority facts', () => {
    const service = new AgentContextService();
    const facts = [
      {
        key: 'correction.no_fabrication',
        value: '用户不喜欢编造细节',
        priority: 3,
      },
      {
        key: 'relationship.agent_calls_user',
        value: '用户希望当前角色称呼用户为安安',
        priority: 3,
      },
      {
        key: 'relationship.forbidden_user_address.乖乖',
        value: '用户不希望当前角色称呼用户为乖乖',
        priority: 3,
      },
      {
        key: 'relationship.address_usage_style',
        value: '用户不希望每句都叫名字',
        priority: 2,
      },
      {
        key: 'user.preference.food_update',
        value: '用户当前更想喝温牛奶',
        priority: 3,
      },
    ];
    const selected = (
      service as unknown as {
        selectRelevantFacts: (
          items: typeof facts,
          query: string,
          limit: number
        ) => typeof facts;
      }
    ).selectRelevantFacts(facts, '你现在该怎么叫我，称呼上还要避开什么？', 3);

    expect(selected.map(fact => fact.key)).toEqual([
      'relationship.agent_calls_user',
      'relationship.forbidden_user_address.乖乖',
      'relationship.address_usage_style',
    ]);
  });

  it('preserves one fact for each independent memory retrieval query', () => {
    const service = new AgentContextService();
    const facts = [
      {
        key: 'relationship.agent_calls_user',
        value: '用户希望当前角色称呼用户为安安',
        priority: 3,
      },
      {
        key: 'family.boundary.家里的矛盾',
        value: '用户说家里有矛盾时先听，不要马上劝和',
        priority: 3,
      },
      {
        key: 'correction.response_style.不用反复道歉',
        value: '用户纠错时不希望当前角色反复道歉',
        priority: 3,
      },
      {
        key: 'relationship.forbidden_user_address.乖乖',
        value: '用户不希望当前角色称呼用户为乖乖',
        priority: 3,
      },
      {
        key: 'family.address_update.儿子',
        value: '用户现在习惯称呼儿子为小乐',
        priority: 3,
      },
      {
        key: 'correction.hard_fact.生日',
        value: '用户纠正当前角色生日是六月初三',
        priority: 3,
      },
      {
        key: 'style.preference.少用比喻',
        value: '用户不喜欢太多比喻',
        priority: 3,
      },
    ];
    const selected = (
      service as unknown as {
        selectRelevantFacts: (
          items: typeof facts,
          query: string,
          limit: number,
          retrievalPaths: string[]
        ) => typeof facts;
      }
    ).selectRelevantFacts(
      facts,
      '家里的新称呼、矛盾边界、纠正事实和认错方式都按最新版。',
      4,
      [
        'family.address\n用户现在怎样称呼这位亲属？',
        'family.boundary\n用户要求怎样处理家事矛盾？',
        'correction.fact\n用户纠正过的具体事实是什么？',
        'correction.response\n用户希望被纠错后怎样回应？',
      ]
    );

    expect(selected.map(fact => fact.key)).toEqual([
      'family.address_update.儿子',
      'family.boundary.家里的矛盾',
      'correction.hard_fact.生日',
      'correction.response_style.不用反复道歉',
    ]);
  });

  it('prioritizes an exact entity hint over a similar semantic slot', () => {
    const service = new AgentContextService();
    const facts = [
      {
        key: 'family.address_update.女儿',
        value: '用户现在习惯称呼女儿为圆宝',
        priority: 3,
      },
      {
        key: 'relationship.forbidden_user_address.丫头',
        value: '用户不希望当前角色称呼用户为丫头',
        priority: 3,
      },
      {
        key: 'relationship.agent_calls_user',
        value: '用户希望当前角色称呼用户为阿舟',
        priority: 3,
      },
    ];
    const selected = (
      service as unknown as {
        selectRelevantFacts: (
          items: typeof facts,
          query: string,
          limit: number,
          retrievalPaths: string[]
        ) => typeof facts;
      }
    ).selectRelevantFacts(facts, '按后来改的称呼放进话里。', 1, [
      'relationship.agent_calls_user\n当前角色现在应该怎样称呼用户？',
    ]);

    expect(selected.map(fact => fact.key)).toEqual([
      'relationship.agent_calls_user',
    ]);
  });

  it('selects different ritual sub-slots before filling from the same slot', () => {
    const service = new AgentContextService();
    const facts = [
      {
        key: 'ritual.date.清明',
        value: '用户清明会去看当前角色',
        priority: 3,
      },
      {
        key: 'ritual.date.生日',
        value: '用户生日也会想起当前角色',
        priority: 3,
      },
      {
        key: 'ritual.action.老地方',
        value: '用户会去老地方走一圈',
        priority: 2,
      },
      {
        key: 'promise.boundary.下辈子',
        value: '用户说下辈子只是表达遗憾，不是在索要保证',
        priority: 3,
      },
      {
        key: 'promise_ritual.update.陪我坐会儿',
        value: '用户那天不想听道歉，只想被陪一会儿',
        priority: 3,
      },
      {
        key: 'style.preference.比喻',
        value: '用户不喜欢太多比喻',
        priority: 3,
      },
    ];
    const selected = (
      service as unknown as {
        selectRelevantFacts: (
          items: typeof facts,
          query: string,
          limit: number
        ) => typeof facts;
      }
    ).selectRelevantFacts(
      facts,
      '到了那个日子，我会去老地方，也会想起那个遗憾，但别再给我保证，陪我坐会儿就好。',
      4
    );

    expect(selected[0].key).toBe('promise.boundary.下辈子');
    expect(selected[1].key).toBe('promise_ritual.update.陪我坐会儿');
    expect(selected[2].key).toMatch(/^ritual\.date\./);
    expect(selected[3].key).toBe('ritual.action.老地方');
  });

  it('interleaves memory domains for a cross-domain emotional query', () => {
    const service = new AgentContextService();
    const facts = [
      {
        key: 'user.preference.food_update',
        value: '用户当前更想喝温牛奶',
        priority: 3,
      },
      {
        key: 'grief_need.response.我说我撑着',
        value: '用户说撑着时希望被心疼，不是被夸坚强',
        priority: 3,
      },
      {
        key: 'family.boundary.家里的矛盾',
        value: '家里有矛盾时先听，不要马上劝和',
        priority: 3,
      },
      {
        key: 'style.update.事实问题直接',
        value: '事实问题直接，思念问题温柔',
        priority: 3,
      },
      {
        key: 'user.preference.cold_meal',
        value: '用户不喜欢冷饭冷菜',
        priority: 3,
      },
      {
        key: 'taboo.comfort_method.时间会治愈一切',
        value: '用户难受时不想听时间会治愈一切',
        priority: 3,
      },
    ];
    const selected = (
      service as unknown as {
        selectRelevantFacts: (
          items: typeof facts,
          query: string,
          limit: number
        ) => typeof facts;
      }
    ).selectRelevantFacts(
      facts,
      '家里刚吵完，我嗓子也不舒服，心里有点撑不住，你按我习惯的方式和我说。',
      4
    );

    expect(selected).toHaveLength(4);
    expect(selected.map(fact => fact.key)).toEqual(
      expect.arrayContaining([
        'user.preference.food_update',
        'grief_need.response.我说我撑着',
        'family.boundary.家里的矛盾',
        'style.update.事实问题直接',
      ])
    );
  });

  it('uses the semantic conversation reading to expand memory relevance', () => {
    const service = new AgentContextService();
    const relevanceText = (
      service as unknown as {
        buildFactRelevanceText: (
          query: string,
          messages: MessageEntity[],
          reading: {
            primaryNeed: string;
            emotionalSource: string;
            anchors: Array<{ text: string; importance: 'high' | 'medium' }>;
            corrections: string[];
            negations: string[];
            questionsToAnswer: string[];
            relationshipSignal: string;
            uncertainties: string[];
            suggestedTone: string;
          }
        ) => string;
      }
    ).buildFactRelevanceText('这几件事一起压过来了', [], {
      primaryNeed: '需要同时顾及家事边界和身体忌口',
      emotionalSource: '想念亲人时习惯说自己能撑着',
      anchors: [
        {
          text: '希望采用用户最新认可的表达方式',
          importance: 'high',
        },
      ],
      corrections: [],
      negations: [],
      questionsToAnswer: [],
      relationshipSignal: '',
      uncertainties: [],
      suggestedTone: '温柔',
    });

    expect(relevanceText).toContain('家事边界');
    expect(relevanceText).toContain('身体忌口');
    expect(relevanceText).toContain('最新认可的表达方式');
  });

  it('keeps the direct prompt from inventing travel care from a closing update', () => {
    const service = new AgentContextService();
    const replyBrief = buildReplyBrief({
      currentQuery: '我知道了，那我先收拾东西准备回家了',
    });
    const prompt = (service as any).buildModelReplyBriefPrompt(
      replyBrief,
      undefined,
      'direct',
      false
    );

    expect(prompt).toContain('# 本轮回复任务');
    expect(prompt).toContain('准备回家');
    expect(prompt).toContain('不得补出');
    expect(prompt).toContain('路上注意安全');
  });

  it('puts the strong active-contribution guard into direct prompts', () => {
    const service = new AgentContextService();
    const replyBrief = buildReplyBrief({
      currentQuery: '你多陪我说几句吧，别光让我说',
    });

    expect(replyBrief.activeContribution).toBeTruthy();

    const prompt = (service as any).buildModelReplyBriefPrompt(
      replyBrief,
      undefined,
      'direct',
      false
    );

    expect(prompt).toContain('# 主动贡献');
    expect(prompt).toContain('你想说什么');
    expect(prompt).toContain('我这边刚静下来');
  });

  it('suppresses ritual and keepsake associations in household chores', () => {
    const service = new AgentContextService();
    const facts = [
      {
        key: 'promise.boundary.老地方',
        value: '用户提老地方时是在表达遗憾，不索要保证',
        priority: 3,
      },
      {
        key: 'keepsake.location.相框',
        value: '相框放在床头',
        priority: 3,
      },
      {
        key: 'compound.update.家务',
        value: '用户把洗衣液放回柜子',
        priority: 2,
      },
    ];
    const selected = (
      service as unknown as {
        selectRelevantFacts: (
          items: typeof facts,
          query: string,
          limit: number
        ) => typeof facts;
      }
    ).selectRelevantFacts(
      facts,
      '我把洗衣液放回老地方，又给旧相框擦了灰，今天只聊打扫。',
      1
    );

    expect(selected[0].key).toBe('compound.update.家务');
  });
});
