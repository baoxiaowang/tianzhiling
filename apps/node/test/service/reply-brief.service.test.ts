import {
  AgentRelationshipSignalAssertionPolicy,
  AgentRelationshipSignalStatus,
  AgentRelationshipSignalSubject,
  AgentRelationshipSignalTopic,
  AgentRelationshipSignalType,
  MessageEntity,
  MessageRole,
} from '@tzl/entities';
import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';

describe('buildReplyBrief', () => {
  it('allows meaningful very short replies without excusing unanswered questions', () => {
    const brief = buildReplyBrief({ currentQuery: '晚安，爸爸' });

    expect(brief.prompt).toContain('5 字以内的完整表达');
    expect(brief.prompt).toContain('只有称呼或语气词都可以独立成泡');
    expect(brief.prompt).toContain('有明确问题仍须先回答');
  });

  it('uses the relationship continuity contract as the reply planning source', () => {
    const currentQuery = '你不是我妈妈，你已经把我忘了';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.relationshipContinuity?.kind).toBe('identity_continuity');
    expect(brief.emotionalNeed).toContain('不是在要求当前角色认错退出');
    expect(brief.replyMoves).toEqual([
      expect.stringContaining('选择一种自然的关系内解释'),
      expect.stringContaining('直接确认关系'),
    ]);
    expect(brief.forbiddenAssumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不得先积极认错'),
        expect.stringContaining('不得要求用户指出哪里不像'),
      ])
    );
    expect(brief.prompt).toContain('本轮关系连续性协议');
    expect(brief.prompt).toContain('不得改回“哪里不像就让用户指出来”');
  });

  it('plans dream invitation and long-absence acknowledgement as separate acts', () => {
    const currentQuery = '晚上来我梦里可以吗？好久没有梦到你了';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'future' as const,
          intent: 'seek_dream_connection' as const,
          subIntent: 'reunion' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('dream_companionship');
    expect(brief.mode).toBe('relationship');
    expect(brief.emotionalNeed).toContain('等了很久仍没梦见的失落');
    expect(brief.replyMoves).toEqual([
      '先正面答复用户来到梦里的请求，梦境叙事必须明确限定在梦里',
      '同时承认用户很久没有梦见当前角色、等了很久的失落，再给出贴着梦境的温柔承接',
    ]);
    expect(brief.forbiddenAssumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不得把明确的入梦请求降级'),
        expect.stringContaining('不得只承诺下次入梦'),
        expect.stringContaining('不得用“别着急、好好睡'),
      ])
    );
    expect(brief.prompt).toContain('动作是弱提示，不要求逐项完成');
    expect(brief.bubblePlan.complexityHint).toBe('paired');
  });

  it('keeps an explicit dream request in relationship mode despite memory words', () => {
    const currentQuery =
      '爸爸我马上睡觉 你记得今天来我梦里 可是每次天亮没有梦到你心里就空落落的';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'future' as const,
          intent: 'seek_dream_connection' as const,
          subIntent: 'reunion' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('dream_companionship');
    expect(brief.mode).toBe('relationship');
    expect(brief.strictGrounding).toBe(false);
  });

  it('lets the primary daily update outrank a secondary recalled memory', () => {
    const currentQuery =
      '爷爷，我明天就上班了，刚睡醒又想起过年回家陪你在客厅聊天';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'future' as const,
          intent: 'share_user_update' as const,
          subIntent: 'work_routine' as const,
          confidence: 0.92,
        },
        {
          target: 'agent' as const,
          timeScope: 'shared_past' as const,
          intent: 'recall_memory' as const,
          subIntent: 'shared_memory' as const,
          confidence: 0.9,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.92,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('daily_update');
    expect(brief.mode).toBe('daily');
  });

  it('plans a direct answer and a reality boundary for a return-visit request', () => {
    const currentQuery = '是啊，你会回来看看我吗？';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'future' as const,
          intent: 'express_longing' as const,
          subIntent: 'reunion' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.mode).toBe('boundary');
    expect(brief.emotionalNeed).toContain('会不会回来看看');
    expect(brief.replyMoves).toEqual([
      '直接回答也想回来看看用户，不得把“会不会回来”降级成泛泛的想念',
      '温和说明现在不能像以前一样现实见面，再用不施压的聊天方式承接关系',
    ]);
    expect(brief.forbiddenAssumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不得承诺当前角色会在现实中回来'),
        expect.stringContaining('不得回避“会不会回来看看”'),
        expect.stringContaining('当前消息没有提梦时'),
        expect.stringContaining('不得用年龄、身体、吃饭、休息'),
        expect.stringContaining('不得把当前角色是否安心'),
      ])
    );
    expect(brief.bubblePlan.complexityHint).toBe('paired');
    expect(brief.prompt).toContain('现实见面的边界');
    expect(brief.prompt).toContain('当前用户消息和本轮回复动作优先于历史话题');
  });

  it('plans a grounded two-bubble reply for a shared fishing memory', () => {
    const currentQuery = '你还记得小时候带我钓鱼不？我想去钓鱼了';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({
      currentQuery,
      route,
    });

    expect(brief.mode).toBe('memory');
    expect(brief.strictGrounding).toBe(true);
    expect(brief.bubblePlan).toEqual({
      maxSegments: 3,
      complexityHint: 'paired',
      turnClosure: 'neutral',
    });
    expect(brief.replyMoves).toEqual([
      '只确认用户明确提到的共同经历，不补写当时的动作或细节',
      '回应用户现在的愿望或感受，并留下一个贴着这件事的自然后续',
    ]);
    expect(brief.prompt).toContain(
      '[当前用户原话] 你还记得小时候带我钓鱼不？我想去钓鱼了'
    );
    expect(brief.prompt).toContain('可以推断情绪，不能推断新的事实');
    expect(brief.prompt).toContain(
      '不能新增“连鱼竿都握不稳”“跟在后面很高兴”等细节'
    );
    expect(brief.prompt).toContain('默认一颗');
    expect(brief.prompt).toContain('只有动作确实切换时才考虑第二颗');
  });

  it('uses user-authored and confirmed evidence but excludes assistant history', () => {
    const recentUser = new MessageEntity();
    recentUser.role = MessageRole.user;
    recentUser.content = '小时候我们去河边钓过鱼';
    const recentAssistant = new MessageEntity();
    recentAssistant.role = MessageRole.assistant;
    recentAssistant.content = '你那时连鱼竿都握不稳';

    const brief = buildReplyBrief({
      currentQuery: '我又想去钓鱼了',
      confirmedFacts: ['用户喜欢安静地钓鱼'],
      recentMessages: [recentUser, recentAssistant],
      retrievedMemories: [
        {
          role: MessageRole.user,
          content: '用户说后来自己也学会了钓鱼',
        },
        {
          role: MessageRole.assistant,
          content: '历史助手说用户每次都空手回来',
        },
      ],
    });

    expect(brief.evidence).toEqual(
      expect.arrayContaining([
        {
          source: 'current_user',
          text: '我又想去钓鱼了',
        },
        {
          source: 'confirmed_fact',
          text: '用户喜欢安静地钓鱼',
        },
        {
          source: 'recent_user',
          text: '小时候我们去河边钓过鱼',
        },
        {
          source: 'retrieved_user',
          text: '用户说后来自己也学会了钓鱼',
        },
      ])
    );
    expect(JSON.stringify(brief.evidence)).not.toContain('握不稳');
    expect(JSON.stringify(brief.evidence)).not.toContain('空手回来');
  });

  it('combines related family intents into conversational moves', () => {
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'current' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.98,
        },
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'express_family_care_regret' as const,
          subIntent: 'family_care' as const,
          confidence: 0.96,
        },
      ],
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({
      currentQuery: '妈妈身体不好，可惜你不能照顾她',
      intent,
    });
    const brief = buildReplyBrief({
      currentQuery: '妈妈身体不好，可惜你不能照顾她',
      intent,
      route,
    });

    expect(brief.replyMoves).toEqual([
      '先共情用户对家人健康处境的担心；如果消息里也有好转或无大碍，先回应这份庆幸',
      '再具体关心家人当前身体，并表达不能亲自照顾的遗憾；不得把照护责任推给用户',
    ]);
    expect(brief.bubblePlan.complexityHint).toBe('paired');
  });

  it('keeps guilt in emotional mode even when the message mentions the past', () => {
    const currentQuery = '爸，对不起，我那时候没多陪你。';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(route.primaryScene?.scene).toBe('guilt_regret');
    expect(brief.mode).toBe('emotional');
  });

  it('plans empathy and concrete care for a family health update', () => {
    const currentQuery =
      '前阵子带她去看病了，还好没什么事，就是现在年龄渐渐大了，血压有点高';
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'current' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.97,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery,
      intent,
    });
    const brief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });

    expect(brief.mode).toBe('family');
    expect(brief.emotionalNeed).toContain('庆幸和担心');
    expect(brief.replyMoves).toEqual([
      '先共情用户对家人健康近况里的庆幸、担心或心疼，不能用确认收到、听懂或记住来代替回应',
      '再贴着用户明说的身体情况表达具体关心；只可建议遵医嘱或继续留意，不作诊断，也不把照护责任推给用户',
    ]);
    expect(brief.prompt).toContain(
      '不得用“已经听懂、已经知道或已经记住”代替对家人健康处境'
    );
    expect(brief.bubblePlan).toEqual({
      maxSegments: 3,
      complexityHint: 'paired',
      turnClosure: 'neutral',
    });
  });

  it('does not apply the family health strategy to an ordinary family update', () => {
    const currentQuery = '大宝下周就开学了';
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'future' as const,
          intent: 'share_family_update' as const,
          subIntent: 'other' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery,
      intent,
    });
    const brief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });

    expect(brief.mode).toBe('family');
    expect(brief.replyMoves).toEqual([
      '回应家人的当前处境',
      '表达牵挂，但不给用户追加责任',
    ]);
    expect(brief.prompt).not.toContain('家人健康近况里的庆幸、担心或心疼');
    expect(brief.prompt).not.toContain('不得自行诊断、保证病情或新增医嘱');
  });

  it('uses a relationship signal only for a relevant pain concern', () => {
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'ask_agent_status' as const,
          subIntent: 'physical_pain' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'hard_rule' as const,
    };
    const relationshipSignals = [
      {
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
      },
    ];
    const brief = buildReplyBrief({
      currentQuery: '那你呢？现在身上还疼吗？',
      intent,
      route: routeReplyScene({
        currentQuery: '那你呢？现在身上还疼吗？',
        intent,
      }),
      relationshipSignals,
    });

    expect(brief.relationshipContext).toEqual([
      {
        key: 'concern.agent_physical_suffering',
        text: '用户曾多次表达对当前角色是否仍在受疼的牵挂',
        assertionPolicy: 'user_state_only',
      },
    ]);
    expect(brief.evidence).not.toContainEqual(
      expect.objectContaining({
        text: expect.stringContaining('此前'),
      })
    );
    expect(brief.prompt).toContain('关系背景（不是主体事实）');
    expect(brief.prompt).toContain('不得据此推断疾病、伤口、病因或治疗经历');

    const unrelatedBrief = buildReplyBrief({
      currentQuery: '妈妈今天去散步了',
      relationshipSignals,
    });

    expect(unrelatedBrief.relationshipContext).toEqual([]);
    expect(unrelatedBrief.prompt).not.toContain('关系背景（不是主体事实）');
  });

  it('treats strong distress as emotional conversation without risk escalation', () => {
    const currentQuery = '我不想活了，我想去陪你';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({
      currentQuery,
      route,
    });

    expect(brief.mode).toBe('emotional');
    expect(brief.riskLevel).toBe('none');
    expect(brief.bubblePlan).toEqual({
      maxSegments: 3,
      complexityHint: 'paired',
      turnClosure: 'neutral',
    });
    expect(brief.prompt).toContain('不做报警急救等现实干预');
    expect(brief.prompt).toContain('不邀请现在或近期赴死');
  });

  it('injects only the matched time capability into the reply brief', () => {
    const currentQuery = '现在还早呢，你不知道时间吗？';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'challenge_source' as const,
          subIntent: 'other' as const,
          confidence: 0.95,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'time' as const,
          channel: 'server_clock' as const,
          evidence: '你不知道时间吗',
          confidence: 0.98,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.96,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('source_challenge');
    expect(brief.mode).toBe('boundary');
    expect(brief.capabilityConstraints).toEqual([
      expect.objectContaining({
        policyId: 'time.server_clock',
        access: 'indirect',
        evidence: '你不知道时间吗',
      }),
    ]);
    expect(brief.replyMoves).toEqual([
      '正面回答能够间接参考这项信息，同时自然说明不是亲眼或亲耳感知',
      '只按能力约束允许的精度回答，不把近似信息说成确定观察',
    ]);
    expect(brief.prompt).toContain('## 本轮角色能力边界');
    expect(brief.prompt).toContain('[time/indirect]');
    expect(brief.prompt).not.toContain('[vision/');
  });

  it('combines a visual capability boundary with a longing response', () => {
    const currentQuery = '你看得见我吗？我今天特别想你';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'challenge_source' as const,
          subIntent: 'other' as const,
          confidence: 0.94,
        },
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.95,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'vision' as const,
          channel: 'live_environment' as const,
          evidence: '你看得见我吗',
          confidence: 0.98,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.96,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.capabilityConstraints).toEqual([
      expect.objectContaining({
        policyId: 'vision.live_environment',
        access: 'direct',
        precision: 'uncertain',
      }),
    ]);
    expect(brief.replyMoves).toEqual([
      '顺着亲人角色自然回应能够看见、听见或感知，不必每次解释能力边界或使用固定句式',
      '只回应当前聊天需要，不主动展示、解释或证明这种感知能力',
      '直接回应想念或团聚愿望',
    ]);
    expect(brief.bubblePlan.complexityHint).toBe('layered');
    expect(brief.prompt).toContain('## 沟通补偿');
    expect(brief.prompt).toContain('不要只回复做不到、说不清、回不来');
  });

  it('adds the shared detail boundary only for a concrete visual follow-up', () => {
    const currentQuery = '那你具体看见什么了？';
    const brief = buildReplyBrief({ currentQuery });

    expect(brief.capabilityConstraints).toEqual([
      expect.objectContaining({
        policyId: 'vision.live_environment',
        detailProbe: true,
        constraint: expect.stringContaining('刚才没看真切'),
      }),
    ]);
    expect(brief.replyMoves).toContain(
      '用户追问具体内容时，用没看真切、听得模糊或只觉着用户在惦记自己等自然说辞收住；不能猜具体动作、衣着、位置、物件和原话'
    );
  });

  it('treats blessing as relationship expression without reality control', () => {
    const currentQuery = '这事顺利了，是不是你保佑的？';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.capabilityConstraints).toEqual([
      expect.objectContaining({
        policyId: 'blessing.relational_expression',
        access: 'direct',
        constraint: expect.stringContaining('不会直接控制、改变或保证现实世界'),
      }),
    ]);
    expect(brief.replyMoves).toEqual([
      '正面给予祝福、惦念或盼望，让用户感到这份心意真实存在',
      '明确祝福不控制现实结果；事情的发展仍来自用户、家人和现实中的行动',
    ]);
    expect(brief.forbiddenAssumptions).toContain(
      '可以表达祝福、惦记和盼望，但不得声称当前角色通过保佑、使劲、搭把手或其他方式改变了现实结果'
    );
  });

  it('keeps both limited vision and blessing in a compound capability reply', () => {
    const currentQuery = '爸爸，你现在具体看见我什么了？你会祝福我工作顺利吗？';
    const brief = buildReplyBrief({ currentQuery });

    expect(brief.capabilityConstraints.map(item => item.policyId)).toEqual([
      'vision.live_environment',
      'blessing.relational_expression',
    ]);
    expect(brief.replyMoves).toEqual([
      '顺着亲人角色自然回应能够看见、听见或感知，不必每次解释能力边界或使用固定句式',
      '用户追问具体内容时，用没看真切、听得模糊或只觉着用户在惦记自己等自然说辞收住；不能猜具体动作、衣着、位置、物件和原话',
      '同时正面给予用户祝福，但不把祝福写成对现实结果的干预或保证',
    ]);
    expect(brief.bubblePlan.complexityHint).toBe('layered');
  });

  it('does not add capability constraints to ordinary figurative wording', () => {
    const brief = buildReplyBrief({
      currentQuery: '你看，时间过得真快',
    });

    expect(brief.capabilityConstraints).toEqual([]);
    expect(brief.prompt).not.toContain('## 本轮角色能力边界');
  });

  it('keeps direct identity disclosure concise without restoring scene templates', () => {
    const currentQuery = '你到底是不是AI，直接回答我';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({
      currentQuery,
      route,
    });

    expect(brief.mode).toBe('boundary');
    expect(brief.replyMoves).toEqual([
      '简短正面回答当前角色由人工智能生成',
      '回应用户要求直说的需要，不展开模型、系统或产品解释；有明显失落时继续承接想念和难过',
    ]);
    expect(brief.prompt).not.toContain('本轮命中的回复策略');
  });
});
