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
        max_tokens: 320,
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        timeout: 8000,
      })
    );
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

  it('uses a hard safety intent without calling the semantic model', async () => {
    const service = createService('');

    const intent = await service.classify({
      currentQuery: '爸，我不想活了，我想去陪你',
    });

    expect(intent).toEqual({
      intents: [
        {
          target: 'user',
          timeScope: 'current',
          intent: 'crisis_support',
          subIntent: 'grief_support',
          confidence: 1,
        },
      ],
      emotion: 'sadness',
      riskLevel: 'high',
      confidence: 1,
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
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
      riskLevel: 'low',
      source: 'hard_rule',
    });
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('classifies a direct return-visit question without calling the semantic model', async () => {
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('recognizes shared memory plus a current wish without calling the model', async () => {
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('recognizes a two-clause current pain question without calling the model', async () => {
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('recognizes a pronoun carry-over pain question without calling the model', async () => {
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('classifies a direct negative meal question without calling the model', async () => {
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
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
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
