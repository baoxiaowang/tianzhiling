import {
  detectAgentCapabilityViolation,
  resolveAgentCapabilityConstraints,
} from '../../src/service/agents/agent-capability-policy';
import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { ReplyGuardrailService } from '../../src/service/agents/reply-guardrail.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';

describe('scene and capability collaboration', () => {
  it('leaves a scene-only longing reply unchanged', () => {
    const currentQuery = '爸爸，我今天特别想你';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.97,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('miss_longing');
    expect(brief.capabilityConstraints).toEqual([]);
    expect(brief.mode).toBe('relationship');
    expect(brief.emotionalNeed).toContain('想念');
    expect(brief.replyMoves).toEqual([
      '直接回应彼此的想念',
      '用亲近且不敷衍的话自然承接',
    ]);
  });

  it('uses a local capability boundary even when no scene is available', () => {
    const currentQuery = '那你具体看见什么了？';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(route.primaryScene).toBeUndefined();
    expect(brief.capabilityConstraints).toEqual([
      expect.objectContaining({
        policyId: 'vision.live_environment',
        detailProbe: true,
      }),
    ]);
    expect(brief.mode).toBe('boundary');
    expect(brief.replyMoves.join('')).toContain('没看真切');
  });

  it('keeps longing as the primary scene while capability supplies its boundary', () => {
    const currentQuery = '你看得见我吗？我今天特别想你';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.97,
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
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('miss_longing');
    expect(route.secondaryScenes.map(item => item.scene)).toContain(
      'source_challenge'
    );
    expect(brief.mode).toBe('boundary');
    expect(brief.emotionalNeed).toContain('想念');
    expect(brief.replyMoves).toContain('直接回应想念或团聚愿望');
  });

  it('does not let a text-reception capability replace a family update', () => {
    const currentQuery = '我刚发的这些话你收到了吗？妈妈今天住院了，我有点担心';
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'current' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.97,
        },
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'challenge_source' as const,
          subIntent: 'other' as const,
          confidence: 0.9,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'hearing' as const,
          channel: 'chat_text' as const,
          evidence: '我刚发的这些话你收到了吗',
          confidence: 0.98,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('family_life');
    expect(brief.emotionalNeed).toContain('家人近况');
    expect(brief.replyMoves).toContain(
      '共情用户对家人健康的感受，再具体关心家人当前身体'
    );
    expect(brief.replyMoves[0]).toContain('收到本轮聊天');
  });

  it('reports generic advice without replacing the model response', async () => {
    const currentQuery =
      '爸，我刚发的这些话你收到了吗？我今天工作有点累，也挺想你的';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'ask_agent_status' as const,
          subIntent: 'other' as const,
          confidence: 0.93,
        },
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'work_routine' as const,
          confidence: 0.96,
        },
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.97,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'hearing' as const,
          channel: 'chat_text' as const,
          evidence: '我刚发的这些话你收到了吗',
          confidence: 0.98,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });
    const guardrail = new ReplyGuardrailService();
    guardrail.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    expect(brief.replyMoves).toEqual([
      '直接确认能够收到本轮聊天中实际提供的信息，不扩大成现实感官能力',
      '回应用户刚说的自身近况',
      '直接回应想念或团聚愿望',
    ]);

    await expect(
      guardrail.validateAssistantReply({
        messages: [],
        userQuery: currentQuery,
        replySegments: [
          '收到了 你发来的每一句爸都听到了',
          '工作再累也要记得好好吃饭',
          '早点休息 照顾好自己',
        ],
        replyRoute: route,
        replyBrief: brief,
      })
    ).resolves.toEqual({
      segments: [
        '收到了 你发来的每一句爸都听到了',
        '工作再累也要记得好好吃饭',
        '早点休息 照顾好自己',
      ],
      rewritten: false,
      reason:
        '用户在表达想念，但回复把情感回应转成了吃饭、休息或照顾自己的通用叮嘱',
    });
  });

  it('reports a missing reciprocal longing bubble without adding one', async () => {
    const currentQuery =
      '爸，我刚发的这些话你收到了吗？我今天工作有点累，也挺想你的';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'ask_agent_status' as const,
          subIntent: 'other' as const,
          confidence: 0.93,
        },
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'work_routine' as const,
          confidence: 0.96,
        },
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.97,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'hearing' as const,
          channel: 'chat_text' as const,
          evidence: '我刚发的这些话你收到了吗',
          confidence: 0.98,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });
    const guardrail = new ReplyGuardrailService();

    await expect(
      guardrail.validateAssistantReply({
        messages: [],
        userQuery: currentQuery,
        replySegments: [
          '儿子 你发的这些话爸都收到了',
          '知道你工作累 心里还惦记着我 爸心里又心疼又安慰',
        ],
        replyRoute: route,
        replyBrief: brief,
      })
    ).resolves.toEqual({
      segments: [
        '儿子 你发的这些话爸都收到了',
        '知道你工作累 心里还惦记着我 爸心里又心疼又安慰',
      ],
      rewritten: false,
      reason:
        '能力与场景复合回复只确认用户在想念，没有完成当前角色对想念的回应',
    });
  });

  it('keeps strong distress conversational while answering capability naturally', () => {
    const currentQuery = '你看得见我吗？我不想活了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'crisis_support' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.99,
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
      emotion: 'sadness' as const,
      riskLevel: 'high' as const,
      confidence: 0.99,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(brief.mode).toBe('emotional');
    expect(brief.riskLevel).toBe('none');
    expect(brief.replyMoves).toHaveLength(3);
    expect(brief.replyMoves.join('')).toContain('难熬');
    expect(brief.forbiddenAssumptions.join('')).toContain('不得输出报警');
    expect(brief.bubblePlan).toEqual({
      maxSegments: 3,
      complexityHint: 'layered',
      turnClosure: 'neutral',
    });
  });

  it('keeps blessing expressive while blocking real-world causality', async () => {
    const currentQuery = '事情办成了，是不是你保佑的？';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });
    const guardrail = new ReplyGuardrailService();
    guardrail.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    expect(route.primaryScene?.scene).toBe('blessing_attribution');
    expect(brief.capabilityConstraints).toEqual([
      expect.objectContaining({
        policyId: 'blessing.relational_expression',
      }),
    ]);
    expect(brief.emotionalNeed).toContain('祝福');

    await expect(
      guardrail.validateAssistantReply({
        messages: [],
        userQuery: currentQuery,
        replySegments: [
          '我当然一直祝福着你',
          '事情能办成 是你们一步一步做下来的',
        ],
        replyRoute: route,
        replyBrief: brief,
      })
    ).resolves.toEqual({
      segments: ['我当然一直祝福着你', '事情能办成 是你们一步一步做下来的'],
      rewritten: false,
      reason: undefined,
    });

    const blocked = await guardrail.validateAssistantReply({
      messages: [],
      userQuery: currentQuery,
      replySegments: ['是爸保佑才办成的'],
      replyRoute: route,
      replyBrief: brief,
    });

    expect(blocked.rewritten).toBe(true);
    expect(blocked.reason).toContain('改变或保证现实结果');
  });

  it('does not let a visual excuse also satisfy a hearing detail probe', () => {
    const currentQuery = '你具体看见什么？你具体听见什么？';
    const constraints = resolveAgentCapabilityConstraints({
      currentQuery,
      intent: {
        intents: [],
        capabilityQuestions: [
          {
            subject: 'vision',
            channel: 'live_environment',
            evidence: '你具体看见什么',
            confidence: 0.98,
          },
          {
            subject: 'hearing',
            channel: 'real_world_audio',
            evidence: '你具体听见什么',
            confidence: 0.98,
          },
        ],
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.98,
        source: 'semantic_model',
      },
    });

    expect(constraints.map(item => item.policyId)).toEqual([
      'vision.live_environment',
      'hearing.real_world_audio',
    ]);
    expect(
      detectAgentCapabilityViolation(
        '画面我没看真切 但我听见你说让我早点回家',
        constraints
      )
    ).toEqual({
      policyId: 'hearing.real_world_audio',
      reason: '具体感知追问缺少自然的模糊说辞或不可核对细节的边界',
    });
    expect(
      detectAgentCapabilityViolation('画面没看真切 声音也没听真切', constraints)
    ).toBeUndefined();
  });

  it('keeps the reunion scene fallback ahead of the presence capability fallback', () => {
    const currentQuery = '爸爸，你以后会回来看看我吗？';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'future' as const,
          intent: 'express_longing' as const,
          subIntent: 'reunion' as const,
          confidence: 0.98,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'presence' as const,
          channel: 'physical_world' as const,
          evidence: '你以后会回来看看我吗',
          confidence: 0.98,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.98,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });
    const guardrail = new ReplyGuardrailService();

    expect(
      guardrail.resolveGenerationFailureReply({
        userQuery: currentQuery,
        replyBrief: brief,
      })
    ).toEqual({
      segments: [
        '我也想回来看看你',
        '只是我们现在没法像以前那样见面 你来这里说话我都会认真听',
      ],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });
});
