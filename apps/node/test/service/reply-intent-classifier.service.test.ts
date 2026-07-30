import { MessageEntity, MessageRole } from '@tzl/entities';
import { ReplyIntentClassifierService } from '../../src/service/agents/reply-intent-classifier.service';

describe('ReplyIntentClassifierService', () => {
  function createService(content: string) {
    const service = new ReplyIntentClassifierService();
    service.config = {
      enabled: true,
      model: 'intent-fast',
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
        max_tokens: 1320,
        response_format: {
          type: 'json_object',
        },
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: 8000,
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
        },
        emotion: 'sadness',
        riskLevel: 'none',
        confidence: 0.93,
      })
    );

    const intent = await service.classify({
      currentQuery: '爸，我又搞砸了，我就是没用。',
      agentPersonaContext: '关系：父亲；离世年龄约 76 岁；表达含蓄',
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
    });
    const input = (
      service.openAIService.createChatCompletion as jest.Mock
    ).mock.calls[0][0].messages[1].content;
    expect(input).toContain('离世年龄约 76 岁');
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

    const intent = await service.classify({ currentQuery });

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

    const intent = await service.classify({ currentQuery });

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

    const request = (
      service.openAIService.createChatCompletion as jest.Mock
    ).mock.calls[0][0];
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

    const intent = await service.classify({ currentQuery });

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
