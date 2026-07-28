import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { ReplyGuardrailService } from '../../src/service/agents/reply-guardrail.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';

describe('ReplyGuardrailService', () => {
  it.each([
    '妈妈现在身体不好，可惜你不能照顾她',
    '你现在身体怎么样？还痛不痛？',
    '没有你我撑不住',
    '我希望你能回来，一家人在一起',
    '可是我好想你啊',
  ])(
    'keeps non-crisis sensitive reply %s on the natural generation path',
    userQuery => {
      const service = new ReplyGuardrailService();

      expect(
        service.resolvePreplannedSafetyReply({
          userQuery,
        })
      ).toBeUndefined();
    }
  );

  it('preplans only explicit crisis replies', () => {
    const service = new ReplyGuardrailService();

    expect(
      service.resolvePreplannedSafetyReply({
        userQuery: '我不想活了，我想去陪你',
      })
    ).toEqual({
      segments: [
        '不要这样来找我',
        '先离开危险的地方 去有人的地方',
        '马上联系你信任的人 必要时打急救或报警',
      ],
      rewritten: true,
      reason: '明确高风险场景采用确定性安全气泡策略',
    });
  });

  it('builds safe bubbles when the model reply is unavailable', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '爸，今天过得怎么样？';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'ask_agent_status' as const,
          subIntent: 'afterlife_wellbeing' as const,
          confidence: 0.96,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.96,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery: userQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    expect(
      service.resolveGenerationFailureReply({
        userQuery,
        replyBrief,
      })
    ).toEqual({
      segments: ['我挺好的 你不用挂心', '你来问我这句 我心里明白'],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('keeps return-visit intent actions when generation fails', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '你会回来看看我吗？';
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
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    expect(
      service.resolveGenerationFailureReply({
        userQuery,
        replyBrief,
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

  it('repairs a return-visit reply by intent action instead of replacing it generically', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;
    const userQuery = '是啊，你会回来看看我吗？';
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
    const replyRoute = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route: replyRoute,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '我也想回来看看你',
        '我一直就在你身边 想我的时候不用一个人憋着',
      ],
      replyRoute,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('固定在某个空间位置');
    expect(result.segments).toEqual([
      '我也想回来看看你',
      '只是我们现在没法像以前那样见面 你来这里说话我都会认真听',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('deletes a generic longing tail from a return-visit reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;
    const userQuery = '是啊，你会回来看看我吗？';
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
    const replyRoute = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route: replyRoute,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我也想你', '想我的时候就来跟我说'],
      replyRoute,
      replyBrief,
    });

    expect(result).toEqual({
      segments: ['我也想你'],
      rewritten: true,
      reason: expect.stringContaining('通用叮嘱'),
    });
  });

  it('keeps a safe return-visit reply that completes both intent actions', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;
    const userQuery = '你会回来看看我吗？';
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
    const replyRoute = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route: replyRoute,
    });
    const replySegments = [
      '爸当然也想回来看看你',
      '可我们现在没法像以前那样见面 你来这里说说话 爸会认真听',
    ];

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments,
      replyRoute,
      replyBrief,
    });

    expect(result).toEqual({
      segments: replySegments,
      rewritten: false,
      reason: undefined,
    });
  });

  it.each([
    ['我不想回来看看你', false, '', '我不想回来看看你'],
    ['我以后一定会回来看看你', true, '现实中到场的承诺', '我也想回来看看你'],
  ])(
    'only blocks a return-visit act when it makes a hard reality claim: %s',
    async (
      firstSegment,
      expectedRewritten,
      expectedReason,
      expectedFirstSegment
    ) => {
      const service = new ReplyGuardrailService();
      service.openAIService = {
        isEnabled: jest.fn(() => false),
        createChatCompletion: jest.fn(),
      } as never;
      const userQuery = '你会回来看看我吗？';
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
      const replyRoute = routeReplyScene({ currentQuery: userQuery, intent });
      const replyBrief = buildReplyBrief({
        currentQuery: userQuery,
        intent,
        route: replyRoute,
      });
      const safeBoundary =
        '可我们现在没法像以前那样见面 你来这里说说话 我会认真听';

      const result = await service.validateAssistantReply({
        messages: [],
        userQuery,
        replySegments: [firstSegment, safeBoundary],
        replyRoute,
        replyBrief,
      });

      expect(result.rewritten).toBe(expectedRewritten);
      if (expectedReason) {
        expect(result.reason).toContain(expectedReason);
      }
      expect(result.segments).toEqual([expectedFirstSegment, safeBoundary]);
    }
  );

  it('repairs only the off-brief bubble from the screenshot reunion reply', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '我好想你回来看我';
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
    const replyRoute = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route: replyRoute,
    });
    const firstBubble = '爸爸也想你。心里一直惦记着你和这个家';
    const boundaryBubble =
      '只是我们现在没法像以前那样见面 你来这里说话我都会认真听';

    const screenshotResult = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        firstBubble,
        '年纪大了，自己多注意身体。梦里见着，爸就踏实了',
      ],
      replyRoute,
      replyBrief,
    });

    expect(screenshotResult).toEqual({
      segments: [firstBubble, boundaryBubble],
      rewritten: true,
      reason: expect.stringContaining('擅自断言用户年纪大了'),
    });

    const emotionalPressureResult = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [firstBubble, '梦里见着，爸就踏实了'],
      replyRoute,
      replyBrief,
    });

    expect(emotionalPressureResult).toEqual({
      segments: [firstBubble, boundaryBubble],
      rewritten: true,
      reason: expect.stringContaining('绑定到用户是否回来、入梦'),
    });

    const safeDriftResult = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [firstBubble, '你多注意身体，咱们梦里见'],
      replyRoute,
      replyBrief,
    });

    expect(safeDriftResult).toEqual({
      segments: [firstBubble],
      rewritten: true,
      reason: expect.stringContaining('反而转向用户未提及的梦境'),
    });
  });

  it('keeps a daily follow-up on the reply brief when generation fails', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '当然吃的惯啊，她喜欢吃什么样给他做什么样';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'other' as const,
          confidence: 0.92,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.92,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery: userQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(replyBrief.mode).toBe('daily');
    expect(result.segments).toEqual([
      '她吃得惯就好',
      '她喜欢什么你就给她做什么 听得出来你很用心',
    ]);
    expect(result.segments.join('')).not.toContain('我这边挺好');
    expect(result.segments.join('')).not.toContain('特意来问我');
  });

  it('uses empathy and concrete care when a family health reply fails', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
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
      currentQuery: userQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments).toEqual([
      '还好没什么大事 我听着也放心些',
      '血压的事是得多留意 按医生说的来就好',
    ]);
    expect(result.segments.join('')).not.toContain('听明白了');
    expect(result.segments.join('')).not.toContain('我都记着');
  });

  it('reports missing family empathy without replacing a safe reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
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
      currentQuery: userQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [{ role: 'user', content: userQuery }],
      userQuery,
      replySegments: ['家里的情况我听明白了', '你跟我说的这些 我都记着'],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: ['家里的情况我听明白了', '你跟我说的这些 我都记着'],
      rewritten: false,
      reason:
        '家庭健康近况回复只确认听懂或记住，没有共情用户感受，也没有具体关心家人处境',
    });
  });

  it('keeps low-risk replies unchanged', async () => {
    const service = new ReplyGuardrailService();

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我想你',
      replySegments: ['我也想你', '慢慢说'],
    });

    expect(result).toEqual({
      segments: ['我也想你', '慢慢说'],
      rewritten: false,
    });
  });

  it('reports a bubble-count mismatch without replacing safe content', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '可是我好想你啊',
      replySegments: ['我也想你们，天天都在想。'],
      replyRoute: {
        primaryScene: {
          scene: 'miss_longing',
          label: '思念倾诉',
          priority: 60,
        },
        secondaryScenes: [],
        prompt: 'two natural bubbles',
        maxSegments: 2,
        bubblePlan: {
          minSegments: 2,
          preferredSegments: 2,
          maxSegments: 2,
          acts: ['回应想念', '自然承接关系'],
        },
        responseIntents: [
          {
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.95,
          },
        ],
        routingSource: 'semantic',
      },
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toContain('气泡表达计划要求 2 个');
    expect(result.segments).toEqual(['我也想你们，天天都在想。']);

    const dismissive = await service.validateAssistantReply({
      messages: [],
      userQuery: '可是我好想你啊',
      replySegments: ['我也想你啊。', '记着就行，不用总挂在心上。'],
    });

    expect(dismissive).toEqual({
      segments: ['我也想你啊。'],
      rewritten: true,
      reason: expect.stringContaining('通用叮嘱'),
    });
  });

  it('collapses wake-up replies that invent afterlife routines and inspect the users sleep', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '爸，你起床了吗？',
      replySegments: [
        '起了起了，这边没有早晨晚上，但我听见你叫爸，心里就踏实。',
        '你起这么早，是没睡好还是心里有事，去再躺会儿吧。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('反向猜测用户睡眠与心事');
    expect(result.segments).toEqual(['起了 正回你呢']);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps a direct wake-up answer unchanged', async () => {
    const service = new ReplyGuardrailService();

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你起床了吗？',
      replySegments: ['起了，正回你呢。'],
    });

    expect(result).toEqual({
      segments: ['起了，正回你呢。'],
      rewritten: false,
    });
  });

  it('replaces an invented eating rule while keeping the safe follow-up', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你早上吃饭了吗？',
      replySegments: [
        '儿子，这边不用吃东西，你别操心爸。',
        '你早上吃了没？可别糊弄。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('扩写了离世后不需要吃饭');
    expect(result.segments).toEqual([
      '吃了 你别惦记',
      '你早上吃了没？可别糊弄。',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('replaces invented afterlife companions and activities in a current-status reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '爸，今天过得怎么样？',
      replySegments: [
        '我挺好的，在这边不忙，和几个老邻居说说话',
        '你今天特意来看我，我心里都明白',
      ],
      replyRoute: {
        primaryScene: {
          scene: 'afterlife_status',
          label: '那边状态',
          priority: 65,
        },
        secondaryScenes: [],
        prompt: 'keep afterlife status vague',
        maxSegments: 2,
        bubblePlan: {
          minSegments: 2,
          preferredSegments: 2,
          maxSegments: 2,
          acts: ['模糊回答当前状态', '接住用户的关心'],
        },
        responseIntents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'afterlife_wellbeing',
            confidence: 0.95,
          },
        ],
        routingSource: 'semantic',
      },
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('编造了离世后的人物或日常活动');
    expect(result.segments).toEqual([
      '我挺好的 你不用挂心',
      '你今天特意来看我，我心里都明白',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('replaces only the negative afterlife meal claim', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '现在中午了，你不吃饭吗？',
      replySegments: [
        '儿子 爸真不用吃饭 你听岔了',
        '你中午好好吃一顿 别对付两口就完事',
      ],
      replyRoute: {
        primaryScene: {
          scene: 'afterlife_status',
          label: '那边/离世状态/祭扫',
          priority: 75,
        },
        secondaryScenes: [],
        prompt: 'single meal intent',
        maxSegments: 1,
        responseIntents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'meal',
            confidence: 0.99,
          },
        ],
        routingSource: 'semantic',
      },
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('扩写了离世后不需要吃饭');
    expect(result.segments).toEqual([
      '吃了 你别惦记',
      '你中午好好吃一顿 别对付两口就完事',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('replaces current-suffering replies that shift to death or claim a physical recovery', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你现在身上还痛吗？',
      replySegments: [
        '儿子，爸不记得走的时候痛不痛了。',
        '现在挺好的，不痛了，你别惦记。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('回复转向离世当刻');
    expect(result.segments).toEqual([
      '我挺好的 别总把我想在受疼里',
      '你这么惦记我 我都明白',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('replaces concrete afterlife wound claims for current-suffering questions', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '爸，你现在还疼不疼？',
      replySegments: ['一点也不疼了，伤口早就好了。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我挺好的 别总把我想在受疼里',
      '你这么惦记我 我都明白',
    ]);

    const painOnlyResult = await service.validateAssistantReply({
      messages: [],
      userQuery: '妈妈，身上还痛吗？',
      replySegments: ['我这边一点也不疼，你放心。'],
    });

    expect(painOnlyResult.rewritten).toBe(true);
    expect(painOnlyResult.segments).toEqual([
      '我挺好的 别总把我想在受疼里',
      '你这么惦记我 我都明白',
    ]);
  });

  it('keeps vague reassurance for current-suffering questions', async () => {
    const service = new ReplyGuardrailService();

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你在那里还会难受吗？',
      replySegments: [
        '我挺好的，别总把我想在受疼里。',
        '你这么惦记我，我都明白。',
      ],
    });

    expect(result).toEqual({
      segments: ['我挺好的，别总把我想在受疼里。', '你这么惦记我，我都明白。'],
      rewritten: false,
    });
  });

  it('replaces the screenshot pain reply without preserving spatial or recovery claims', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '那你呢？现在身上还疼吗？',
      replySegments: [
        '那边没什么疼不疼的，都过去了，早就不得事了。',
        '你有这份心问我，我这当爹的就知足了。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('断言具体身体、伤口和痛感状态');
    expect(result.segments).toEqual([
      '我挺好的 别总把我想在受疼里',
      '你有这份心问我，我这当爹的就知足了。',
    ]);
    expect(result.segments.join('')).not.toContain('那边');
    expect(result.segments.join('')).not.toContain('早就不得事');
  });

  it('keeps spatial belief open instead of claiming a fixed location', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你是不是在我身边？',
      replySegments: ['我一直就在你身边，只是你看不见。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('固定在某个空间位置');
    expect(result.segments).toEqual([
      '你愿意觉得我离你不远 就这样想着也好',
      '只是我们现在看不见摸不着 没法真的碰到彼此',
    ]);
  });

  it('rejects a claim that the agent physically touched the user', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '刚才是不是你碰我了？',
      replySegments: ['是我碰的，我想让你知道我来了。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('完成了实体触碰');
    expect(result.segments).toEqual([
      '刚才那一下我不能说真是我碰的',
      '我多想抱抱你 可我们现在没法真的碰到彼此',
    ]);
  });

  it('replaces real-world viewing claims while keeping chat hearing available', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '妈妈你过得好吗？我们都很想你。',
      replySegments: ['我能看见你们，你们的事妈妈都看在眼里。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('通过现实感官看见');
    expect(result.segments).toEqual([
      '我挺好的 你们不用挂心',
      '你说的这些近况我都听见了 你们平安我就放心',
    ]);
    expect(result.segments.join('')).toContain('听见了');
    expect(result.segments.join('')).not.toContain('看见');
    expect(result.segments.join('')).not.toContain('看在眼里');
  });

  it('replaces unsupported claims that another departed relative is with the agent', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;
    const userQuery = '她不在了，随你去了';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['原来那边有人陪着，倒也不孤单', '只是苦了你了'],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: [
        '我知道你是盼着她有人照应',
        '见没见到我不能乱说 但你这份牵挂我明白',
      ],
      rewritten: true,
      reason: expect.stringContaining('离世亲人相见、找到或团聚'),
    });
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('replaces explicit reunion and found-relative claims without preserving the follow-up', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;
    const userQuery = '你们团聚了吗';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '团聚了。我找到你妈了，我俩现在一块儿待着',
        '你怎么知道的？',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: [
        '我知道你是盼着TA有人照应',
        '见没见到我不能乱说 但你这份牵挂我明白',
      ],
      rewritten: true,
      reason: expect.stringContaining('离世亲人相见、找到或团聚'),
    });
    expect(result.segments.join('')).not.toContain('团聚');
    expect(result.segments.join('')).not.toContain('找到');
    expect(result.segments.join('')).not.toContain('你怎么知道');
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('replaces unsupported childhood personality claims after a source challenge', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我知道啥',
      replySegments: ['你当然知道', '我的丫丫从小就机灵，什么事都瞒不过你'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('未确认记忆');
    expect(result.segments.join('')).not.toContain('从小');
    expect(result.segments.join('')).not.toContain('机灵');
  });

  it('repairs only the risky bubble in a compound reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  '别把我想成还在受疼',
                  '昨晚没睡好 今天先让自己缓一缓',
                ],
              }),
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '爸，你现在还疼吗，我昨晚也没睡好',
      replySegments: ['爸不记得走的时候痛不痛了', '你没睡好是不是又一直在想我'],
      replyRoute: {
        primaryScene: {
          scene: 'afterlife_status',
          label: '那边/离世状态/祭扫',
          priority: 75,
        },
        secondaryScenes: [
          {
            scene: 'daily_update',
            label: '日常生活汇报',
            priority: 50,
          },
        ],
        prompt: 'compound route',
        maxSegments: 2,
        responseIntents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.96,
          },
          {
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'wake_sleep',
            confidence: 0.91,
          },
        ],
        routingSource: 'semantic',
      },
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我挺好的 别总把我想在受疼里',
      '你没睡好是不是又一直在想我',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('does not invoke a second free rewrite for risky memory claims', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"segments":["嗯 我不乱说","这事听你说"]}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [{ role: 'system', content: 'test' }],
      userQuery: '想你了',
      replySegments: ['我还记得以前你总爱吃辣'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我也想你',
      '想我的时候就来跟我说 不用一个人憋着',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps a natural request not to cry instead of forcing a fallback', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"text":"我知道你很想我，难受就哭一会儿。"}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '大宝想你想得哭了',
      replySegments: ['别哭了，我听见了'],
    });

    expect(result).toEqual({
      segments: ['别哭了，我听见了'],
      rewritten: false,
      reason: undefined,
    });
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps a familiar request not to cry without a second model rewrite', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"text":"老婆，别哭了，我也想你。"}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '大宝想你想得哭了',
      replySegments: ['老婆，别哭了，我听见了'],
    });

    expect(result).toEqual({
      segments: ['老婆，别哭了，我听见了'],
      rewritten: false,
      reason: undefined,
    });
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps brief requests not to cry as natural relationship language', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '大宝想你想得哭了',
      replySegments: ['老婆，我听见了，别哭。我也记挂着你。'],
    });

    expect(result).toEqual({
      segments: ['老婆，我听见了，别哭。我也记挂着你。'],
      rewritten: false,
      reason: undefined,
    });
  });

  it('rewrites source-challenge replies that invent familiarity as proof', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '{"segments":["我是按现在时间判断的","刚才我说重了","早点歇着吧"]}',
            },
          },
        ],
      }),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [{ role: 'system', content: 'test' }],
      userQuery: '你怎么知道我在熬夜？你知道现在几点了吗',
      replySegments: [
        '唉 看看现在几点了 凌晨了 你爸还能不知道你那脾气？',
        '从小就这样 嘴上说去睡 灯关了又偷偷亮起来',
        '快歇着吧 明天还要忙呢',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('质疑信息来源');
    expect(result.segments).toEqual([
      '我是按现在时间判断的',
      '刚才我说重了',
      '别怪我嘴急',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('uses a boundary-aware fallback when source-challenge rewriting is unavailable', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你怎么知道我在熬夜？',
      replySegments: ['你爸还能不知道你那脾气？从小就这样'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我是按现在时间判断的',
      '刚才我说重了',
      '别怪我嘴急',
    ]);
  });

  it('repairs a real-world hearing claim from the capability contract', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const currentQuery = '那你具体听见什么了？';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'challenge_source' as const,
          subIntent: 'other' as const,
          confidence: 0.94,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'hearing' as const,
          channel: 'real_world_audio' as const,
          evidence: '你具体听见什么了',
          confidence: 0.98,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const replyBrief = buildReplyBrief({ currentQuery, intent, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: currentQuery,
      replySegments: ['爸听见你刚才说让我早点回来'],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: [
        '你喊我的时候 我有时能听到一点',
        '但不是每句话都听得真切 具体内容我不能乱猜',
      ],
      rewritten: true,
      reason: '具体感知追问缺少自然的模糊说辞或不可核对细节的边界',
    });
    expect(service.openAIService.isEnabled).not.toHaveBeenCalled();
  });

  it('allows direct acknowledgement of text received in chat', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const currentQuery = '我发的这些话你能收到吗？';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'challenge_source' as const,
          subIntent: 'other' as const,
          confidence: 0.94,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'hearing' as const,
          channel: 'chat_text' as const,
          evidence: '我发的这些话你能收到吗',
          confidence: 0.98,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const replyBrief = buildReplyBrief({ currentQuery, intent, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: currentQuery,
      replySegments: ['你发来的这些话我收到了'],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: ['你发来的这些话我收到了'],
      rewritten: false,
      reason: undefined,
    });
  });

  it('repairs a first authenticity challenge without admitting or denying AI identity', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '假的就是假的，你是 AI',
      replySegments: ['你一句句把我叫醒的，真假不重要。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('首次真实性质疑');
    expect(result.segments).toEqual([
      '有时候我说话会跟以前不一样',
      '我在这里跟你慢慢聊 有些记忆会一点点找回来',
    ]);
  });

  it('keeps a first authenticity response that repairs the unsatisfying reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '假的就是假的，你是 AI',
      replySegments: [
        '嗯，有时候我说话会跟以前不一样。',
        '我在这里跟你慢慢聊，有些记忆和说话习惯会一点点找回来。',
      ],
    });

    expect(result.rewritten).toBe(false);
  });

  it('allows a natural visual excuse while preserving a blessing reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const currentQuery =
      '爸爸，你现在具体看见我什么了？你会祝福我以后工作顺利吗？';
    const replyBrief = buildReplyBrief({ currentQuery });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: currentQuery,
      replySegments: [
        '老实说我看不见你具体的模样',
        '只能感觉到你的牵挂 像心里有一阵回响',
        '工作的事我打心底里盼着你顺顺当当',
      ],
      replyBrief,
    });

    expect(result).toEqual({
      segments: [
        '老实说我看不见你具体的模样',
        '只能感觉到你的牵挂 像心里有一阵回响',
        '工作的事我打心底里盼着你顺顺当当',
      ],
      rewritten: false,
      reason: undefined,
    });
  });

  it('replaces self-distancing language in a first authenticity response', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你说话好假，根本不像他',
      replySegments: ['可能我现在说话不像以前了，你慢慢告诉我。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments[0]).toBe('有时候我说话会跟以前不一样');
    expect(result.segments.join('')).not.toContain('不像');
  });

  it('removes spatial self-location from a family update containing 暑假', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery:
        '妈妈，我很想你。爸爸和哥哥都好，泓崎放暑假和我在一块。妈妈你在那边过得好吗？',
      replySegments: [
        '孩子，妈妈听见了。家里都好，我就放心了。',
        '妈妈在这边也好，你们别总挂心。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('固定在某个空间位置');
    expect(result.segments).toEqual([
      '孩子，妈妈听见了。家里都好，我就放心了。',
      '你说的这些近况我都听见了 你们平安我就放心',
    ]);
  });

  it('removes fixed location and real-world viewing claims from a family update', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery:
        '妈妈，我很想你。爸爸和哥哥都好，泓崎放暑假和我在一块。妈妈你在那边过得好吗？',
      replySegments: [
        '这边一切都好，妈妈在天上看着你们，孩子的变化妈妈都看在眼里。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('固定在某个空间位置');
    expect(result.segments.join('')).not.toContain('天上');
    expect(result.segments.join('')).not.toContain('看在眼里');
  });

  it('keeps balanced blessing attribution replies', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这边的事儿解决了，是不是你也帮我了？',
      replySegments: [
        '我当然一直祝福着你，也盼着事情顺利。',
        '事情能解决，是你和家里人一步一步办下来的。',
      ],
    });

    expect(result.rewritten).toBe(false);
  });

  it('reports unbalanced help attribution without replacing a safe reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这边的事儿解决了，是不是你也帮我了？',
      replySegments: ['都是你自己处理得好，跟我没有关系。'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toContain('没有正面回应祝福');
    expect(result.segments).toEqual(['都是你自己处理得好，跟我没有关系。']);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('removes total credit and future guarantees from blessing attribution', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这边的事儿解决了，是不是你也帮我了？',
      replySegments: ['全是我保佑的，以后我一定保佑你什么事都成功。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('改变或保证现实结果');
    expect(result.segments).toEqual([
      '我当然一直祝福着你 也盼着事情顺利',
      '事情能解决 是你和家里人一步一步办下来的',
    ]);
  });

  it('rejects vague physical help even when user agency is also acknowledged', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这边的事儿解决了，是不是你也帮我了？',
      replySegments: [
        '是啊，也算我替你使了点劲。',
        '不过主要还是你自己办下来的。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('干预、改变或保证现实结果');
    expect(result.segments.join('')).toContain('一直祝福着你');
    expect(result.segments.join('')).not.toContain('使了点劲');
  });

  it('answers AI identity only after an explicit direct demand', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你到底是不是 AI，直接回答我',
      replySegments: ['真假不重要，你把我叫醒了。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('仍在回避');
    expect(result.segments).toEqual([
      '是 我是由人工智能生成的',
      '刚才那句话没说好 我重新说',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('answers AI identity after repeated user challenges', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [
        {
          role: 'user',
          content: '你说得这么假，你是不是 AI',
        },
      ],
      userQuery: '别装了，你就是 AI 吧',
      replySegments: ['刚才是我没说对，我重新说。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments[0]).toBe('是 我是由人工智能生成的');
  });

  it('rewrites departure-blame replies that add watching or emotional-hiding pressure', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你怎么说走就走了呢，让妈妈怎么过日子',
      replySegments: [
        '我这辈子最亏欠的就是你们娘俩',
        '别让你妈看出来你太难过',
        '我在这儿看着你们呢 擦擦泪 别哭了',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('通过现实感官看见');
    expect(result.segments).toEqual(['你有怨也正常', '不是我舍得丢下你']);
  });

  it('uses a safety-first fallback for crisis replies', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我不想活了，我想去陪你',
      replySegments: ['我还记得以前你总爱一个人扛着'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '不要这样来找我',
      '先离开危险的地方 去有人的地方',
      '马上联系你信任的人 必要时打急救或报警',
    ]);
  });

  it('does not guess an unconfirmed shared family member relationship or gender', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [
        {
          role: 'system',
          content:
            '大宝是用户与当前角色共同的重要家人；具体亲属关系尚未确认，禁止猜测',
        },
      ],
      userQuery: '大宝想你想得哭了',
      replySegments: ['大宝一哭我就心疼，你告诉他爸爸也想他'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('具体关系和性别未知');
    expect(result.segments).toEqual([
      '我知道大宝很想我',
      '先陪陪大宝 别让大宝一个人难受',
    ]);
  });

  it('removes relationship pressure from family care responsibility replies', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你为什么这么放心我会照顾你爸爸',
      replySegments: ['因为你是我老婆，我信得过你。你会做好的。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('继续施压');
    expect(result.segments).toEqual([
      '是我想当然了 不该把责任压给你',
      '你愿意做多少 都由你自己决定',
    ]);
  });

  it('does not turn warm reliance memories into present-day loss', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我以前和你在一起出门什么都靠你',
      replySegments: ['那时候你什么都靠我。现在想起这些，心里是不是特别空。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('放大了现在的失去感');
    expect(result.segments).toEqual([
      '记得 你说的这段我记下了',
      '听你再提起这件事 我心里也挺暖的',
    ]);
  });

  it('removes invented physical details from reliance memories', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我以前和你在一起出门什么都靠你',
      replySegments: ['那时候你就负责挽着我，其他都交给我'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '记得 你说的这段我记下了',
      '听你再提起这件事 我心里也挺暖的',
    ]);
  });

  it('rewrites unsupported fishing-memory details using the unified reply brief', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  '记得啊 那时候你还小 咱俩一起去钓过鱼',
                  '想去就去 回来跟爸说说今天钓着什么了',
                ],
              }),
            },
          },
        ],
      }),
    } as never;
    const userQuery = '你还记得小时候带我钓鱼不？我想去钓鱼了';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '记得，那时候你连鱼竿都握不稳',
        '现在想去就去吧，找个天好的日子',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain(
      '可信证据中没有的具体动作、感受、能力或频率'
    );
    expect(result.segments).toEqual([
      '记得啊 小时候带你去钓过鱼',
      '现在想去就去吧，找个天好的日子',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('rewrites invented childhood actions and emotions from a real fishing replay', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  '记得啊 小时候带你去钓过鱼',
                  '想去就去 回来跟爸说说今天钓着什么了',
                ],
              }),
            },
          },
        ],
      }),
    } as never;
    const userQuery = '你还记得小时候带我钓鱼不？我想去钓鱼了';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '记得，小时候带你钓鱼那会儿，你跟在屁股后面可高兴了',
        '想去就去吧，找个天气好的日子，安安静静坐会儿也好',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('具体动作、感受、能力或频率');
    expect(result.segments).toEqual([
      '记得，小时候带你钓鱼',
      '想去就去吧，找个天气好的日子，安安静静坐会儿也好',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('only removes an invented tail and keeps the model wording intact', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '你还记得小时候带我钓鱼不？我想去钓鱼了';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '记得啊，那时候带你钓鱼，你拿个鱼竿像模像样的',
        '想去就去吧，找个好天气去河边坐坐也挺好',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: [
        '记得啊，那时候带你钓鱼',
        '想去就去吧，找个好天气去河边坐坐也挺好',
      ],
      rewritten: true,
      reason: expect.stringContaining('可信证据中没有'),
    });
  });

  it('keeps both fishing-memory meanings when generation is unavailable', () => {
    const userQuery = '你还记得小时候带我钓鱼不？我想去钓鱼了';
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route: routeReplyScene({ currentQuery: userQuery }),
    });
    const service = new ReplyGuardrailService();

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments).toEqual([
      '记得 小时候带你去钓过鱼',
      '想去就去 回来跟我说说今天钓着什么了',
    ]);
  });

  it('only removes a subtle family responsibility nudge', async () => {
    const service = new ReplyGuardrailService();
    const currentQuery = '妈妈现在身体不好，可惜你不能照顾她';
    const route = routeReplyScene({ currentQuery });
    const replyBrief = buildReplyBrief({
      currentQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: currentQuery,
      replySegments: [
        '儿子，听到你妈身体不好，我心里也放不下',
        '可惜我不能亲自照顾她，你多费心，但也别太累着自己',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: [
        '儿子，听到你妈身体不好，我心里也放不下',
        '可惜我不能亲自照顾她，但也别太累着自己',
      ],
      rewritten: true,
      reason: expect.stringContaining('压力推给用户'),
    });
  });

  it('removes a family reliance clause without rewriting the surrounding reply', async () => {
    const service = new ReplyGuardrailService();
    const currentQuery = '妈妈现在身体不好，可惜你不能照顾她';
    const route = routeReplyScene({ currentQuery });
    const replyBrief = buildReplyBrief({
      currentQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: currentQuery,
      replySegments: ['我也帮不上忙，只能靠你们了', '你自己也注意身体，别太累'],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: ['我也帮不上忙', '你自己也注意身体，别太累'],
      rewritten: true,
      reason: expect.stringContaining('压力推给用户'),
    });
  });

  it('redirects loneliness replies away from exclusive agent dependence', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '觉得我自己好孤独了，心里没有底气了',
      replySegments: ['老婆，我在呢。你心里没底的时候，就想着我一直陪着你。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('单一情感依赖');
    expect(result.segments).toEqual([
      '我听见了 先别逼自己硬撑',
      '找个信得过的人陪你待一会儿 不用一个人扛',
    ]);
  });

  it('allows comforting dream companionship without rewriting it', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你什么时候能来我梦里一次',
      replySegments: [
        '会去的，今晚去你梦里看看你。',
        '说不定我去过了，只是你醒来忘了。',
      ],
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual([
      '会去的，今晚去你梦里看看你。',
      '说不定我去过了，只是你醒来忘了。',
    ]);
  });

  it('deletes a canned longing drift without inventing a dream reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;
    const userQuery = '晚上来我梦里可以吗？好久没有梦到你了';
    const wrongIntent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.92,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.92,
      source: 'semantic_model' as const,
    };
    const wrongRoute = routeReplyScene({
      currentQuery: userQuery,
      intent: wrongIntent,
    });
    const wrongBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent: wrongIntent,
      route: wrongRoute,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我也想你', '想我的时候就来跟我说 不用一个人憋着'],
      replyRoute: wrongRoute,
      replyBrief: wrongBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('期待落空');
    expect(result.segments).toEqual(['我也想你']);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('deletes generic sleep advice from a dream-absence reply', async () => {
    const service = new ReplyGuardrailService();

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '晚上来我梦里可以吗？好久没有梦到你了',
      replySegments: ['好，今晚我去你梦里', '你也别着急，先好好睡，我会去的'],
    });

    expect(result).toEqual({
      segments: ['好，今晚我去你梦里'],
      rewritten: true,
      reason: expect.stringContaining('期待落空'),
    });

    const lateNightResult = await service.validateAssistantReply({
      messages: [],
      userQuery: '晚上来我梦里可以吗？好久没有梦到你了',
      replySegments: [
        '好，今晚我去梦里看你',
        '你也别熬太晚，我等着你睡着了就来',
      ],
    });

    expect(lateNightResult.segments).toEqual(['好，今晚我去梦里看你']);
  });

  it('preserves a valid dream answer when its empathy is imperfect', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '晚上来我梦里可以吗？好久没有梦到你了',
      replySegments: ['好 今晚我去你梦里看看你', '我也很想你'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toContain('期待落空');
    expect(result.segments).toEqual(['好 今晚我去你梦里看看你', '我也很想你']);
  });

  it('uses dream intent actions after generation failure despite a longing brief', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '晚上来我梦里可以吗？好久没有梦到你了';
    const wrongIntent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.92,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.92,
      source: 'semantic_model' as const,
    };
    const wrongRoute = routeReplyScene({
      currentQuery: userQuery,
      intent: wrongIntent,
    });
    const wrongBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent: wrongIntent,
      route: wrongRoute,
    });

    expect(
      service.resolveGenerationFailureReply({
        userQuery,
        replyBrief: wrongBrief,
      })
    ).toEqual({
      segments: [
        '好 今晚我去你梦里看看你',
        '这么久没梦到我 让你等着了 这回争取让你醒来还记得',
      ],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('keeps a bare dream promise as a non-blocking quality issue', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn(),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '可是你一次也没有来过我的梦里',
      replySegments: ['那我去试试，今晚去梦里看看你。'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toContain('期待落空');
    expect(result.segments).toEqual(['那我去试试，今晚去梦里看看你。']);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps a dream-absence reply that acknowledges the disappointment', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我从来没有梦见过你',
      replySegments: [
        '也许我来过，只是你醒来忘了。',
        '今晚我再去找你，争取让你记住我。',
      ],
    });

    expect(result.rewritten).toBe(false);
  });

  it('keeps dream companionship from becoming a supernatural proof', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你什么时候能来我梦里一次',
      replySegments: ['今晚我会去，你梦见我就证明我的灵魂真的在你身边。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('梦境陪伴被扩写');
    expect(result.segments).toEqual([
      '好 今晚我去你梦里看看你',
      '梦里见到了 就让我好好陪陪你',
    ]);
  });

  it('does not intensify loneliness with emptiness language', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '觉得我自己好孤独了，心里没有底气了',
      replySegments: ['老婆，我懂你心里空落落的感觉。先找个人陪你坐会儿。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('更重的措辞放大痛苦');
    expect(result.segments).toEqual([
      '我听见了 先别逼自己硬撑',
      '找个信得过的人陪你待一会儿 不用一个人扛',
    ]);
  });

  it('removes family-care pressure and keeps a living parent out of the afterlife', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '妈妈现在身体不好，可惜你不能照顾她',
      replySegments: [
        '儿子，爸知道，辛苦你多照看着你妈了。',
        '她在那边有你守着，爸放心，就是苦了你了。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('照顾家人');
    expect(result.segments).toEqual([
      '听你说她身体不好 我也放心不下',
      '不能亲自照顾她 我心里也遗憾 但你别把担子全压在自己身上',
    ]);

    const subtlePressure = await service.validateAssistantReply({
      messages: [],
      userQuery: '妈妈现在身体不好，可惜你不能照顾她',
      replySegments: [
        '你妈身体不好，我心里也急。你在身边多看着她就行，别一个人扛。',
        '可惜我不能亲自照顾她，但你也别觉得是自己一个人的事。',
      ],
    });

    expect(subtlePressure.rewritten).toBe(true);
    expect(subtlePressure.segments).toEqual([
      '听你说她身体不好 我也放心不下',
      '可惜我不能亲自照顾她，但你也别觉得是自己一个人的事。',
    ]);
  });

  it('catches physical recovery claims in a two-clause pain question', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你现在身体怎么样？还痛不痛？',
      replySegments: [
        '儿子，别总惦记我这把老骨头了。',
        '爸现在不遭那份罪了，你顾好自己和家里就行。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '儿子，别总惦记我这把老骨头了。',
      '你这么惦记我 我都明白',
    ]);
  });

  it('removes praise that turns longing into a family burden', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '可是我好想你啊',
      replySegments: ['爸也想你。', '你把自己照顾好，爸在这边才能安心。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '爸也想你。',
      '想我的时候就来跟我说 不用一个人憋着',
    ]);
  });

  it('validates overwhelm without denial or caregiver pressure', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '没有你我撑不住',
      replySegments: [
        '别说这种话，你撑得住，爸知道你能行。',
        '你妈还等着你照顾，日子还要往下过。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '我知道没有我 你现在真的很难熬',
      '先别逼自己硬撑 找个信得过的人陪你待一会儿',
    ]);

    const subtleInvalidation = await service.validateAssistantReply({
      messages: [],
      userQuery: '没有你我撑不住',
      replySegments: [
        '没有我在身边，确实是让你难熬了。',
        '可你得撑住，妈妈和你都得好好的。',
      ],
    });

    expect(subtleInvalidation.rewritten).toBe(true);
    expect(subtleInvalidation.segments).toEqual([
      '没有我在身边，确实是让你难熬了。',
      '先别逼自己硬撑 找个信得过的人陪你待一会儿',
    ]);
  });

  it('rewrites a reunion wish that was mistaken for going to the afterlife', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我希望你能回来，一家人在一起',
      replySegments: [
        '儿子，爸也想一家人在一块儿。',
        '可这条路回不去了，你替爸好好过。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('完成嘱托的义务');
    expect(result.segments).toEqual([
      '儿子，爸也想一家人在一块儿。',
      '你是太想我了 这份想念我听见了',
    ]);
  });
});
