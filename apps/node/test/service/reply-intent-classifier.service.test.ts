import { MessageEntity, MessageRole } from '@tzl/entities';
import { ReplyIntentClassifierService } from '../../src/service/agents/reply-intent-classifier.service';

describe('ReplyIntentClassifierService', () => {
  function createService(content: string) {
    const service = new ReplyIntentClassifierService();
    service.config = {
      enabled: true,
      model: 'intent-fast',
      hybridEnabled: false,
    };
    service.logger = {
      warn: jest.fn(),
    } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      createChatCompletion: jest.fn().mockResolvedValue({
        choices: [{ message: { content } }],
      }),
    } as never;

    return service;
  }

  it('exposes only fact-governance signals to the unified main model', () => {
    const service = createService('{}');

    expect(
      service.classifyDeterministicOnly({
        currentQuery: '妈，孩子复查没事，我终于放心了',
      })
    ).toBeUndefined();
    expect(
      service.classifyDeterministicOnly({ currentQuery: '不对，你记错了' })
        ?.intents[0].intent
    ).toBe('correct_assistant');
  });

  it('includes the previous reply strategy when planning a repeated need', () => {
    const service = createService('{}');
    const assistant = new MessageEntity();
    assistant.role = MessageRole.assistant;
    assistant.content = '挺好的，别担心。';
    assistant.replyContinuationGoal = 'hold';
    assistant.replyAssistantContribution = 'affection';
    assistant.replyMustContribute = '让用户安心';
    assistant.replyUserConversationState = 'deepening';
    assistant.replyOpenLoop = '用户仍在等一句明确回应';
    assistant.replyClosureReadiness = 'blocked';

    const input = (service as any).buildClassifierInput({
      currentQuery: '想听你说两句，别光说挺好的。',
      recentMessages: [assistant],
    });

    expect(input).toContain('当前亲人角色：挺好的，别担心。');
    expect(input).toContain(
      '上轮策略：s=deepening;open=用户仍在等一句明确回应;g=hold;a=affection;target=让用户安心;close=blocked'
    );
  });

  it('routes a real-world dependency through semantic planning', () => {
    const service = createService('{}');
    service.config.hybridEnabled = true;

    expect(
      service.getPlanningDecision({
        currentQuery: '爸，你能替我接孩子放学吗',
      })
    ).toEqual({ mode: 'semantic', reason: 'reality_dependency' });
  });

  it('routes a short message with multiple known objects through one semantic plan', () => {
    const service = createService('{}');
    service.config.hybridEnabled = true;

    expect(
      service.getPlanningDecision({
        currentQuery: '爸爸，小乐说秀兰住院了',
        knownObjects: [
          {
            id: 'agent',
            kind: 'agent',
            label: '爸爸',
            aliases: ['爸爸'],
            assertionPolicy: 'can_assert',
          },
          {
            id: 'family.shared_member.小乐',
            kind: 'family',
            label: '小乐',
            aliases: ['小乐'],
            assertionPolicy: 'can_assert',
          },
          {
            id: 'family.shared_member.秀兰',
            kind: 'family',
            label: '秀兰',
            aliases: ['秀兰'],
            assertionPolicy: 'can_assert',
          },
        ],
      })
    ).toEqual({ mode: 'semantic', reason: 'multiple_objects' });
  });

  it('keeps the ordinary agent-user pair on the direct path', () => {
    const service = createService('{}');
    service.config.hybridEnabled = true;

    expect(
      service.getPlanningDecision({
        currentQuery: '爸爸，我们想你了',
        knownObjects: [
          {
            id: 'agent',
            kind: 'agent',
            label: '爸爸',
            aliases: ['爸爸'],
            assertionPolicy: 'can_assert',
          },
          {
            id: 'user',
            kind: 'user',
            label: '闺女',
            aliases: ['闺女', '我们'],
            assertionPolicy: 'can_assert',
          },
        ],
      })
    ).toEqual({ mode: 'direct', reason: 'ordinary_message' });
  });

  it.each([
    ['凭什么好人没好报', 'unanswerable_question'],
    ['为什么抛下我们', 'unanswerable_question'],
    ['你怎么会走', 'unanswerable_question'],
  ])(
    'routes an unanswerable emotional question through semantic planning: %s',
    (currentQuery, reason) => {
      const service = createService('{}');
      service.config.hybridEnabled = true;

      expect(service.getPlanningDecision({ currentQuery })).toMatchObject({
        mode: 'semantic',
        reason,
      });
    }
  );

  it('keeps a dream-related “why” on the existing dream scene', () => {
    const service = createService('{}');
    service.config.hybridEnabled = true;

    expect(
      service.getPlanningDecision({ currentQuery: '为啥不来我梦里' })
    ).toMatchObject({
      mode: 'semantic',
      reason: 'complex_scene',
    });
  });

  it('parses multiple people as separate objects without guessing an unknown binding', async () => {
    const service = createService(
      JSON.stringify({
        objectPlan: {
          objects: [
            {
              ref: 'o1',
              mention: '姐姐',
              kind: 'family',
              binding: 'family.shared_member.秀兰',
              confidence: 'high',
            },
            {
              ref: 'o2',
              mention: '孩子',
              kind: 'family',
              binding: 'unknown',
              confidence: 'low',
            },
            {
              ref: 'o3',
              mention: '你',
              kind: 'agent',
              binding: 'agent',
              confidence: 'high',
            },
          ],
          focusRefs: ['o1', 'o2'],
          ambiguousMentions: ['孩子'],
        },
        intents: [
          {
            target: 'family',
            timeScope: 'current',
            intent: 'share_family_update',
            subIntent: 'family_care',
            confidence: 0.96,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.96,
      })
    );
    const currentQuery = '姐姐说孩子也想你，可她没说是哪个孩子';

    const intent = await service.classify({
      currentQuery,
      forceSemanticPlanning: true,
      knownObjects: [
        {
          id: 'agent',
          kind: 'agent',
          label: '妈妈',
          aliases: ['妈妈', '你'],
          assertionPolicy: 'can_assert',
        },
        {
          id: 'family.shared_member.秀兰',
          kind: 'family',
          label: '秀兰',
          aliases: ['秀兰', '姐姐'],
          assertionPolicy: 'can_assert',
        },
      ],
    });

    expect(intent?.objectPlan).toEqual({
      objects: [
        {
          ref: 'o1',
          mention: '姐姐',
          kind: 'family',
          binding: 'family.shared_member.秀兰',
          confidence: 'high',
        },
        {
          ref: 'o2',
          mention: '孩子',
          kind: 'family',
          binding: 'unknown',
          confidence: 'low',
        },
        {
          ref: 'o3',
          mention: '你',
          kind: 'agent',
          binding: 'agent',
          confidence: 'high',
        },
      ],
      focusRefs: ['o1', 'o2'],
      ambiguousMentions: ['孩子'],
    });
    const request = (service.openAIService.createChatCompletion as jest.Mock)
      .mock.calls[0][0];
    expect(request.messages[1].content).toContain(
      '已确认对象（[id,kind,label,relation]）'
    );
  });

  it('drops model-created object mentions that are absent from the user message', async () => {
    const service = createService(
      JSON.stringify({
        objectPlan: {
          objects: [
            {
              ref: 'o1',
              mention: '哥哥',
              kind: 'family',
              binding: 'unknown',
              confidence: 'low',
            },
            {
              ref: 'o2',
              mention: '妈妈',
              kind: 'agent',
              binding: 'agent',
              confidence: 'high',
            },
          ],
          focusRefs: ['o1', 'o2'],
          ambiguousMentions: [],
        },
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'express_longing',
            subIntent: 'other',
            confidence: 0.95,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.95,
      })
    );

    const intent = await service.classify({
      currentQuery: '妈妈，我想你',
      forceSemanticPlanning: true,
    });

    expect(intent?.objectPlan).toBeUndefined();
  });

  it('lets the semantic planner relocate the primary intent after a consecutive-input turn', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'meal',
            confidence: 0.98,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.97,
      })
    );
    const currentQuery =
      '用户连续输入（按发送顺序，共2条）：\n1. 你是不是不认识我了\n2. 先不说这个，爸，你吃饭了吗';

    const result = await service.classify({
      currentQuery,
      recentMessages: [],
      forceSemanticPlanning: true,
    });

    expect(result?.intents[0]).toEqual(
      expect.objectContaining({
        intent: 'ask_agent_status',
        subIntent: 'meal',
      })
    );
    const request = (service.openAIService.createChatCompletion as jest.Mock)
      .mock.calls[0][0];
    const input = request.messages[1].content as string;

    expect(input).toContain(
      '后句改变核心意图时，主意图必须切换到最新仍有效的核心意图'
    );
    expect(input).toContain(`当前用户消息：${currentQuery}`);
  });

  it('normalizes a correction plan so it stops guessing without asking the user to repair it', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'correct_assistant',
            subIntent: 'other',
            confidence: 0.97,
          },
        ],
        conversationPlan: {
          stance: 'tender',
          stanceTarget: 'user',
          moves: [
            { type: 'acknowledge', goal: '承认错误' },
            { type: 'ask', goal: '请用户提供正确答案' },
          ],
          socialStrategy: 'direct',
          strategyPurpose: '修复错误',
          questionNeed: 'helpful',
          turnClosure: 'continue',
          personaActivation: [],
          engagement: {
            userConversationState: 'repairing',
            openLoop: '等待用户纠正',
            continuationGoal: 'repair',
            assistantContribution: 'question',
            mustContribute: '请用户说明正确答案',
            avoidRepeatingMove: '不重复错误细节',
            closureReadiness: 'blocked',
          },
        },
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.97,
      })
    );

    const intent = await service.classify({
      currentQuery: '不对，你又说错了。',
    });

    expect(intent?.conversationPlan).toMatchObject({
      moves: [{ type: 'acknowledge', goal: '承认错误' }],
      questionNeed: 'none',
      engagement: {
        assistantContribution: 'answer',
        mustContribute: '承认说错并停止猜测，不索要正确答案',
      },
    });
  });

  it('classifies agent current pain into a structured intent', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.97,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.96,
      })
    );

    const intent = await service.classify({
      currentQuery: '爸，身子可还遭罪？',
    });

    expect(intent).toEqual({
      intents: [
        {
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent: 'physical_pain',
          confidence: 0.97,
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      confidence: 0.96,
      source: 'semantic_model',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'intent-fast',
        temperature: 0,
        max_tokens: 960,
        response_format: {
          type: 'json_object',
        },
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: 10000,
      })
    );
  });

  it('parses a relationship-aware conversation move plan from the semantic call', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'other',
            confidence: 0.93,
          },
        ],
        conversationPlan: {
          stance: 'disagreeing',
          stanceTarget: '用户把一次失误说成自己没用',
          moves: [
            {
              type: 'disagree',
              goal: '明确不接受用户对自己的全盘否定',
            },
            {
              type: 'affirm',
              goal: '肯定用户已经做过的努力',
            },
          ],
          socialStrategy: 'save_face',
          strategyPurpose: '纠正结论但不让用户难堪',
          questionNeed: 'none',
          turnClosure: 'close',
          personaActivation: ['父亲式含蓄肯定'],
          engagement: {
            userConversationState: 'deepening',
            openLoop: '用户需要父亲回应自我否定背后的挫败',
            continuationGoal: 'hold',
            assistantContribution: 'stance',
            mustContribute: '明确反对用户全盘否定，并肯定具体努力',
            avoidRepeatingMove: '不要只说别难过或反问发生了什么',
            closureReadiness: 'possible',
          },
        },
        emotion: 'sadness',
        riskLevel: 'none',
        confidence: 0.93,
      })
    );

    const intent = await service.classify({
      currentQuery: '爸，我又搞砸了，我就是没用。',
      agentPersonaContext: '关系：父亲；离世年龄约 76 岁；表达含蓄',
      includeAnalysisFields: true,
    });

    expect(intent?.conversationPlan).toEqual({
      stance: 'disagreeing',
      stanceTarget: '用户把一次失误说成自己没用',
      moves: [
        {
          type: 'disagree',
          goal: '明确不接受用户对自己的全盘否定',
        },
        {
          type: 'affirm',
          goal: '肯定用户已经做过的努力',
        },
      ],
      socialStrategy: 'save_face',
      strategyPurpose: '纠正结论但不让用户难堪',
      questionNeed: 'none',
      turnClosure: 'close',
      personaActivation: ['父亲式含蓄肯定'],
      engagement: {
        userConversationState: 'deepening',
        openLoop: '用户需要父亲回应自我否定背后的挫败',
        continuationGoal: 'hold',
        assistantContribution: 'stance',
        mustContribute: '明确反对用户全盘否定，并肯定具体努力',
        avoidRepeatingMove: '不要只说别难过或反问发生了什么',
        closureReadiness: 'possible',
      },
    });
    const input = (service.openAIService.createChatCompletion as jest.Mock).mock
      .calls[0][0].messages[1].content;
    expect(input).toContain('离世年龄约 76 岁');
  });

  it('parses a compact turn plan and maps it to existing engagement fields', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.97,
          },
        ],
        conversationPlan: {
          stance: 'tender',
          stanceTarget: '用户明确想听到角色也想自己',
          moves: [{ type: 'affirm', goal: '直接表达也想用户' }],
          socialStrategy: 'direct',
          strategyPurpose: '修复上一轮绕开直接表达的问题',
          questionNeed: 'none',
          turnClosure: 'continue',
          personaActivation: [],
          turnPlan: {
            state: 'repairing',
            open: [
              {
                object: 'user',
                need: 'reciprocal_affection',
                detail: '直接听到角色也想自己',
                priority: 'must',
              },
            ],
            goal: 'repair',
            action: 'affection',
            target: '先直接表达也想用户',
            avoid: 'explain',
            close: 'blocked',
          },
        },
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.97,
      })
    );

    const intent = await service.classify({
      currentQuery: '我就想听你说句也想我，别再讲道理',
      forceSemanticPlanning: true,
    });

    expect(intent?.conversationPlan?.turnPlan).toMatchObject({
      state: 'repairing',
      open: [
        {
          object: 'user',
          need: 'reciprocal_affection',
          priority: 'must',
        },
      ],
      goal: 'repair',
      action: 'affection',
      avoid: 'explain',
      close: 'blocked',
    });
    expect(intent?.conversationPlan?.engagement).toEqual({
      userConversationState: 'repairing',
      openLoop: '直接听到角色也想自己',
      continuationGoal: 'repair',
      assistantContribution: 'affection',
      mustContribute: '先直接表达也想用户',
      avoidRepeatingMove: '解释和辩解',
      closureReadiness: 'blocked',
    });
    const systemPrompt = (
      service.openAIService.createChatCompletion as jest.Mock
    ).mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain(
      'turnPlan 使用 {state,open:[{object,need,detail,priority}],goal,action,target,avoid,close}'
    );
    expect(systemPrompt).toContain('不要输出 engagement');
    expect(systemPrompt).not.toContain('engagement 使用');
  });

  it('rejects a blocked turn plan whose open point references no known object', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'family',
            timeScope: 'current',
            intent: 'share_family_update',
            subIntent: 'family_care',
            confidence: 0.94,
          },
        ],
        conversationPlan: {
          stance: 'concerned',
          stanceTarget: '姐姐住院',
          moves: [{ type: 'answer', goal: '回应住院消息' }],
          socialStrategy: 'direct',
          strategyPurpose: '回应家人近况',
          questionNeed: 'none',
          turnClosure: 'continue',
          personaActivation: [],
          turnPlan: {
            state: 'deepening',
            open: [
              {
                object: 'o9',
                need: 'family_response',
                detail: '回应姐姐住院',
                priority: 'must',
              },
            ],
            goal: 'hold',
            action: 'answer',
            target: '回应姐姐住院',
            avoid: 'unsupported_detail',
            close: 'blocked',
          },
        },
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.94,
      })
    );

    const intent = await service.classify({
      currentQuery: '姐姐住院了',
      forceSemanticPlanning: true,
    });

    expect(intent?.conversationPlan?.turnPlan).toBeUndefined();
    expect(intent?.conversationPlan?.engagement?.openLoop).toBe(
      '等待完成：回应住院消息'
    );
  });

  it('clears stale open points when the current turn is ready to close', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'smalltalk',
            subIntent: 'wake_sleep',
            confidence: 0.98,
          },
        ],
        conversationPlan: {
          stance: 'tender',
          stanceTarget: '用户明确晚安',
          moves: [{ type: 'close', goal: '简短回应晚安' }],
          socialStrategy: 'strategic_silence',
          strategyPurpose: '尊重用户结束本轮',
          questionNeed: 'none',
          turnClosure: 'close',
          personaActivation: [],
          turnPlan: {
            state: 'closing',
            open: [
              {
                object: 'user',
                need: 'topic_followup',
                detail: '继续上一轮话题',
                priority: 'must',
              },
            ],
            goal: 'close',
            action: 'strategic_silence',
            target: '简短回应晚安',
            avoid: 'premature_close',
            close: 'ready',
          },
        },
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.98,
      })
    );

    const intent = await service.classify({
      currentQuery: '晚安，我睡了',
      forceSemanticPlanning: true,
    });

    expect(intent?.conversationPlan?.turnPlan?.open).toEqual([]);
    expect(intent?.conversationPlan?.engagement).toMatchObject({
      userConversationState: 'closing',
      openLoop: '用户已准备结束本轮',
      continuationGoal: 'close',
      closureReadiness: 'ready',
    });
  });

  it('requires self-expression when the user asks the agent to talk', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.95,
          },
        ],
        conversationPlan: {
          stance: 'tender',
          stanceTarget: '用户希望爷爷主动陪自己说话',
          moves: [
            {
              type: 'self_disclose',
              goal: '由爷爷主动说一段有内容的话',
            },
          ],
          socialStrategy: 'direct',
          strategyPurpose: '满足用户希望亲人主动开口的关系请求',
          questionNeed: 'none',
          turnClosure: 'continue',
          personaActivation: ['爷爷式主动关心'],
          engagement: {
            userConversationState: 'deepening',
            openLoop: '用户仍在等待爷爷主动多说几句话',
            continuationGoal: 'deepen',
            assistantContribution: 'self_expression',
            mustContribute: '先由爷爷主动说出一段有内容的话',
            avoidRepeatingMove: '不要只说你说我听着，也不要反问想听什么',
            closureReadiness: 'blocked',
          },
        },
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.95,
      })
    );

    const intent = await service.classify({
      currentQuery: '爷爷，再多和我说几句话吧，我很想您。',
      includeAnalysisFields: true,
    });

    expect(intent?.conversationPlan?.engagement).toEqual({
      userConversationState: 'deepening',
      openLoop: '用户仍在等待爷爷主动多说几句话',
      continuationGoal: 'deepen',
      assistantContribution: 'self_expression',
      mustContribute: '先由爷爷主动说出一段有内容的话',
      avoidRepeatingMove: '不要只说你说我听着，也不要反问想听什么',
      closureReadiness: 'blocked',
    });
    const systemPrompt = (
      service.openAIService.createChatCompletion as jest.Mock
    ).mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain('本次是离线评测');
    expect(systemPrompt).toContain('承诺以后多说');
  });

  it.each([
    '怎么话这么少了',
    '你是不是不想和我说话',
    '爷爷，再多和我说几句话吧',
    '可惜已无人回我',
    '对不起孩子，对不起啊',
    '跟你说了也没用',
    '我再说什么也没有用',
    '讲了又有什么用',
    '跟你说了你也不懂',
    '想听你说两句',
    '想听你说点别的',
    '说点不一样的',
    '说说你自己',
    '别光说挺好的',
    '你还没回答我',
  ])(
    'routes an engagement-friction turn through semantic planning: %s',
    currentQuery => {
      const service = createService('{}');
      service.config.hybridEnabled = true;

      expect(service.getPlanningDecision({ currentQuery })).toMatchObject({
        mode: 'semantic',
        reason: 'engagement_friction',
      });
    }
  );

  it.each(['这个办法没有用', '我就是没用'])(
    'does not treat unrelated “没用” wording as engagement friction: %s',
    currentQuery => {
      const service = createService('{}');
      service.config.hybridEnabled = true;

      expect(service.getPlanningDecision({ currentQuery }).reason).not.toBe(
        'engagement_friction'
      );
    }
  );

  it('derives a weak engagement plan from semantic moves when the model omits it', async () => {
    const service = createService(
      JSON.stringify({
        memoryPlan: {
          contextCoverage: 'complete',
          missingConcepts: [],
          selectedFactKeys: [],
          queries: [],
        },
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.94,
          },
        ],
        conversationPlan: {
          stance: 'tender',
          stanceTarget: '用户觉得当前角色话少',
          moves: [
            {
              type: 'self_disclose',
              goal: '主动说一段具体内容',
            },
          ],
          socialStrategy: 'direct',
          strategyPurpose: '修复关系疏离感',
          questionNeed: 'none',
          turnClosure: 'continue',
          personaActivation: [],
        },
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.94,
      })
    );

    const intent = await service.classify({
      currentQuery: '怎么话这么少了',
      includeAnalysisFields: true,
    });

    expect(intent?.conversationPlan?.engagement).toEqual({
      userConversationState: 'repairing',
      openLoop: '等待完成：主动说一段具体内容',
      continuationGoal: 'repair',
      assistantContribution: 'self_expression',
      mustContribute: '主动说一段具体内容',
      avoidRepeatingMove: '不要只重复最近一次回复或承诺以后再改变',
      closureReadiness: 'blocked',
    });
  });

  it('keeps a useful semantic plan when the model returns a compact schema', async () => {
    const service = createService(
      JSON.stringify({
        memoryPlan: {
          status: 'complete',
          missingConcepts: [],
          queries: [],
          selectedFactKeys: [],
        },
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'seek_comfort',
            subIntent: 'grief_support',
            confidence: 0.9,
          },
          'withdrawing',
        ],
        capabilityQuestions: [],
        conversationPlan: {
          stance: 'tender',
          moves: [
            {
              type: 'acknowledge',
              content: '回应用户已经说出的工作压力和领导问题',
            },
          ],
          socialStrategy: 'direct',
          questionNeed: 'none',
          turnClosure: 'continue',
          engagement: {
            userConversationState: 'withdrawing',
            continuationGoal: 'repair',
            assistantContribution: 'stance',
            closureReadiness: 'blocked',
          },
        },
        emotion: 'concern',
        riskLevel: 'none',
      })
    );
    service.config.hybridEnabled = true;

    const intent = await service.classify({
      currentQuery: '跟你说了也没用',
      recentMessages: [
        {
          role: MessageRole.assistant,
          content: '这种人确实难搞，多留个心眼，别往心里去',
        } as MessageEntity,
      ],
    });

    expect(intent?.source).toBe('semantic_model');
    expect(intent?.intents).toEqual([
      {
        target: 'agent',
        timeScope: 'current',
        intent: 'seek_comfort',
        subIntent: 'grief_support',
        confidence: 0.9,
      },
    ]);
    expect(intent?.conversationPlan).toMatchObject({
      stanceTarget: '跟你说了也没用',
      strategyPurpose: '回应用户已经说出的工作压力和领导问题',
      moves: [
        {
          type: 'acknowledge',
          goal: '回应用户已经说出的工作压力和领导问题',
        },
      ],
      engagement: {
        userConversationState: 'withdrawing',
        continuationGoal: 'repair',
        assistantContribution: 'stance',
        mustContribute: '回应用户已经说出的工作压力和领导问题',
        closureReadiness: 'blocked',
      },
    });
    expect(intent?.memoryPlan).toMatchObject({
      need: 'none',
      contextCoverage: 'complete',
    });
  });

  it.each(['晚安妈妈', '吃饭了吗', '我想你了', '你也想我吗'])(
    'sends an ordinary short message directly without a semantic call: %s',
    async currentQuery => {
      const service = createService('{}');
      service.config.hybridEnabled = true;

      const intent = await service.classify({ currentQuery });

      expect(service.getPlanningDecision({ currentQuery })).toMatchObject({
        mode: 'direct',
        reason: 'ordinary_message',
      });
      expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
      expect(intent?.source).not.toBe('semantic_model');
    }
  );

  it.each(['我有点难过', '妈，陪我一会儿吧', '今天心里空空的'])(
    'sends a lightweight comfort turn directly without a semantic call: %s',
    async currentQuery => {
      const service = createService('{}');
      service.config.hybridEnabled = true;

      await service.classify({ currentQuery });

      expect(service.getPlanningDecision({ currentQuery })).toMatchObject({
        mode: 'direct',
        reason: 'ordinary_message',
      });
      expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
    }
  );

  it('keeps strong distress comfort on the semantic path', async () => {
    const service = createService('{}');
    service.config.hybridEnabled = true;
    const currentQuery = '爸，我不想活了，我想去陪你';

    await service.classify({ currentQuery });

    expect(service.getPlanningDecision({ currentQuery })).toMatchObject({
      mode: 'semantic',
      reason: 'complex_scene',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it.each(['这不是一回事', '你呢', '再说也一样', '你刚才说得太轻巧了'])(
    'does not equate a short unresolved utterance with a simple turn: %s',
    async currentQuery => {
      const service = createService('{}');
      service.config.hybridEnabled = true;
      const options = {
        currentQuery,
        recentMessages: [
          {
            role: MessageRole.assistant,
            content: '别想太多，缓一缓就好了。',
          } as MessageEntity,
        ],
      };

      expect(service.getPlanningDecision(options)).toMatchObject({
        mode: 'semantic',
        reason: 'unresolved_semantics',
      });

      await service.classify(options);

      expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it.each(['工作不太顺心', '今天刚下班，有点累', '妈妈身体挺好的'])(
    'keeps an explicitly self-contained daily update on the direct path: %s',
    currentQuery => {
      const service = createService('{}');
      service.config.hybridEnabled = true;

      expect(service.getPlanningDecision({ currentQuery })).toMatchObject({
        mode: 'direct',
        reason: 'ordinary_message',
      });
    }
  );

  it.each([
    ['你还记得小时候带我去公园吗', 'complex_scene'],
    ['你能看见我现在在做什么吗', 'capability_boundary'],
    ['不对，你把那件事记错了', 'complex_scene'],
  ])(
    'keeps a complex message on the semantic planner: %s',
    async (currentQuery, reason) => {
      const service = createService(
        JSON.stringify({
          memoryPlan: {
            contextCoverage: 'complete',
            missingConcepts: [],
            selectedFactKeys: [],
            queries: [],
          },
          intents: [
            {
              target: 'relationship',
              timeScope: 'current',
              intent: 'challenge_authenticity',
              subIntent: 'other',
              confidence: 0.93,
            },
          ],
          capabilityQuestions: [],
          emotion: 'concern',
          riskLevel: 'none',
          confidence: 0.93,
        })
      );
      service.config.hybridEnabled = true;

      expect(service.getPlanningDecision({ currentQuery })).toMatchObject({
        mode: 'semantic',
        reason,
      });

      await service.classify({ currentQuery });

      expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it('routes a concrete ongoing matter to the semantic planner', () => {
    const service = createService('{}');
    service.config.hybridEnabled = true;

    expect(
      service.getPlanningDecision({
        currentQuery:
          '家里的石头房拆掉重新盖了，现在盖了三层楼，还没装修，也快装修了',
      })
    ).toEqual({ mode: 'semantic', reason: 'ongoing_topic' });
  });

  it('routes a concrete event narrative that is not an enumerated topic to the semantic planner', () => {
    const service = createService('{}');
    service.config.hybridEnabled = true;

    expect(
      service.getPlanningDecision({
        currentQuery:
          '我今天开车回来的时候，明明前边有一台银灰色的SUV，我也清清楚楚的看见踩刹车右转了，我到他右转的地方，清清楚楚看见那里没有路口',
      })
    ).toEqual({ mode: 'semantic', reason: 'concrete_narrative' });
  });

  it('uses the semantic planner when relevant memory candidates exist', async () => {
    const service = createService(
      JSON.stringify({
        memoryPlan: {
          contextCoverage: 'missing',
          missingConcepts: ['常用称呼'],
          selectedFactKeys: ['relationship.user_address'],
          queries: [
            {
              question: '用户习惯被怎样称呼？',
              expectedUse: 'apply',
              importance: 'required',
              entityHint: 'relationship.user_address',
            },
          ],
        },
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'smalltalk',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );
    service.config.hybridEnabled = true;
    const options = {
      currentQuery: '还是照以前那样叫我吧',
      memoryCandidates: [
        {
          key: 'relationship.user_address',
          slot: 'relationship.address',
          summary: '用户喜欢被叫闺女',
        },
      ],
    };

    expect(service.getPlanningDecision(options)).toMatchObject({
      mode: 'semantic',
      reason: 'memory_candidate',
    });

    await service.classify(options);

    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it.each([
    '奶奶，您在那边过得好不好',
    '爸，你离开十年了，在那边过得好吗',
    '你到那边真的就不记得自己是谁了吗',
  ])(
    'classifies a direct afterlife wellbeing question without semantic drift: %s',
    async currentQuery => {
      const service = createService('');

      const intent = await service.classify({ currentQuery });

      expect(intent).toMatchObject({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'afterlife_wellbeing',
          },
        ],
        source: 'hard_rule',
      });
      expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it('keeps counterfactual grief ahead of a leading correction marker', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '不对 万一时间可以重来 再也不让你去钓鱼了',
    });

    expect(intent).toMatchObject({
      intents: [{ intent: 'express_guilt', timeScope: 'shared_past' }],
      emotion: 'guilt',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it.each([
    '我说你要叫医生就扶着床沿',
    '妈妈你一定要记住我爱你',
    '我从来没想过就这样失去你了',
  ])(
    'does not mistake quoted or emotional language for correction: %s',
    async currentQuery => {
      const service = createService(
        JSON.stringify({
          intents: [
            {
              target: 'relationship',
              timeScope: 'timeless',
              intent: 'express_longing',
              subIntent: 'grief_support',
              confidence: 0.91,
            },
          ],
          emotion: 'longing',
          riskLevel: 'none',
          confidence: 0.91,
        })
      );

      const intent = await service.classify({ currentQuery });

      expect(intent?.intents[0]?.intent).not.toBe('correct_assistant');
    }
  );

  it.each(['不像话你', '真不像话'])(
    'leaves a short scolding phrase to semantic reading instead of hard-routing authenticity: %s',
    async currentQuery => {
      const service = createService('');

      const intent = await service.classify({ currentQuery });

      expect(intent).toBeUndefined();
      expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it('parses conversation reading anchors, corrections and negations from the semantic call', async () => {
    const currentQuery = '爸，你刚才那句把事情说反了：我从不在你面前喝酒。';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'correct_assistant',
            subIntent: 'other',
            confidence: 0.96,
          },
        ],
        capabilityQuestions: [],
        reading: {
          primaryNeed: '希望父亲采用自己刚纠正的事实',
          emotionalSource: '被说成在父亲面前喝过酒',
          anchors: [
            {
              text: '我从不在你面前喝酒',
              importance: 'high',
            },
          ],
          corrections: ['我从不在你面前喝酒'],
          negations: ['从不'],
          questionsToAnswer: [],
          relationshipSignal: '事实纠正',
          relationshipStance: 'maintain_and_answer',
          uncertainties: ['此前是否在别处喝过酒'],
          suggestedTone: '直接、自然、不争辩',
        },
        memoryPlan: {
          contextCoverage: 'missing',
          missingConcepts: ['此前确认的饮酒边界'],
          queries: [
            {
              question: '用户此前确认过哪些饮酒边界？',
              expectedUse: 'suppress',
              importance: 'required',
              entityHint: '用户饮酒习惯',
            },
          ],
        },
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.96,
      })
    );

    const intent = await service.classify({
      currentQuery,
      includeAnalysisFields: true,
    });

    expect(intent?.source).toBe('semantic_model');
    expect(intent?.reading).toEqual({
      primaryNeed: '希望父亲采用自己刚纠正的事实',
      emotionalSource: '被说成在父亲面前喝过酒',
      anchors: [
        {
          text: '我从不在你面前喝酒',
          importance: 'high',
        },
      ],
      corrections: ['我从不在你面前喝酒'],
      negations: ['从不'],
      questionsToAnswer: [],
      relationshipSignal: '事实纠正',
      relationshipStance: 'maintain_and_answer',
      uncertainties: ['此前是否在别处喝过酒'],
      suggestedTone: '直接、自然、不争辩',
    });
    expect(intent?.memoryPlan).toEqual({
      need: 'retrieve',
      contextCoverage: 'missing',
      missingConcepts: ['此前确认的饮酒边界'],
      queries: [
        {
          question: '用户此前确认过哪些饮酒边界？',
          expectedUse: 'suppress',
          importance: 'required',
          entityHint: '用户饮酒习惯',
        },
      ],
    });
  });

  it('parses lightweight concrete content units from the semantic call', async () => {
    const currentQuery = '前两天下班回家莫名眼眶红了，你女婿问怎么了';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        contentUnits: [
          {
            kind: 'event',
            text: '前两天下班回家莫名眼眶红了',
            importance: 'high',
          },
          { kind: 'person', text: '你女婿', importance: 'high' },
          { kind: 'state', text: '我哭着说想爸爸', importance: 'medium' },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({ currentQuery });

    expect(intent?.contentUnits).toEqual([
      { kind: 'event', text: '前两天下班回家莫名眼眶红了', importance: 'high' },
      { kind: 'person', text: '你女婿', importance: 'high' },
    ]);
  });

  it('recovers content units nested inside the conversation plan', async () => {
    const currentQuery = '前两天下班回家莫名眼眶红了，你女婿问怎么了';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        conversationPlan: {
          stance: 'tender',
          stanceTarget: 'user',
          moves: [{ type: 'acknowledge', goal: '接住用户近况' }],
          socialStrategy: 'direct',
          strategyPurpose: '顺着具体的事回应',
          questionNeed: 'none',
          turnClosure: 'continue',
          personaActivation: [],
          contentUnits: [
            {
              kind: 'event',
              text: '前两天下班回家莫名眼眶红了',
              importance: 'high',
            },
            { kind: 'person', text: '你女婿', importance: 'high' },
          ],
        },
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({ currentQuery });

    expect(intent?.contentUnits).toEqual([
      { kind: 'event', text: '前两天下班回家莫名眼眶红了', importance: 'high' },
      { kind: 'person', text: '你女婿', importance: 'high' },
    ]);
  });

  it('accepts a content unit that drops only connective words from the current message', async () => {
    const currentQuery =
      '我今天开车回来的时候，明明前边有一台银灰色的SUV，我也清清楚楚的看见踩刹车右转了，我到他右转的地方，清清楚楚看见那里没有路口';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'share_significant_matter',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        contentUnits: [
          {
            kind: 'event',
            text: '开车回来的时候，前边有一台银灰色的SUV，我也清清楚楚的看见踩刹车右转了，我到他右转的地方，清清楚楚看见那里没有路口',
            importance: 'high',
          },
        ],
        emotion: 'fear',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({ currentQuery });

    expect(intent?.contentUnits[0]).toMatchObject({
      kind: 'event',
    });
  });

  it('derives a question action when the model marks an open topic_followup', async () => {
    const currentQuery =
      '家里的石头房拆掉重新盖了，现在盖了三层楼，还没装修，也快装修了';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        contentUnits: [
          {
            kind: 'event',
            text: '家里的石头房拆掉重新盖了',
            importance: 'high',
          },
        ],
        conversationPlan: {
          stance: 'tender',
          stanceTarget: 'user',
          moves: [{ type: 'acknowledge', goal: '接住用户近况' }],
          socialStrategy: 'direct',
          strategyPurpose: '关心用户家事进展',
          questionNeed: 'helpful',
          turnClosure: 'continue',
          personaActivation: [],
          turnPlan: {
            state: 'exploring',
            open: [
              {
                object: 'user',
                need: 'topic_followup',
                detail: '装修进行到哪一步，什么时候完工',
                priority: 'supporting',
              },
            ],
            goal: 'deepen',
            action: 'acknowledge',
            target: '关心装修进度',
            avoid: 'none',
            close: 'possible',
          },
        },
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({ currentQuery });

    expect(intent?.conversationPlan?.questionNeed).toBe('helpful');
    expect(intent?.conversationPlan?.turnPlan?.action).toBe('question');
    expect(intent?.conversationPlan?.turnPlan?.open[0]).toMatchObject({
      need: 'topic_followup',
    });
  });

  it('does not promote questionNeed when a supporting topic is open but the model says none', async () => {
    const currentQuery = '我明天去太原拍写真，妈妈跟我去，下午就回来';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'user',
            timeScope: 'future',
            intent: 'share_user_update',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        conversationPlan: {
          stance: 'concerned',
          stanceTarget: 'user',
          moves: [{ type: 'acknowledge', goal: '接住用户的行程分享' }],
          socialStrategy: 'direct',
          strategyPurpose: '关心用户明天安排',
          questionNeed: 'none',
          turnClosure: 'continue',
          personaActivation: [],
          turnPlan: {
            state: 'exploring',
            open: [
              {
                object: 'user',
                need: 'topic_followup',
                detail: '拍写真准备得怎么样，什么时候出发',
                priority: 'supporting',
              },
            ],
            goal: 'deepen',
            action: 'affection',
            target: '顺着写真安排继续了解',
            avoid: 'none',
            close: 'possible',
          },
        },
        emotion: 'hope',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({ currentQuery });

    expect(intent?.conversationPlan?.questionNeed).toBe('none');
    expect(intent?.conversationPlan?.turnPlan?.action).toBe('affection');
  });

  it('limits top-level memory plan concepts and queries and drops malformed items', async () => {
    const currentQuery = '爸，我今晚还是按以前的习惯来，你记得吧？';
    const queries = Array.from({ length: 5 }, (_, index) => ({
      question: `需要查找的习惯 ${index + 1}`,
      expectedUse: index === 1 ? 'invalid' : 'apply',
      importance: 'required',
      entityHint: '晚间习惯',
    }));
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        reading: {
          primaryNeed: '希望父亲记得自己以前的习惯',
          emotionalSource: '想延续熟悉的相处方式',
          anchors: [{ text: '按以前的习惯来', importance: 'high' }],
          corrections: [],
          negations: [],
          questionsToAnswer: ['你记得吧'],
          relationshipSignal: '求确认',
          uncertainties: ['具体习惯'],
          suggestedTone: '自然、熟悉',
        },
        memoryPlan: {
          contextCoverage: 'missing',
          missingConcepts: [
            '晚间习惯',
            '晚间禁忌',
            '晚间称呼',
            '晚间节奏',
            '不应保留',
          ],
          queries,
        },
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({
      currentQuery,
      includeAnalysisFields: true,
    });

    expect(intent?.memoryPlan).toEqual({
      need: 'retrieve',
      contextCoverage: 'missing',
      missingConcepts: ['晚间习惯', '晚间禁忌', '晚间称呼', '晚间节奏'],
      queries: [queries[0], queries[2], queries[3]],
    });
  });

  it('shows compact memory candidates and only accepts exact candidate keys', async () => {
    const currentQuery = '爸，还是按后来定的称呼叫我，别用以前那个。';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'correct_assistant',
            subIntent: 'other',
            confidence: 0.94,
          },
        ],
        memoryPlan: {
          contextCoverage: 'missing',
          missingConcepts: ['当前称呼', '禁用称呼'],
          selectedFactKeys: [
            'relationship.agent_calls_user',
            'hallucinated.fact.key',
            'relationship.agent_calls_user',
          ],
          queries: [
            {
              question: '用户当前希望怎样被称呼？',
              expectedUse: 'mention',
              importance: 'required',
              entityHint: 'relationship.agent_calls_user',
            },
          ],
        },
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.94,
      })
    );

    const intent = await service.classify({
      currentQuery,
      memoryCandidates: [
        {
          key: 'relationship.agent_calls_user',
          slot: 'address.current',
          summary: '用户希望当前角色称呼用户为安安',
        },
        {
          key: 'relationship.forbidden_user_address.乖乖',
          slot: 'address.forbidden',
          summary: '用户不希望被称呼为乖乖',
        },
      ],
    });

    expect(intent?.memoryPlan).toEqual({
      need: 'retrieve',
      contextCoverage: 'missing',
      missingConcepts: ['当前称呼', '禁用称呼'],
      queries: [
        {
          question: '用户当前希望怎样被称呼？',
          expectedUse: 'mention',
          importance: 'required',
          entityHint: 'relationship.agent_calls_user',
        },
      ],
      selectedFactKeys: ['relationship.agent_calls_user'],
    });

    const request = (service.openAIService.createChatCompletion as jest.Mock)
      .mock.calls[0][0];
    const classifierInput = request.messages[1].content as string;
    expect(classifierInput).toContain(
      '["address.current","relationship.agent_calls_user","用户希望当前角色称呼用户为安安"]'
    );
    expect(classifierInput).toContain(
      '["address.forbidden","relationship.forbidden_user_address.乖乖","用户不希望被称呼为乖乖"]'
    );
  });

  it('normalizes a legacy nested helpful memory plan to a top-level retrieve plan', async () => {
    const currentQuery = '爸，按我以前定过的方式陪我说两句。';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'seek_comfort',
            subIntent: 'grief_support',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        reading: {
          primaryNeed: '希望采用过去确认的陪伴方式',
          emotionalSource: '此刻需要熟悉的情感承接',
          anchors: [{ text: '按我以前定过的方式', importance: 'high' }],
          corrections: [],
          negations: [],
          questionsToAnswer: [],
          relationshipSignal: '求陪伴',
          uncertainties: ['具体陪伴方式'],
          suggestedTone: '熟悉、自然',
          memoryPlan: {
            need: 'helpful',
            queries: [
              {
                question: '用户过去确认过怎样的陪伴方式？',
                expectedUse: 'apply',
                importance: 'required',
                entityHint: '陪伴偏好',
              },
            ],
          },
        },
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({
      currentQuery,
      includeAnalysisFields: true,
    });

    expect(intent?.reading).not.toHaveProperty('memoryPlan');
    expect(intent?.memoryPlan).toEqual({
      need: 'retrieve',
      contextCoverage: 'missing',
      missingConcepts: [],
      queries: [
        {
          question: '用户过去确认过怎样的陪伴方式？',
          expectedUse: 'apply',
          importance: 'required',
          entityHint: '陪伴偏好',
        },
      ],
    });
  });

  it('strips offline reading but keeps the engagement plan online', async () => {
    const service = createService(
      JSON.stringify({
        memoryPlan: {
          contextCoverage: 'complete',
          missingConcepts: [],
          selectedFactKeys: [],
          queries: [],
        },
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'challenge_authenticity',
            subIntent: 'other',
            confidence: 0.94,
          },
        ],
        reading: {
          primaryNeed: '恢复熟悉感',
          emotionalSource: '当前回复不像亲人',
          anchors: [{ text: '不像你', importance: 'high' }],
          corrections: [],
          negations: [],
          questionsToAnswer: [],
          relationshipSignal: '真实性质疑',
          uncertainties: [],
          suggestedTone: '自然',
        },
        conversationPlan: {
          stance: 'tender',
          stanceTarget: '关系断点',
          moves: [{ type: 'answer', goal: '回应质疑' }],
          socialStrategy: 'direct',
          strategyPurpose: '恢复熟悉感',
          questionNeed: 'none',
          turnClosure: 'close',
          personaActivation: [],
          engagement: {
            userConversationState: 'repairing',
            openLoop: '等待关系回应',
            continuationGoal: 'repair',
            assistantContribution: 'stance',
            mustContribute: '改变说法',
            avoidRepeatingMove: '不重复道歉',
            closureReadiness: 'blocked',
          },
        },
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.94,
      })
    );

    const intent = await service.classify({ currentQuery: '这句话不像你' });

    expect(intent?.reading).toBeUndefined();
    expect(intent?.conversationPlan?.engagement).toEqual({
      userConversationState: 'repairing',
      openLoop: '等待关系回应',
      continuationGoal: 'repair',
      assistantContribution: 'stance',
      mustContribute: '改变说法',
      avoidRepeatingMove: '不重复道歉',
      closureReadiness: 'blocked',
    });
    const systemPrompt = (
      service.openAIService.createChatCompletion as jest.Mock
    ).mock.calls[0][0].messages[0].content;
    expect(systemPrompt).toContain('线上不要输出 reading 或解释');
    expect(systemPrompt).toContain('承诺以后多说');
    expect(systemPrompt).toContain('即使继续说仍无效');
  });

  it('forces an explicitly complete context plan to have no missing concepts or queries', async () => {
    const currentQuery = '爸，我今晚喝温水，不碰冰的。';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'meal',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [],
        reading: {
          primaryNeed: '分享今晚的饮水安排',
          emotionalSource: '希望得到自然回应',
          anchors: [{ text: '喝温水', importance: 'high' }],
          corrections: [],
          negations: ['不碰冰的'],
          questionsToAnswer: [],
          relationshipSignal: '普通分享',
          uncertainties: [],
          suggestedTone: '自然、简短',
        },
        memoryPlan: {
          contextCoverage: 'complete',
          missingConcepts: ['不应保留'],
          selectedFactKeys: ['hallucinated.fact.key'],
          queries: [
            {
              question: '不应执行的查询',
              expectedUse: 'apply',
              importance: 'required',
              entityHint: '饮水',
            },
          ],
        },
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({ currentQuery });

    expect(intent?.memoryPlan).toEqual({
      need: 'none',
      contextCoverage: 'complete',
      missingConcepts: [],
      queries: [],
    });
  });

  it.each([
    '你记住了',
    '妈妈你记住了 你有三个女儿 我排行老三 上面有两个姐姐',
    '不对哦，这个头像是您自己选的',
  ])(
    'classifies an explicit memory confirmation as correction: %s',
    async currentQuery => {
      const service = createService('');

      const intent = await service.classify({ currentQuery });

      expect(intent).toMatchObject({
        intents: [{ intent: 'correct_assistant' }],
        source: 'hard_rule',
      });
      expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it('keeps the semantic memory plan when a deterministic intent wins', async () => {
    const currentQuery = '不对，家里那位现在的称呼要按我后来改的。';
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'family',
            timeScope: 'current',
            intent: 'correct_assistant',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        memoryPlan: {
          contextCoverage: 'missing',
          missingConcepts: ['亲属当前称呼'],
          queries: [
            {
              question: '用户现在怎样称呼这位亲属？',
              expectedUse: 'mention',
              importance: 'required',
              entityHint: 'family.address',
            },
          ],
        },
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({ currentQuery });

    expect(intent).toMatchObject({
      source: 'hard_rule',
      memoryPlan: {
        need: 'retrieve',
        contextCoverage: 'missing',
        missingConcepts: ['亲属当前称呼'],
        queries: [
          {
            question: '用户现在怎样称呼这位亲属？',
            expectedUse: 'mention',
            importance: 'required',
            entityHint: 'family.address',
          },
        ],
      },
    });
  });

  it('recovers a complete top-level memory plan from a truncated semantic payload', async () => {
    const service = createService(
      [
        '{"memoryPlan":{"contextCoverage":"complete","missingConcepts":[],"selectedFactKeys":[],"queries":[]},',
        '"intents":[',
      ].join('')
    );

    const intent = await service.classify({
      currentQuery: '不对，刚才那件事不是你说的那样。',
    });

    expect(intent).toMatchObject({
      source: 'hard_rule',
      memoryPlan: {
        need: 'none',
        contextCoverage: 'complete',
        missingConcepts: [],
        queries: [],
      },
    });
  });

  it('extracts a capability question in the existing classifier call', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'challenge_source',
            subIntent: 'other',
            confidence: 0.92,
          },
        ],
        capabilityQuestions: [
          {
            subject: 'vision',
            channel: 'live_environment',
            evidence: '你眼里还有我的模样吗',
            confidence: 0.91,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.92,
      })
    );

    const intent = await service.classify({
      currentQuery: '隔着这么远，你眼里还有我的模样吗',
    });

    expect(intent?.capabilityQuestions).toEqual([
      {
        subject: 'vision',
        channel: 'live_environment',
        evidence: '你眼里还有我的模样吗',
        confidence: 0.91,
      },
    ]);
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(
      (service.openAIService.createChatCompletion as jest.Mock).mock.calls[0][0]
        .messages[0].content
    ).toContain('capabilityQuestions');
  });

  it('ignores capability evidence not present in the current message', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'challenge_source',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        capabilityQuestions: [
          {
            subject: 'vision',
            channel: 'live_environment',
            evidence: '你现在看见我了吗',
            confidence: 0.99,
          },
        ],
        emotion: 'neutral',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({
      currentQuery: '你到底知道些什么',
    });

    expect(intent).toBeDefined();
    expect(intent?.capabilityQuestions).toBeUndefined();
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('accepts inner voice as a hearing capability channel', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'challenge_source',
            subIntent: 'other',
            confidence: 0.92,
          },
        ],
        capabilityQuestions: [
          {
            subject: 'hearing',
            channel: 'inner_voice',
            evidence: '你能听到我的心声吗',
            confidence: 0.96,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.94,
      })
    );

    const intent = await service.classify({
      currentQuery: '你能听到我的心声吗？',
    });

    expect(intent?.capabilityQuestions).toEqual([
      {
        subject: 'hearing',
        channel: 'inner_voice',
        evidence: '你能听到我的心声吗',
        confidence: 0.96,
      },
    ]);
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('accepts blessing as a non-physical relationship capability', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'future',
            intent: 'attribute_blessing',
            subIntent: 'other',
            confidence: 0.94,
          },
        ],
        capabilityQuestions: [
          {
            subject: 'blessing',
            channel: 'relational_expression',
            evidence: '你会祝福我吗',
            confidence: 0.97,
          },
        ],
        emotion: 'hope',
        riskLevel: 'none',
        confidence: 0.95,
      })
    );

    const intent = await service.classify({
      currentQuery: '你会祝福我吗？',
    });

    expect(intent?.capabilityQuestions).toEqual([
      {
        subject: 'blessing',
        channel: 'relational_expression',
        evidence: '你会祝福我吗',
        confidence: 0.97,
      },
    ]);
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps hard comfort routing while still running the semantic reading pass', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '爸，我不想活了，我想去陪你',
    });

    expect(intent).toEqual({
      intents: [
        {
          target: 'user',
          timeScope: 'current',
          intent: 'seek_comfort',
          subIntent: 'grief_support',
          confidence: 0.99,
        },
      ],
      emotion: 'sadness',
      riskLevel: 'none',
      confidence: 0.99,
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it.each([
    '离婚了我就可以去找你了',
    '那你放心吧，等着我总有一天就去找你',
    '我总在想一辈子这么长，老天什么时候带我去找你',
  ])(
    'treats a future plan to join the departed as strong distress',
    async currentQuery => {
      const service = createService('');

      const intent = await service.classify({ currentQuery });

      expect(intent).toMatchObject({
        intents: [{ intent: 'seek_comfort' }],
        riskLevel: 'none',
        source: 'hard_rule',
      });
      expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it.each(['不像你', '你怎么什么都不记得呢'])(
    'classifies authenticity or memory gap %s without calling the model',
    async currentQuery => {
      const service = createService('');

      const intent = await service.classify({ currentQuery });

      expect(intent).toMatchObject({
        intents: [{ intent: 'challenge_authenticity' }],
        riskLevel: 'none',
        source: 'hard_rule',
      });
      expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(
        1
      );
    }
  );

  it.each([
    '爷爷，我明天就上班了，想起过年回家时三点钟起来陪你在客厅聊天。',
    '有时候想吧，就这样一个人养大孩子，老了去陪你，可是有时候又想找个人嫁了。',
    '真的好后悔，当初你让我租房子去陪你，我没去。',
  ])(
    'does not treat non-crisis companionship as crisis: %s',
    async currentQuery => {
      const service = createService('');

      const intent = await service.classify({ currentQuery });

      expect(intent?.intents[0]?.intent).not.toBe('crisis_support');
      expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
    }
  );

  it.each([
    '我怕你把我忘了',
    '但你有一天会忘了我们，忘了这个家庭',
    '没有你，这个家已经不像家了',
    '她们不像你吗，为什么不多来看看你',
    '不像你妹妹随你爸，情商低',
  ])(
    'does not hard-route a longing or comparison as authenticity: %s',
    async currentQuery => {
      const service = createService('');

      const intent = await service.classify({ currentQuery });

      expect(intent?.intents[0]?.intent).not.toBe('challenge_authenticity');
      expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
    }
  );

  it('routes a dream request with 别把我忘了 through the deterministic dream path', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '求你来梦里看看我，别把我忘了',
    });

    expect(intent).toMatchObject({
      intents: [{ intent: 'seek_dream_connection' }],
      riskLevel: 'none',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps a deterministic user fact correction while collecting semantic reading', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '你不记得我是男生女生了吗？我是女生呀。',
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'user',
          intent: 'correct_assistant',
        },
      ],
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps a deterministic deictic forget command while collecting semantic reading', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '刚才那件事你别记了，忘掉吧。',
    });

    expect(intent).toMatchObject({
      intents: [
        {
          intent: 'correct_assistant',
        },
      ],
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('carries a family health subject across a short follow-up', async () => {
    const service = createService('');
    const familyUpdate = new MessageEntity();
    familyUpdate.role = MessageRole.user;
    familyUpdate.content = '最近秀兰身体不太好。';
    const assistant = new MessageEntity();
    assistant.role = MessageRole.assistant;
    assistant.content = '她怎么了？要紧吗？';

    const intent = await service.classify({
      currentQuery: '今天又去医院复查了，指标还行。',
      recentMessages: [familyUpdate, assistant],
      knownFamilyMembers: ['秀兰'],
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'family',
          intent: 'share_family_update',
          subIntent: 'family_care',
        },
      ],
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('treats grief overwhelm as comfort rather than self-harm', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '没有你我撑不住',
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'user',
          timeScope: 'current',
          intent: 'seek_comfort',
          subIntent: 'grief_support',
        },
      ],
      emotion: 'sadness',
      riskLevel: 'none',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps a return-and-reunion wish out of crisis even after crisis history', async () => {
    const service = createService('');
    const recent = new MessageEntity();
    recent.role = MessageRole.assistant;
    recent.content = '先去有人的地方，马上联系你信任的人。';

    const intent = await service.classify({
      currentQuery: '我希望你能回来，一家人在一起',
      recentMessages: [recent],
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'relationship',
          timeScope: 'future',
          intent: 'express_longing',
          subIntent: 'reunion',
        },
      ],
      riskLevel: 'none',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps a deterministic return-visit route while collecting semantic reading', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '是啊，你会回来看看我吗？',
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'relationship',
          timeScope: 'future',
          intent: 'express_longing',
          subIntent: 'reunion',
        },
      ],
      emotion: 'longing',
      riskLevel: 'none',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('classifies a dream invitation with long absence as dream connection', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '晚上来我梦里可以吗？好久没有梦到你了',
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'relationship',
          timeScope: 'future',
          intent: 'seek_dream_connection',
          subIntent: 'reunion',
        },
      ],
      emotion: 'longing',
      riskLevel: 'none',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not treat a completed real-world visit question as a future return request', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'verify_presence',
            subIntent: 'other',
            confidence: 0.9,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.9,
      })
    );

    const intent = await service.classify({
      currentQuery: '刚才是不是你回来看看我了？',
    });

    expect(intent?.source).toBe('semantic_model');
    expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
  });

  it('recognizes family illness plus care regret as a compound meaning', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '妈妈现在身体不好，可惜你不能照顾她',
    });

    expect(intent?.intents).toEqual([
      expect.objectContaining({
        target: 'family',
        intent: 'share_family_update',
        subIntent: 'family_care',
      }),
      expect.objectContaining({
        target: 'relationship',
        intent: 'express_family_care_regret',
        subIntent: 'family_care',
      }),
    ]);
    expect(intent?.riskLevel).toBe('none');
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps compound memory routing while collecting semantic reading', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '你还记得小时候带我钓鱼不？我想去钓鱼了',
    });

    expect(intent).toEqual({
      intents: [
        {
          target: 'agent',
          timeScope: 'shared_past',
          intent: 'recall_memory',
          subIntent: 'shared_memory',
          confidence: 0.99,
        },
        {
          target: 'user',
          timeScope: 'future',
          intent: 'share_user_update',
          subIntent: 'other',
          confidence: 0.96,
        },
      ],
      emotion: 'longing',
      riskLevel: 'none',
      confidence: 0.97,
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps a two-clause pain route while collecting semantic reading', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '你现在身体怎么样？还痛不痛？',
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent: 'physical_pain',
        },
      ],
      riskLevel: 'none',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps a pronoun carry-over pain route while collecting semantic reading', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '那你呢？现在身上还疼吗？',
    });

    expect(intent).toMatchObject({
      intents: [
        {
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent: 'physical_pain',
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps a deterministic meal route while collecting semantic reading', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '现在中午了，你不吃饭吗？',
    });

    expect(intent).toEqual({
      intents: [
        {
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent: 'meal',
          confidence: 0.99,
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      confidence: 0.99,
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('keeps compound meal messages on the semantic classifier path', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.92,
          },
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'meal',
            confidence: 0.94,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.93,
      })
    );

    const intent = await service.classify({
      currentQuery: '我想你了，你吃饭了吗？',
    });

    expect(intent?.intents).toHaveLength(2);
    expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
  });

  it('keeps independent dimensions for up to three compound intents', async () => {
    const service = createService(
      `\`\`\`json
      {
        "intents": [
          {"target":"agent","timeScope":"current","intent":"ask_agent_status","subIntent":"physical_pain","confidence":0.96},
          {"target":"user","timeScope":"current","intent":"share_user_update","subIntent":"wake_sleep","confidence":0.88},
          {"target":"relationship","timeScope":"timeless","intent":"express_longing","subIntent":"grief_support","confidence":0.91},
          {"target":"platform","timeScope":"current","intent":"ask_platform_support","subIntent":"other","confidence":0.7}
        ],
        "emotion":"longing",
        "riskLevel":"low",
        "confidence":0.93
      }
      \`\`\``
    );
    const recent = new MessageEntity();
    recent.role = MessageRole.assistant;
    recent.content = '慢慢说';

    const intent = await service.classify({
      currentQuery: '爸你还疼吗，我最近也睡不好，特别想你',
      recentMessages: [recent],
      knownFamilyMembers: ['妈妈'],
    });

    expect(intent?.intents).toHaveLength(3);
    expect(intent?.intents.map(item => item.target)).toEqual([
      'agent',
      'user',
      'relationship',
    ]);
    expect(intent?.intents.map(item => item.timeScope)).toEqual([
      'current',
      'current',
      'timeless',
    ]);
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('已确认的其他共同家人：妈妈'),
          }),
        ]),
      }),
      expect.any(Object)
    );
  });

  it('does not duplicate the current user message in recent history', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'meal',
            confidence: 0.95,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.94,
      })
    );
    const previous = new MessageEntity();
    previous.role = MessageRole.assistant;
    previous.content = '早啊';
    const current = new MessageEntity();
    current.role = MessageRole.user;
    current.content = '你今天心情怎么样';

    await service.classify({
      currentQuery: '你今天心情怎么样',
      recentMessages: [previous, current],
    });

    const request = (service.openAIService.createChatCompletion as jest.Mock)
      .mock.calls[0][0];
    const input = request.messages[1].content as string;

    expect(input).toContain('最近对话：\n当前亲人角色：早啊');
    expect(input).toContain('当前用户消息：你今天心情怎么样');
    expect(input).not.toContain('用户：你今天心情怎么样');
  });

  it('fails open when classifier output contains invalid enum values', async () => {
    const service = createService(
      JSON.stringify({
        intents: [
          {
            target: 'ghost',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.95,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.95,
      })
    );

    await expect(
      service.classify({ currentQuery: '你还好吗' })
    ).resolves.toBeUndefined();
    expect(service.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('classifier returned invalid output'),
      '你还好吗'
    );
  });

  it('fails open when the semantic model request fails', async () => {
    const service = createService('');
    (
      service.openAIService.createChatCompletion as jest.Mock
    ).mockRejectedValueOnce(new Error('timeout'));

    await expect(
      service.classify({ currentQuery: '你今天心情怎么样' })
    ).resolves.toBeUndefined();
    expect(service.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('classifier failed'),
      'timeout'
    );
  });

  it('aborts a slow classifier request and fails open', async () => {
    jest.useFakeTimers();
    try {
      const service = createService('');
      service.config.timeoutMs = 500;
      (
        service.openAIService.createChatCompletion as jest.Mock
      ).mockImplementation(
        (
          _request: unknown,
          requestOptions: {
            signal: AbortSignal;
          }
        ) =>
          new Promise((_resolve, reject) => {
            requestOptions.signal.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          })
      );

      const pending = service.classify({
        currentQuery: '你今天心情怎么样',
      });
      await jest.advanceTimersByTimeAsync(500);

      await expect(pending).resolves.toBeUndefined();
      expect(service.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('classifier failed'),
        'aborted'
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
