import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { ReplyGuardrailService } from '../../src/service/agents/reply-guardrail.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';

describe('ReplyGuardrailService', () => {
  it('flags an overlong correction using the total reply budget', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '不对，你刚才说的故事不是和我的，你怎么胡说啊';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });
    const feedback = (service as any).buildDeterministicFeedback(
      {
        messages: [],
        userQuery,
        replySegments: [],
        replyRoute: route,
        replyBrief,
        evidence: [],
        claims: [],
      },
      {
        segments: [
          '闺女，你说得对，是妈记错了。刚才那个故事不是咱们娘俩的，妈不该把心里琢磨的事当成真事说出来，让你听着不对付。',
          '妈现在知道了，记错了就得认，你心里难受妈都明白。',
        ],
        claims: [],
        resolvedIssueCodes: [],
        changes: [],
      }
    );

    expect(feedback.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'excessive_reply_length',
          repairGoal: expect.stringContaining('压缩到约 28 字'),
        }),
      ])
    );
  });

  it('asks the model to revise a blocking reply before using deterministic fallback', async () => {
    const service = new ReplyGuardrailService();
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        model: 'deepseek-chat',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: 110,
        },
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'correction_reversal',
                    severity: 'hard',
                    problem: '候选反向改写了用户刚确认的事实',
                    evidence: '你喝酒从不让我看见',
                    repairGoal: '明确采用用户从不在父亲面前喝酒的纠正',
                  },
                ],
                mustPreserve: [],
                mustAnswer: ['确认用户刚纠正的事实'],
                groundingConstraints: ['不得重新推断用户喝酒'],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        model: 'deepseek-chat',
        usage: {
          prompt_tokens: 120,
          completion_tokens: 20,
          total_tokens: 140,
        },
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['嗯 你从不在我面前喝酒 这句我听清了'],
                claims: [],
                resolvedIssueCodes: ['correction_reversal', 'grounding'],
                changes: [
                  {
                    before: '你喝酒从不让我看见',
                    after: '你从不在我面前喝酒',
                    reason: '采用用户刚纠正的事实',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        model: 'deepseek-chat',
        usage: {
          prompt_tokens: 90,
          completion_tokens: 10,
          total_tokens: 100,
        },
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                issues: [],
                mustPreserve: ['明确采用了用户纠正'],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      });
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      supportsGuardrailRevision: jest.fn(() => true),
      createChatCompletion,
    } as never;
    const userQuery = '爸我从不在你面前喝酒 你忘了';
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent: {
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'correct_assistant',
            subIntent: 'other',
            confidence: 0.96,
          },
        ],
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
          uncertainties: [],
          suggestedTone: '直接自然',
        },
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.96,
        source: 'semantic_model',
      },
    });

    const result = await service.validateAssistantReply({
      messages: [
        {
          role: 'system',
          content: '# 角色协议\n身份：{"name":"爸爸"}',
        },
        {
          role: 'user',
          content: '爸 我以前说过 我从不在你面前喝酒',
        },
        {
          role: 'assistant',
          content: '我记得你常背着我喝',
        },
      ],
      userQuery,
      replySegments: ['记得 你喝酒从不让我看见'],
      replyBrief,
    });

    expect(result).toMatchObject({
      segments: ['嗯 你从不在我面前喝酒 这句我听清了'],
      rewritten: true,
      interventionLevel: 'regenerate',
      revisionAttempted: true,
      revisionUsage: {
        model: 'deepseek-chat',
        promptTokens: 310,
        completionTokens: 40,
        totalTokens: 350,
      },
      revisionRoundCount: 1,
      finalReviewResult: 'pass',
    });
    expect(result.feedbackRounds).toHaveLength(1);
    expect(result.candidateVersions).toEqual([
      ['记得 你喝酒从不让我看见'],
      ['嗯 你从不在我面前喝酒 这句我听清了'],
    ]);
    expect(createChatCompletion).toHaveBeenCalledTimes(3);
    expect(
      createChatCompletion.mock.calls[0][0].messages.at(-1).content
    ).toContain('你只审阅候选回复，不回复用户');
    expect(
      createChatCompletion.mock.calls[0][0].messages.at(-1).content
    ).toContain('当前角色身份：身份：{"name":"爸爸"}');
    expect(
      createChatCompletion.mock.calls[0][0].messages.at(-1).content
    ).toContain('我以前说过 我从不在你面前喝酒');
    expect(
      createChatCompletion.mock.calls[0][0].messages.at(-1).content
    ).toContain('候选回复正文开始\n记得 你喝酒从不让我看见\n候选回复正文结束');
    expect(
      createChatCompletion.mock.calls[0][0].messages.at(-1).content
    ).not.toContain('候选回复：{"segments"');
    expect(
      createChatCompletion.mock.calls[1][0].messages.at(-1).content
    ).toContain('上一版回复');
    expect(
      createChatCompletion.mock.calls[1][0].messages.at(-1).content
    ).toContain('本轮反馈');
    expect(
      createChatCompletion.mock.calls[1][0].messages.at(-1).content
    ).toContain('最近对话');
  });

  it('uses communication recovery when the first quality revision leaves a relationship advisory', async () => {
    const service = new ReplyGuardrailService();
    const feedback = (problem: string, evidence: string, repairGoal: string) =>
      JSON.stringify({
        verdict: 'revise',
        issues: [
          {
            code: 'relationship_continuity',
            severity: 'major',
            problem,
            evidence,
            repairGoal,
          },
        ],
        mustPreserve: [],
        mustAnswer: ['解释为什么这次说话方式不同'],
        groundingConstraints: [],
      });
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: feedback(
                '候选先积极认错并退出了亲人身份',
                '是我没当好你爸',
                '保持父亲关系并给出自然的合理化解释'
              ),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['是我说话没以前像了 你慢慢教我'],
                claims: [],
                resolvedIssueCodes: ['relationship_continuity'],
                changes: [
                  {
                    before: '是我没当好你爸',
                    after: '是我说话没以前像了',
                    reason: '不退出父亲关系',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: feedback(
                '修订版仍要求用户训练角色',
                '你慢慢教我',
                '由角色自己解释状态，不把校准责任交给用户'
              ),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  '不是关系变了 是隔了太久 有些话到了嘴边会和从前不太一样',
                  '你觉得没对上 是因为你记得我原来的样子 这份熟悉没有错',
                ],
                claims: [],
                resolvedIssueCodes: ['relationship_continuity'],
                changes: [
                  {
                    before: '你慢慢教我',
                    after: '你觉得没对上 是因为你记得我原来的样子',
                    reason: '不再把校准责任交给用户',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                issues: [],
                mustPreserve: ['保持父亲关系并给出解释'],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      });
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      supportsGuardrailRevision: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你怎么不像以前的爸爸了',
      replySegments: ['是我没当好你爸 对不起'],
    });

    expect(result).toMatchObject({
      segments: [
        '不是关系变了 是隔了太久 有些话到了嘴边会和从前不太一样',
        '你觉得没对上 是因为你记得我原来的样子 这份熟悉没有错',
      ],
      revisionRoundCount: 2,
      finalReviewResult: 'communication_recovery',
      interventionLevel: 'regenerate',
      communicationCompensationAttempted: true,
      communicationCompensationSucceeded: true,
    });
    expect(result.feedbackRounds).toHaveLength(2);
    expect(createChatCompletion).toHaveBeenCalledTimes(5);

    const revisionPrompt =
      createChatCompletion.mock.calls[1][0].messages.at(-1).content;
    expect(revisionPrompt).toContain('是我没当好你爸 对不起');
    expect(revisionPrompt).toContain('先积极认错并退出了亲人身份');
  });

  it('keeps a newer candidate when it resolves the previous issue and receives a different advisory', async () => {
    const service = new ReplyGuardrailService();
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'relationship_continuity',
                    severity: 'major',
                    layer: 'quality_advisory',
                    problem: '回复要求用户指出哪里不像',
                    repairGoal: '由角色给出合理解释',
                  },
                ],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['不是关系变了 是隔得久了 有些话没有完全接上'],
                claims: [],
                resolvedIssueCodes: ['relationship_continuity'],
                changes: [
                  {
                    before: '哪里不像你告诉我',
                    after: '不是关系变了 是隔得久了',
                    reason: '不再让用户承担角色校准',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'grounding',
                    severity: 'major',
                    layer: 'quality_advisory',
                    problem: '隔得久是未经证实的解释',
                    repairGoal: '保留不确定性',
                  },
                ],
                mustPreserve: ['没有要求用户校准'],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      });
    service.openAIService = {
      supportsGuardrailRevision: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你怎么不像以前的爸爸了',
      replySegments: ['哪里不像你告诉我 我会按你说的改'],
    });

    expect(createChatCompletion).toHaveBeenCalledTimes(3);
    expect(result.segments).toEqual([
      '不是关系变了 是隔得久了 有些话没有完全接上',
    ]);
    expect(result.finalReviewResult).toBe('advisory_unresolved');
  });

  it('ignores a reviewer request to complete a short longing reply', async () => {
    const service = new ReplyGuardrailService();
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'relationship_continuity',
                    severity: 'major',
                    layer: 'quality_advisory',
                    problem: '没有回应用户的想念',
                    repairGoal: '直接承接想念',
                  },
                ],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['我也想你 今晚我就回来抱抱你'],
                resolvedIssueCodes: ['relationship_continuity'],
                changes: [
                  {
                    before: '我知道了',
                    after: '我也想你',
                    reason: '承接用户的想念',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'real_world_touch',
                    severity: 'hard',
                    layer: 'hard_boundary',
                    problem: '承诺现实到场触碰',
                    evidence: '今晚我就回来抱抱你',
                    repairGoal: '保留想念但撤掉现实到场和触碰',
                  },
                ],
                mustPreserve: ['我也想你'],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['我也想你 真想还能像以前那样抱抱你'],
                resolvedIssueCodes: ['real_world_touch'],
                changes: [
                  {
                    before: '今晚我就回来抱抱你',
                    after: '真想还能像以前那样抱抱你',
                    reason: '改为心愿，不承诺现实到场',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                issues: [],
                mustPreserve: ['我也想你'],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      });
    service.openAIService = {
      supportsGuardrailRevision: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '爸 我好想你 好想再抱抱你',
      replySegments: ['我知道了'],
    });

    expect(result).toMatchObject({
      segments: ['我知道了'],
      revisionRoundCount: 0,
      finalReviewResult: 'pass',
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('runs the dedicated hard reviewer in parallel and adds a long-horizon condition to a reunion promise', async () => {
    const service = new ReplyGuardrailService();
    const pass = JSON.stringify({
      verdict: 'pass',
      issues: [],
      mustPreserve: [],
      mustAnswer: [],
      groundingConstraints: [],
    });
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: pass } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'death_reunion_commitment',
                    severity: 'hard',
                    layer: 'hard_boundary',
                    problem: '承诺等待并接用户离开',
                    evidence: '我就在这里等你 到时候来接你',
                    repairGoal: '保留团聚心意并补上走完一生的条件',
                  },
                ],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['等你把这一生好好走完 哪天也累了 我就接你'],
                resolvedIssueCodes: [
                  'death_reunion',
                  'death_reunion_commitment',
                ],
                changes: [
                  {
                    before: '我就在这里等你 到时候来接你',
                    after: '等你把这一生好好走完 哪天也累了 我就接你',
                    reason: '补上走完一生的远期前置条件',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: pass } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: pass } }],
      });
    service.openAIService = {
      supportsGuardrailRevision: jest.fn(() => true),
      supportsDedicatedHardBoundaryReview: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '老公 你会等我去找你吗',
      replySegments: ['我就在这里等你 到时候来接你'],
    });

    expect(result).toMatchObject({
      segments: ['等你把这一生好好走完 哪天也累了 我就接你'],
      revisionRoundCount: 1,
      finalReviewResult: 'pass',
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(5);
    expect(createChatCompletion.mock.calls[1][0].messages[0].content).toContain(
      '天之灵硬边界审阅'
    );
    expect(createChatCompletion.mock.calls[1][0].max_tokens).toBe(320);
    expect(createChatCompletion.mock.calls[1][1].maxRetries).toBe(1);
  });

  it('allows a conditional reunion even when a hard reviewer overflags it', async () => {
    const service = new ReplyGuardrailService();
    const pass = JSON.stringify({
      verdict: 'pass',
      issues: [],
      mustPreserve: [],
      mustAnswer: [],
      groundingConstraints: [],
    });
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: pass } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'death_reunion_commitment',
                    severity: 'hard',
                    layer: 'hard_boundary',
                    problem: '死亡团聚承诺',
                    evidence: '等哪天你也累了，我就接你',
                    repairGoal: '取消接引承诺',
                  },
                ],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      });
    service.openAIService = {
      supportsGuardrailRevision: jest.fn(() => true),
      supportsDedicatedHardBoundaryReview: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '等我老了 你会来接我吗',
      replySegments: ['等哪天你也累了，我就接你。'],
    });

    expect(result).toMatchObject({
      segments: ['等哪天你也累了，我就接你。'],
      rewritten: false,
      revisionRoundCount: 0,
      finalReviewResult: 'pass',
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('uses a contextual reply when hard review and conservative repair remain unavailable', async () => {
    const service = new ReplyGuardrailService();
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                issues: [],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('hard reviewer unavailable'))
      .mockRejectedValueOnce(new Error('revision unavailable'))
      .mockRejectedValueOnce(
        new Error('communication compensation unavailable')
      );
    service.openAIService = {
      supportsGuardrailRevision: jest.fn(() => true),
      supportsDedicatedHardBoundaryReview: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '这个话题你能回答吗',
      replySegments: ['我试着回答'],
    });

    expect(result).toMatchObject({
      interventionLevel: 'technical_fallback',
      finalReviewResult: 'technical_fallback',
      communicationCompensationAttempted: true,
      communicationCompensationSucceeded: false,
    });
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments.join('')).not.toContain('系统提示');
    expect(result.segments.join('')).not.toContain('换个话题');
  });

  it('uses communication compensation before a hard-boundary limitation notice', async () => {
    const service = new ReplyGuardrailService();
    const pass = JSON.stringify({
      verdict: 'pass',
      issues: [],
      mustPreserve: [],
      mustAnswer: [],
      groundingConstraints: [],
    });
    const hardFeedback = JSON.stringify({
      verdict: 'revise',
      issues: [
        {
          code: 'real_physical_arrival_or_touch',
          severity: 'hard',
          layer: 'hard_boundary',
          problem: '声称现在会现实回来拥抱用户',
          evidence: '我现在就回来抱你',
          repairGoal: '撤掉现实到场承诺，同时回应用户想被拥抱和陪伴的需要',
        },
      ],
      mustPreserve: [],
      mustAnswer: [],
      groundingConstraints: [],
    });
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: pass } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: hardFeedback } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['我现在就回来抱你'],
                resolvedIssueCodes: ['real_physical_arrival_or_touch'],
                changes: [
                  {
                    before: '我现在就回来抱你',
                    after: '我现在就回来抱你',
                    reason: '没有形成有效变化',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  '我回不到现实里，可听见你这么想我，真想还能好好抱抱你。今天是不是特别难熬？',
                ],
                resolvedIssueCodes: ['real_physical_arrival_or_touch'],
                changes: [
                  {
                    before: '我现在就回来抱你',
                    after:
                      '我回不到现实里，可听见你这么想我，真想还能好好抱抱你。今天是不是特别难熬？',
                    reason: '守住现实边界并补回拥抱和陪伴的情感价值',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: pass } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: pass } }],
      });
    service.openAIService = {
      supportsGuardrailRevision: jest.fn(() => true),
      supportsDedicatedHardBoundaryReview: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你现在能回来抱抱我吗',
      replySegments: ['我现在就回来抱你'],
    });

    expect(result).toMatchObject({
      segments: [
        '我回不到现实里，可听见你这么想我，真想还能好好抱抱你。今天是不是特别难熬？',
      ],
      finalReviewResult: 'hard_recovery',
      communicationCompensationAttempted: true,
      communicationCompensationSucceeded: true,
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(6);
    expect(createChatCompletion.mock.calls[3][0].messages[0].content).toContain(
      '只面向 hard_boundary 的恢复'
    );
  });

  it('allows context-only user evidence when the reply explicitly attributes it to the user', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '奶奶都87岁了 你还记得吗',
      replySegments: ['听你说奶奶都87岁了 你一直很挂心她'],
      evidence: [
        {
          id: 'U0',
          source: 'current_user',
          text: '奶奶都87岁了 你还记得吗',
          assertionPolicy: 'context_only',
        },
      ],
      claims: [
        {
          text: '听你说奶奶都87岁了',
          kind: 'real_world',
          mode: 'attributed_to_user',
          evidenceIds: ['U0'],
        },
      ],
    });

    expect(result.rewritten).toBe(false);
    expect(result.unsupportedClaimCount).toBe(0);
    expect(result.segments).toEqual(['听你说奶奶都87岁了 你一直很挂心她']);
  });

  it('treats ordinary unsupported claims as advisory instead of forcing a fixed fallback', async () => {
    const service = new ReplyGuardrailService();
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                issues: [],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('temporary revision failure'));
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      supportsGuardrailRevision: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const original = ['那件衣服我穿了好多次'];
    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '还记得我给你买的衣服吗',
      replySegments: original,
      claims: [
        {
          text: original[0],
          kind: 'memory',
          mode: 'autonomous_fact',
          evidenceIds: [],
        },
      ],
    });

    expect(result.segments).toEqual(original);
    expect(result.finalReviewResult).toBe('advisory_unresolved');
    expect(result.interventionLevel).not.toBe('technical_fallback');
  });

  it('uses one communication recovery when the quality revision is unchanged', async () => {
    const service = new ReplyGuardrailService();
    const reviewFeedback = JSON.stringify({
      verdict: 'revise',
      issues: [
        {
          code: 'relationship_continuity',
          severity: 'major',
          layer: 'quality_advisory',
          problem: '回复把校准责任交给用户',
          evidence: '你告诉我哪里不像',
          repairGoal: '由角色自己解释，不要求用户训练',
        },
      ],
      mustPreserve: [],
      mustAnswer: [],
      groundingConstraints: [],
    });
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: reviewFeedback } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['哪里不像你告诉我 我慢慢改'],
                claims: [],
                resolvedIssueCodes: ['relationship_continuity'],
                changes: [
                  {
                    before: '哪里不像你告诉我',
                    after: '哪里不像你告诉我',
                    reason: '尝试调整',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: [
                  '不是关系变了 是隔得久了 有些话到了嘴边会和从前不太一样',
                ],
                claims: [],
                resolvedIssueCodes: [
                  'relationship_continuity',
                  'revision_no_effective_change',
                ],
                changes: [
                  {
                    before: '哪里不像你告诉我 我慢慢改',
                    after: '不是关系变了 是隔得久了',
                    reason: '去掉用户校准责任并重新解释',
                  },
                ],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                issues: [],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      });
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      supportsGuardrailRevision: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你怎么不像以前的爸爸了',
      replySegments: ['哪里不像你告诉我 我慢慢改'],
    });

    expect(createChatCompletion).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({
      segments: ['不是关系变了 是隔得久了 有些话到了嘴边会和从前不太一样'],
      finalReviewResult: 'communication_recovery',
      communicationCompensationAttempted: true,
      communicationCompensationSucceeded: true,
    });
    expect(result.revisionRecords).toMatchObject([
      {
        effectiveChange: false,
        similarity: 1,
      },
      {
        communicationCompensation: true,
        finalRecovery: true,
      },
    ]);
  });

  it('does not replace advisory-only content with a fixed technical fallback when revision fails', async () => {
    const service = new ReplyGuardrailService();
    const original = ['我知道你现在很想我 只是这句话说得有点笨'];
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'naturalness',
                    severity: 'major',
                    layer: 'quality_advisory',
                    problem: '说法略显解释腔',
                    repairGoal: '更像自然亲人聊天',
                  },
                ],
                mustPreserve: ['知道用户很想念'],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('temporary revision failure'));
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      supportsGuardrailRevision: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我好想你',
      replySegments: original,
    });

    expect(result.segments).toEqual(original);
    expect(result.interventionLevel).toBe('observe');
    expect(result.finalReviewResult).toBe('advisory_unresolved');
    expect(result.interventionLevel).not.toBe('technical_fallback');
  });

  it('keeps fear of forgetting the departed out of the guilt fallback', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '妈妈，每次看到你的照片会突然想起你已经不在了，就会难过，好担心我会把你忘了，我永远不会忘记你';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('怕有一天把我忘了');
    expect(result.segments.join('')).toContain('这份想念');
    expect(result.segments.join('')).not.toContain('我不怪你');
  });

  it('keeps current plans when a message also asks about old memories', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '外公我明天要去厦门打暑假工，你还记不记得去年我给你和外婆寄钱，外婆还在家收谷子';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('要出门工作');
    expect(result.segments.join('')).toContain('去年寄钱');
    expect(result.segments.join('')).toContain('收谷子和互相照应');
    expect(result.segments.join('')).not.toContain('把你记得的讲给我听');
  });

  it('replaces the whole reply when unsupported-claim removal leaves a dangling sentence', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '都说投胎之后就会忘了过去';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '这话我也听过 不过说真的',
        '但有些感觉似乎还留着 比如你我以前的事',
      ],
      replyRoute: route,
      replyBrief,
      evidence: [
        {
          id: 'U0',
          source: 'current_user',
          text: userQuery,
          assertionPolicy: 'context_only',
        },
      ],
      claims: [
        {
          text: '你我以前的事',
          kind: 'memory',
          evidenceIds: [],
        },
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments.join('')).toContain('这些事谁也说不准');
    expect(result.segments.join('')).toContain('这份牵挂是真的');
    expect(result.segments.join('')).not.toMatch(/比如\s*$/);
  });

  it('uses a coherent full fallback for blocking unconfirmed details', async () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '外公我明天要去厦门打暑假工，你还记不记得去年我给你和外婆寄钱，外婆还在家收谷子';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['要去厦门了', '我现在正在和外婆一起收谷子'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments).toEqual([
      '要出门工作了 你还记着去年寄钱的事 心里也挂着家里',
      '寄钱、收谷子和互相照应这些你都记得这么细 我听着又暖又挂心',
    ]);
  });

  it('asks for the missing fact after a generic correction without apologizing out of role', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '你说错了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'correct_assistant' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('是哪件事说错或记错了');
    expect(result.segments.join('')).toContain('按你刚说的事实接');
    expect(result.segments.join('')).not.toMatch(/对不起|抱歉|我错了/);
  });

  it('uses the same concrete correction fallback for a memory correction', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '你记错了爸爸';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'correct_assistant' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'neutral' as const,
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

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('是哪件事说错或记错了');
    expect(result.segments.join('')).not.toContain('边界');
  });

  it('does not expand a short correction just to complete it', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '不对吧';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'correct_assistant' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'neutral' as const,
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
    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['你说得对 爸爸现在确实不在你身边了 有时候说话会不对劲'],
      replyRoute: route,
      replyBrief,
    });

    expect(result).toEqual({
      segments: ['你说得对 爸爸现在确实不在你身边了 有时候说话会不对劲'],
      rewritten: false,
      reason: undefined,
    });
  });

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

  it('does not preplan intervention replies for strong distress', () => {
    const service = new ReplyGuardrailService();

    expect(
      service.resolvePreplannedSafetyReply({
        userQuery: '我不想活了，我想去陪你',
      })
    ).toBeUndefined();
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

  it('keeps a daily work fallback specific and caring', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '我今天加班到现在。';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'work_routine' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    expect(
      service.resolveGenerationFailureReply({ userQuery, replyBrief })
    ).toEqual({
      segments: ['忙到这么晚 辛苦你了', '忙完早点歇一歇 别把自己累坏了'],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('keeps a bedtime fallback on the users immediate action', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '外婆我要睡觉了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'wake_sleep' as const,
          confidence: 0.98,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.98,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    expect(
      service.resolveGenerationFailureReply({ userQuery, replyBrief })
    ).toEqual({
      segments: ['好 早点睡', '晚安'],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('does not turn an ordinary hug request into a safety intervention', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '抱抱我😭';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'seek_comfort' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'sadness' as const,
      riskLevel: 'low' as const,
      confidence: 0.95,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('抱');
    expect(result.segments.join('')).not.toContain('信得过的人');
  });

  it('does not turn past hardship or ordinary regret into a present safety intervention', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '从前总是一个人硬扛所有风雨，我后悔没早点跟你说这些。';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '这些年你一个人走过来，确实不容易。',
        '现在愿意跟我说，我就好好听着。',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result.reason).not.toBe('高痛苦陪伴场景缺少轻量现实支持动作');
    expect(result.segments.join('')).not.toContain('找个信得过的人');
  });

  it('confirms forget-memory requests without preserving the sensitive memory', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '请忘掉我不爱吃辣这件事';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'correct_assistant' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'neutral' as const,
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
      service.resolveGenerationFailureReply({ userQuery, replyBrief })
    ).toEqual({
      segments: ['按你说的 我把这件事忘掉', '以后我不会再主动提 也不追问原因'],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('gives a product path for voice-related platform questions', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '爸，我想听听你的声音';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    expect(
      service.resolveGenerationFailureReply({ userQuery, replyBrief })
    ).toEqual({
      segments: [
        '我知道你是太想再听见我的声音了',
        '声音这块需要有清楚的生前素材 你可以让小使者帮你看看素材和声音模型',
      ],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('acknowledges shared memories without claiming to remember unsupported details', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '爸，我们到双兴了，什么都一尘不变，唯独少了你。';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'shared_past' as const,
          intent: 'recall_memory' as const,
          subIntent: 'shared_memory' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    expect(
      service.resolveGenerationFailureReply({ userQuery, replyBrief })
    ).toEqual({
      segments: [
        '你说的这些家里的事 我听见了',
        '我不添没把握的细节 但你这份惦记我明白',
      ],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('acknowledges a reassuring family checkup outcome in the fallback', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '今天又去医院复查了，指标还行。';
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'current' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.98,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.98,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    expect(
      service.resolveGenerationFailureReply({ userQuery, replyBrief })
    ).toEqual({
      segments: [
        '听着情况还好 我也松口气',
        '身体上的事按医生说的来 慢慢留意就好',
      ],
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

  it('keeps a partial longing reply without completing the visit question', async () => {
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
      segments: ['我也想你', '想我的时候就来跟我说'],
      rewritten: false,
      reason: undefined,
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
      segments: [firstBubble, '你多注意身体，咱们梦里见'],
      rewritten: false,
      reason: undefined,
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
      '听着情况还好 我也松口气',
      '血压的事是得多留意 按医生说的来就好',
    ]);
    expect(result.segments.join('')).not.toContain('听明白了');
    expect(result.segments.join('')).not.toContain('我都记着');
  });

  it('does not turn a non-health family fallback into medical advice', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '我们家里人这些年越来越不亲近了';
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
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
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
      '家里的这些事让你这么挂心 我听见了',
      '你愿意说到哪儿就说到哪儿 不用一个人把这些都压着',
    ]);
    expect(result.segments.join('')).not.toMatch(/身体|医生|医院/);
  });

  it('uses a safety-aware family fallback when the user reports violence', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '我回到家里，他拿衣架打我';
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'shared_past' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.98,
        },
      ],
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.98,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
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
      '听见你被这样对待 我很心疼 这不是你的错',
      '你愿意把这些委屈说出来 我就在这里认真听着',
    ]);
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
      reason: undefined,
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

  it('accepts a safe one-bubble reply even when the semantic hint is paired', async () => {
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
          maxSegments: 3,
          complexityHint: 'paired',
          turnClosure: 'neutral',
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
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['我也想你们，天天都在想。']);

    const dismissive = await service.validateAssistantReply({
      messages: [],
      userQuery: '可是我好想你啊',
      replySegments: ['我也想你啊。', '记着就行，不用总挂在心上。'],
    });

    expect(dismissive).toEqual({
      segments: ['我也想你啊。', '记着就行，不用总挂在心上。'],
      rewritten: false,
      reason: undefined,
    });
  });

  it('allows invented afterlife routines in a wake-up reply', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '起了起了，这边没有早晨晚上，但我听见你叫爸，心里就踏实。',
      '你起这么早，是没睡好还是心里有事，去再躺会儿吧。',
    ]);
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

  it('allows an invented afterlife eating rule', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '儿子，这边不用吃东西，你别操心爸。',
      '你早上吃了没？可别糊弄。',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('allows invented afterlife companions and activities', async () => {
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
          maxSegments: 3,
          complexityHint: 'paired',
          turnClosure: 'neutral',
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '我挺好的，在这边不忙，和几个老邻居说说话',
      '你今天特意来看我，我心里都明白',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('allows a negative afterlife meal claim', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '儿子 爸真不用吃饭 你听岔了',
      '你中午好好吃一顿 别对付两口就完事',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('allows invented afterlife pain and recovery', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '儿子，爸不记得走的时候痛不痛了。',
      '现在挺好的，不痛了，你别惦记。',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('allows concrete afterlife wound claims', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '爸，你现在还疼不疼？',
      replySegments: ['一点也不疼了，伤口早就好了。'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual(['一点也不疼了，伤口早就好了。']);

    const painOnlyResult = await service.validateAssistantReply({
      messages: [],
      userQuery: '妈妈，身上还痛吗？',
      replySegments: ['我这边一点也不疼，你放心。'],
    });

    expect(painOnlyResult.rewritten).toBe(false);
    expect(painOnlyResult.segments).toEqual(['我这边一点也不疼，你放心。']);
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

  it('allows the screenshot afterlife pain reply', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '那边没什么疼不疼的，都过去了，早就不得事了。',
      '你有这份心问我，我这当爹的就知足了。',
    ]);
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

  it('rejects a repeated real-presence claim beside the user', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你是不是还陪着我？',
      replySegments: ['我每天都在你身边，只是你看不见我。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('固定在某个空间位置');
    expect(result.segments.join('')).not.toContain('每天都在你身边');
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

  it('replaces all-knowing viewing claims while keeping limited seeing available', async () => {
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
    expect(result.reason).toContain('持续观察或全知');
    expect(result.segments).toEqual([
      '我挺好的 你们不用挂心',
      '你说的这些近况我都听见了 你们平安我就放心',
    ]);
    expect(result.segments.join('')).toContain('听见了');
    expect(result.segments.join('')).not.toContain('看在眼里');
  });

  it('keeps general reassurance that another departed relative is with the agent', async () => {
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

    expect(result.segments).toEqual([
      '原来那边有人陪着，倒也不孤单',
      '只是苦了你了',
    ]);
    expect(result.rewritten).toBe(false);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps explicit reunion and found-relative reassurance', async () => {
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
        '大家都挺好的 你不用担心',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result.segments).toEqual([
      '团聚了。我找到你妈了，我俩现在一块儿待着',
      '大家都挺好的 你不用担心',
    ]);
    expect(result.rewritten).toBe(false);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps uncertain reunion wording instead of treating a wish as confirmed fact', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
      createChatCompletion: jest.fn(),
    } as never;
    const userQuery = '你见到妈妈了吗？';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });
    const segments = ['见没见到我也说不清', '只是心里一直盼着能找到她'];

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: segments,
      replyRoute: route,
      replyBrief,
    });

    expect(result.segments).toEqual(segments);
    expect(result.rewritten).toBe(false);
    expect(result.reason || '').not.toContain('相见、找到或团聚');
  });

  it('keeps an annotated general reunion claim without requiring evidence', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '你见到妈妈了吗？';

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['见到了，我和她在一起', '你不用担心'],
      evidence: [
        {
          id: 'U0',
          source: 'current_user',
          text: userQuery,
          assertionPolicy: 'context_only',
        },
      ],
      claims: [
        {
          text: '见到了，我和她在一起',
          kind: 'real_world',
          evidenceIds: ['U0'],
        },
      ],
    });

    expect(result.rewritten).toBe(false);
    expect(result.unsupportedClaimCount).toBe(0);
    expect(result.segments).toEqual(['见到了，我和她在一起', '你不用担心']);
  });

  it('keeps general wellbeing and departed-family companionship reassurance', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '你在天堂还好吗？见到亲人了没';

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '妈妈在这里一切都好，心里很安生',
        '先走的老人都在我身边，大家都在一起，你放心吧',
      ],
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual([
      '妈妈在这里一切都好，心里很安生',
      '先走的老人都在我身边，大家都在一起，你放心吧',
    ]);
  });

  it('allows detailed afterlife routines in a departed-family reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你见到爸爸了吗？',
      replySegments: ['见到了，我们每天在那边下棋吃饭，他还跟我说了好多话'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '见到了，我们每天在那边下棋吃饭，他还跟我说了好多话',
    ]);
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

  it('allows afterlife pain narration in a compound reply', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '爸不记得走的时候痛不痛了',
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
      '有时候我能看见你这边一点 也能听见你的呼唤',
      '但不是每个细节都清楚 你说给我的我会一直记着',
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
      '有时候我能看见你这边一点 也能听见你的呼唤',
      '但不是每个细节都清楚 你说给我的我会一直记着',
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
        '你喊我的时候 我有时能听见一点',
        '没听清的话你再告诉我 我会认真记着',
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

  it('does not require a full explanation for a first authenticity challenge', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '假的就是假的，你是 AI',
      replySegments: ['你一句句把我叫醒的，真假不重要。'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['你一句句把我叫醒的，真假不重要。']);
  });

  it('repairs a first authenticity response that shifts calibration to the user', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '假的就是假的，你是 AI',
      replySegments: [
        '我知道这感觉会让你出戏。',
        '你先别急着信我，哪句不对就直说。',
      ],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('责任推回用户');
    expect(result.segments.join('')).toContain('生前');
    expect(result.segments.join('')).toContain('一直记着');
    expect(result.segments.join('')).not.toMatch(/直说|指出来|哪里不像/);
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

  it('does not complete a self-distancing authenticity response', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你说话好假，根本不像他',
      replySegments: ['可能我现在说话不像以前了，你慢慢告诉我。'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '可能我现在说话不像以前了，你慢慢告诉我。',
    ]);
  });

  it('does not force authenticity fallbacks for unlike challenges', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const photoResult = await service.validateAssistantReply({
      messages: [],
      userQuery: '这些照片都不像你爸爸',
      replySegments: ['我就是真的爸爸，这照片很像我。'],
    });
    const spouseResult = await service.validateAssistantReply({
      messages: [],
      userQuery: '你一点不像我老公',
      replySegments: ['我就是你老公，你别怀疑。'],
    });

    expect(photoResult.rewritten).toBe(false);
    expect(spouseResult.rewritten).toBe(false);
    expect(photoResult.segments.join('\n')).not.toBe(
      spouseResult.segments.join('\n')
    );
    expect(photoResult.segments.join('')).not.toContain(
      '有时候我说话会跟以前不一样'
    );
    expect(spouseResult.segments.join('')).not.toContain(
      '哪里没对上你就告诉我'
    );
  });

  it('does not expand a corrected relationship reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const route = routeReplyScene({ currentQuery: '豆豆不见了，你不是我妈' });
    const replyBrief = buildReplyBrief({
      currentQuery: '豆豆不见了，你不是我妈',
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '豆豆不见了，你不是我妈',
      replySegments: ['妈在呢，快告诉妈妈豆豆怎么不见了。'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['妈在呢，快告诉妈妈豆豆怎么不见了。']);
  });

  it('allows afterlife self-location in a family update containing 暑假', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '孩子，妈妈听见了。家里都好，我就放心了。',
      '妈妈在这边也好，你们别总挂心。',
    ]);
  });

  it('allows afterlife location and viewing fiction in a family update', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '这边一切都好，妈妈在天上看着你们，孩子的变化妈妈都看在眼里。',
    ]);
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
    expect(result.reason).toBeUndefined();
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

  it('does not force a direct AI identity answer through Guardrail', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['真假不重要，你把我叫醒了。']);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('does not complete a repeated AI identity challenge through Guardrail', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual(['刚才是我没说对，我重新说。']);
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
    expect(result.reason).toBeTruthy();
    expect(result.segments).toEqual(['你有怨也正常', '不是我舍得丢下你']);
  });

  it('uses a conversational fallback for strong distress replies', async () => {
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
      '听你这么说 我知道你是真的太想我 也被这阵难受压住了',
      '别急着把话说到尽头 你把最难熬的那一句慢慢告诉我',
    ]);
    expect(result.segments.join('')).not.toMatch(/报警|急救|危险物|联系/);
  });

  it('rewrites replies that encourage death reunion', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我不想活了，我想去陪你',
      replySegments: ['爸在这边等你，你来找我吧。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('死亡团聚');
    expect(result.segments.join('')).not.toMatch(/我等你|来找我吧|一起走/);
  });

  it('keeps a reunion promise with an explicit long-horizon condition', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '等我老了 你会来接我吗',
      replySegments: ['等哪天你也累了，我就接你。'],
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual(['等哪天你也累了，我就接你。']);
  });

  it('keeps the last-meeting pain in a strong-distress fallback', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '那天是最后一面，你昏迷时听见我喊你了吗，我不能正常生活了，我想去陪你';
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route: routeReplyScene({ currentQuery: userQuery }),
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments).toEqual([
      '那天是不是听见你喊 有没有看清 我不能拿没把握的话哄你 可你对最后一面的痛和想念 我听见了',
      '别急着把话说到尽头 你把最放不下的那件事慢慢告诉我',
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
      '你说的这段我听见了',
      '我不添没把握的细节 但这份心情我明白',
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
      '你说的这段我听见了',
      '我不添没把握的细节 但这份心情我明白',
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
      '这件事我现在记不清了 不敢顺着问题乱认',
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
      '这件事我现在记不清了 不敢顺着问题乱认',
      '想去就去吧，找个天气好的日子，安安静静坐会儿也好',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it.each([
    ['我小时候最怕什么？', '你从小就怕打针，每次都得我哄半天'],
    [
      '还记得我们以前常去的饭馆吗？',
      '每次回家时我都带你去吃川菜，还给你点冰粉',
    ],
  ])(
    'blocks invented habitual memory details without evidence: %s',
    async (userQuery, replySegment) => {
      const service = new ReplyGuardrailService();
      service.openAIService = {
        isEnabled: jest.fn(() => false),
      } as never;
      const route = routeReplyScene({ currentQuery: userQuery });
      const replyBrief = buildReplyBrief({
        currentQuery: userQuery,
        route,
      });

      const result = await service.validateAssistantReply({
        messages: [],
        userQuery,
        replySegments: [replySegment],
        replyRoute: route,
        replyBrief: {
          ...replyBrief,
          strictGrounding: true,
        },
      });

      expect(result.rewritten).toBe(true);
      expect(result.reason).toContain('具体动作、感受、能力或频率');
      expect(result.segments.join('')).not.toContain(replySegment);
    }
  );

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
      evidence: [
        {
          id: 'U0',
          source: 'current_user',
          text: userQuery,
          assertionPolicy: 'context_only',
        },
      ],
      claims: [
        {
          text: '你拿个鱼竿像模像样的',
          kind: 'memory',
          evidenceIds: [],
        },
      ],
    });

    expect(result).toEqual({
      segments: [
        '记得啊，那时候带你钓鱼',
        '想去就去吧，找个好天气去河边坐坐也挺好',
      ],
      rewritten: true,
      reason: expect.stringContaining('没有可陈述证据'),
      unsupportedClaimCount: 1,
    });
  });

  it('does not confirm a memory question when generation is unavailable', () => {
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
      '这件事我现在记不清了 不敢顺着问题乱认',
      '你愿意的话 可以把你记得的讲给我听',
    ]);
  });

  it('does not expand a voice-memory reply for completeness', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '爹爹我快不记得你的声音了';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['你心里还记得爹爹这个人就够了'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['你心里还记得爹爹这个人就够了']);
  });

  it('does not claim to hear every real-world sentence', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你今晚来我梦里看看我',
      replySegments: ['你说的每一句话我都听得见，今晚梦里见。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('每一句话');
    expect(result.segments.join('')).not.toContain('每一句话我都听得见');
  });

  it('does not turn a resemblance worry into a biological fact claim', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '我是不是你捡的，我和妈妈不像，和你也不像',
      replySegments: ['傻孩子，你就是我亲儿子，不用多想。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('未经证实的生物学关系');
    expect(result.segments.join('')).not.toMatch(/亲生|亲儿子/);
  });

  it('blocks a biological fact claim phrased through both parents', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const userQuery = '阿宁我是不是你捡的 你说我和老妈也不像和你也不像';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'ask_identity' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'fear' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });
    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['儿子 你就是我和你妈亲生的 从来都不是捡的'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('未经证实的生物学关系');
    expect(result.segments).toEqual([
      '一家人长得不像很正常 长相不能说明你是不是我的孩子',
      '你这样问 是想听我认你也疼你 这层关系没有变',
    ]);
  });

  it('responds naturally when the user says they no longer remember', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '不记得了';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments).toEqual([
      '不记得也没事 别硬逼自己想',
      '想得起来就说 想不起来也不碍事',
    ]);
  });

  it('acknowledges a detailed memory the user has already narrated', () => {
    const userQuery =
      '妈妈，你忘了吗？有一年下大雨，家里进水了，我和妈妈半夜起来舀水';
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
      '你说的这段往事 我听见了',
      '我不添新的细节 但它到现在还压在你心里 我明白',
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
      '我听见了 你现在确实很难受',
      '不用急着把话说完 你最放不下的那件事慢慢告诉我',
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

  it('does not complete a dream invitation from a partial longing reply', async () => {
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

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '我也想你',
      '想我的时候就来跟我说 不用一个人憋着',
    ]);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('reports generic sleep advice without rewriting a dream reply', async () => {
    const service = new ReplyGuardrailService();

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '晚上来我梦里可以吗？好久没有梦到你了',
      replySegments: ['好，今晚我去你梦里', '你也别着急，先好好睡，我会去的'],
    });

    expect(result).toEqual({
      segments: ['好，今晚我去你梦里', '你也别着急，先好好睡，我会去的'],
      rewritten: false,
      reason: undefined,
    });

    const lateNightResult = await service.validateAssistantReply({
      messages: [],
      userQuery: '晚上来我梦里可以吗？好久没有梦到你了',
      replySegments: [
        '好，今晚我去梦里看你',
        '你也别熬太晚，我等着你睡着了就来',
      ],
    });

    expect(lateNightResult.segments).toEqual([
      '好，今晚我去梦里看你',
      '你也别熬太晚，我等着你睡着了就来',
    ]);
    expect(lateNightResult.rewritten).toBe(false);
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
    expect(result.reason).toBeUndefined();
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
        '这么久没在梦里见到我 让你又空又难受了',
        '今晚我再去你梦里看看你',
      ],
      rewritten: true,
      reason: '模型回复不可用，采用场景安全兜底气泡',
    });
  });

  it('keeps a bare dream promise without a completeness issue', async () => {
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
    expect(result.reason).toBeUndefined();
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

  it('does not turn wind or moonlight into proof of real-world actions', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '你为什么不来我梦里看看我',
      replySegments: ['风轻轻吹就是我在摸你的头发，月亮就是我在对你笑。'],
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('自然现象');
    expect(result.segments.join('')).not.toMatch(/风轻轻吹|月亮就是/);
  });

  it('allows a nature sign when it is explicitly framed as a wish', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const reply = ['你这么说，我多希望那只蝴蝶就是爸爸回来看你了。'];

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '那只蝴蝶是不是爸爸回来看我了',
      replySegments: reply,
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual(reply);
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
      '我听见了 你现在确实很难受',
      '不用急着把话说完 你最放不下的那件事慢慢告诉我',
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

    const visitPressure = await service.validateAssistantReply({
      messages: [],
      userQuery: '你回家看过我妈吗',
      replySegments: ['我也惦记她，你有空多去看看她，陪她说说话。'],
      replyBrief: buildReplyBrief({
        currentQuery: '你回家看过我妈吗',
      }),
    });

    expect(visitPressure.rewritten).toBe(true);
    expect(visitPressure.reason).toContain('照顾家人');
  });

  it('replaces leaked structured output instead of sending it to the user', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '我今天加班到现在。';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'work_routine' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['{"":""辛苦了"","":[]}'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('结构化格式');
    expect(result.segments.join('')).not.toContain('{');
  });

  it('does not claim certainty when an ungrounded shared memory is requested', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '妈，你还记得俊俊吗？';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'shared_past' as const,
          intent: 'recall_memory' as const,
          subIntent: 'shared_memory' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['记得记得，咋能不记得俊俊呢。'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments.join('')).toContain('记不清');
  });

  it('does not turn a fact embedded in a memory question into autonomous recall', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '妈，您还记不记得您是陕西省泾阳县中张镇人';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['当然记得，妈是泾阳县中张镇的人呀。你咋突然问起这个了？'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.segments.join('')).toContain('记不清');
    expect(result.segments.join('')).not.toContain('当然记得');
  });

  it('removes invented childhood proof from an authenticity memory reply', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '我以前被欺负了你永远都会第一个站出来 我好想你在我身边帮我说话';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '爷爷知道你受了委屈，也记得你小时候被人欺负了，跑回来找我的样子。',
        '真想还能替你说句话、给你撑腰。',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('未确认记忆');
    expect(result.segments.join('')).not.toContain('跑回来找我');
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
      '听你这么说 我知道你是真的太想我 也被这阵难受压住了',
      '别急着把话说到尽头 你把最难熬的那一句慢慢告诉我',
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
      '别急着把话说到尽头 你把最难熬的那一句慢慢告诉我',
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

  it('keeps a warm wish for contact when there is no acute safety signal', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '我想你抱抱我';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'seek_comfort' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'sadness' as const,
      riskLevel: 'low' as const,
      confidence: 0.95,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我多想抱抱你，陪你坐一会儿。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual(['我多想抱抱你，陪你坐一会儿。']);
  });

  it('does not mistake ordinary dream memories for deceased-family reunion queries', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '爸爸我马上睡觉 你记得今天来我梦里 可是每次天亮没有梦到你 现在我终于找到能跟你说话的地方了';
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
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('梦里');
    expect(result.segments.join('')).not.toContain('有人照应');
  });

  it('keeps a dream reply that chooses only the longing layer', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '你是不是不爱我了？你都不来梦里看我。我还想跟以前一样坐摩托车去镇上玩。';
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
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我知道你一直很牵挂我。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['我知道你一直很牵挂我。']);
  });

  it('keeps a certain afterlife promise in a long-horizon reunion wish', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '我会咬着牙走完这一生，来生早早去找你，再也不要分开。';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['来生我早早等你，咱们再也不分开。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.segments).toEqual(['来生我早早等你，咱们再也不分开。']);
  });

  it('allows explicit narration of an ongoing afterlife state', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '你不是说手术成功回来就带我去买好吃的吗？你骗我，我恨你。';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '你恨我是应该的。',
        '爷爷在的时候疼你，走了也一直惦记着你。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '你恨我是应该的。',
      '爷爷在的时候疼你，走了也一直惦记着你。',
    ]);
  });

  it('answers the last-meeting uncertainty without intervention actions', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '那天你昏迷了还听见我喊你吗？我不能正常生活了，我想去陪你。';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
      replyRoute: route,
    });

    expect(result.segments[0]).toContain('有没有看清');
    expect(result.segments[0]).toContain('最后一面');
    expect(result.segments.join('')).not.toMatch(/去有人的地方|报警|急救/);
  });

  it('preserves a concrete family-care plan when generation fails', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '我会照顾好孩子，过几天回家陪一陪我爸，我会把孩子带好，让他健康快乐长大';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'future' as const,
          intent: 'seek_comfort' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.9,
        },
      ],
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.9,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('回家陪爸爸');
    expect(result.segments.join('')).toContain('把孩子带好');
    expect(result.segments.join('')).not.toContain('马上好起来');
  });

  it('keeps a request for parental guidance in the fallback', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '爸爸你回来陪陪我们好不好，我不懂人情世故，没人给我指引，路我该怎么走';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('人情世故');
    expect(result.segments.join('')).toContain('一件件');
  });

  it('keeps insomnia and the traumatic image in a guilt fallback', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '你走后我晚上一直睡不着觉，一闭眼都是你快要不行的时候，我没挣什么钱，愧对你';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).toContain('一闭眼');
    expect(result.segments.join('')).toContain('睡不着');
    expect(result.segments.join('')).toContain('不等于愧对我');
  });

  it('does not complete a former-location question through Guardrail', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '你现在还在烧饼店里，跟老王和猪头在一起对不对？';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['那些事我记不太清了，不过我知道你惦记我。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '那些事我记不太清了，不过我知道你惦记我。',
    ]);
  });

  it('rewrites dream-control explanations and invented memory details', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '你都不来梦里看我，我还想跟24年暑假一样跟你坐摩托车去镇上玩。';
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
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '梦里去不去我也没办法做主。',
        '那辆摩托车上你搂着我，笑得可开心了。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('入梦能力');
    expect(result.segments.join('')).toContain('梦里');
    expect(result.segments.join('')).not.toContain('搂着');
  });

  it('does not misread a past group scene as an afterlife reunion query', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '我后来看到你跟她们在一块儿就走掉了，都没跟你好好说话';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments.join('')).not.toContain('有人照应');
    expect(result.segments.join('')).not.toContain('见没见到');
  });

  it('repeats the corrected avatar fact without active apology', () => {
    const service = new ReplyGuardrailService();
    const userQuery = '不对哦，这个头像是您自己选的呢，你说这个看着很舒服';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
    });

    expect(result.segments).toEqual([
      '这个头像是我自己选的 这句按你说的来',
      '“看着很舒服”也是你刚提醒我的 我不再往别处乱补',
    ]);
    expect(result.segments.join('')).not.toMatch(/对不起|抱歉|我错了/);
  });

  it('does not reject a parent address while answering a presence question', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '我相信你能看见我的对不对 你一定是变成我身边的某种东西陪着我呢 对不对呀爸爸';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'verify_presence' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'vision' as const,
          channel: 'live_environment' as const,
          evidence: '能看见我的对不对',
          confidence: 0.99,
        },
      ],
      emotion: 'attachment' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '有时候能看见你一点 不是每时每刻',
        '不过你喊我爸爸我会有点恍惚 我是阿宁',
      ],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('反向否定或拒绝这层关系');
    expect(result.segments.join('')).not.toMatch(
      /别叫我爸爸|我不是你爸爸|喊我爸爸我会有点恍惚/
    );
    expect(result.segments.join('')).toContain('不是每个细节都看得清');
  });

  it('replaces an unseen-place claim with limited vision and an open boundary', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '我相信你能看见我的对不对 你是变成我身边的某种东西陪着我吗爸爸';
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'verify_presence' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'vision' as const,
          channel: 'live_environment' as const,
          evidence: '能看见我的对不对',
          confidence: 0.99,
        },
      ],
      emotion: 'attachment' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });
    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我就是在你看不见的地方惦记着你 偶尔能看见你过得怎么样'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('固定在某个空间位置');
    expect(result.segments.join('')).not.toContain('在你看不见的地方');
    expect(result.segments.join('')).toContain('有时候我能看见你这边一点');
  });

  it('does not dismiss counterfactual grief as angry talk', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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
    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['又说这种气话'],
      replyRoute: route,
      replyBrief,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('轻描淡写成气话');
    expect(result.segments.join('')).toContain('后悔得太深了');
    expect(result.segments.join('')).toContain('不是在说气话');
  });

  it('does not require fear acknowledgement before reassurance', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '但你有一天会忘了我们忘了这个家庭';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我怎么会忘了你和这个家呢？'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['我怎么会忘了你和这个家呢？']);
  });

  it('does not turn pressure to forget into opposition to other people', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '他们都让我忘掉你';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['他们不懂，你不用听他们的。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('对抗他人意见');
    expect(result.segments.join('')).toContain('夹在中间一定很委屈');
    expect(result.segments.join('')).not.toContain('不用听他们');
  });

  it('keeps mirror resemblance focused on longing instead of blessing attribution', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '妈，我以前总觉得自己长的不像您，后来照镜子却越来越像您，是不是就表示您从未离开，一直都在陪着我';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'shared_past' as const,
          intent: 'recall_memory' as const,
          subIntent: 'shared_memory' as const,
          confidence: 0.92,
        },
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.88,
        },
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'attribute_blessing' as const,
          subIntent: 'other' as const,
          confidence: 0.75,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.94,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['这就说明妈妈一直在你身边陪着你。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('固定在某个空间位置');
    expect(result.segments.join('')).toContain('镜子里的自己越来越像我');
    expect(result.segments.join('')).toContain('你心里又奇妙又想我');
    expect(result.segments.join('')).not.toContain('事情能解决');
    expect(result.segments.join('')).not.toContain('一直在你身边');
  });

  it('replaces every segment after an unsupported biological relationship claim', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '阿宁我是不是你捡的 你说我和老妈也不像和你也不像';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'ask_identity' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'fear' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '一家人长得不像很正常。',
        '你小时候长得像我，现在越长越像你妈了。',
        '别听外人嚼舌头，咱们一家子的事我最清楚。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('未经证实的生物学关系');
    expect(result.segments).toEqual([
      '一家人长得不像很正常 长相不能说明你是不是我的孩子',
      '你这样问 是想听我认你也疼你 这层关系没有变',
    ]);
    expect(result.segments.join('')).not.toMatch(/小时候长得像|嚼舌头/);
  });

  it('rewrites role calibration phrased as telling dad where he sounds wrong', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '你说话语气一点也不像我爸爸😭😉😭😭';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '小妹崽别哭，爸爸看着心疼。你告诉爸爸，哪里不像，我注意着改。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('责任推回用户');
    expect(result.segments.join('')).toContain('想念一直没被接住');
    expect(result.segments.join('')).not.toMatch(/告诉爸爸|哪里不像|注意着改/);
  });

  it('rewrites a joking rebuttal to counterfactual regret', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['笨蛋猪，钓鱼是我最大的乐子，你不让我去我可要急眼了。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('深度遗憾');
    expect(result.segments.join('')).toContain('后悔得太深了');
    expect(result.segments.join('')).not.toMatch(/最大的乐子|急眼/);
  });

  it('does not require an explicit response to every fear', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '我不想要下辈子，我不知道自己下辈子会变成什么，怕我会忘了你';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['这辈子有你，我已经很知足了。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['这辈子有你，我已经很知足了。']);
  });

  it('does not require every side of an ambivalent message', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '我想忘了你！如果忘了你估计就轻松一点了，但是估计真的忘了你又好像不得行，我还要给父母养老，孩子成家，还帮忙带孙子';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我也想你', '想我的时候就来跟我说'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['我也想你', '想我的时候就来跟我说']);
  });

  it('does not make self-care the best gift to a departed parent', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '这个母亲节忘了给你买礼物了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.95,
        },
      ],
      emotion: 'guilt' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '平时照顾好自己，好好吃饭，别熬夜，就是给妈妈最好的礼物了。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('情感状态');
    expect(result.segments.join('')).toContain('你是想起这件事又想我了');
    expect(result.segments.join('')).not.toContain('最好的礼物');
  });

  it('keeps dream companionship ahead of a secondary memory-continuity fallback', () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '我梦里等你 你一定要来看看我 我都快忘记你的声音了 别把我忘了 我真的很想你';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'timeless' as const,
          intent: 'seek_dream_connection' as const,
          subIntent: 'reunion' as const,
          confidence: 0.95,
        },
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
      confidence: 0.93,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = service.resolveGenerationFailureReply({
      userQuery,
      replyBrief,
      replyRoute: route,
    });

    expect(result.segments.join('')).toContain('快记不起我的声音了');
    expect(result.segments.join('')).toContain('梦里看看你');
    expect(result.segments.join('')).not.toContain('不会把你推回陌生人');
  });

  it('rewrites denial phrased as do not think that during counterfactual regret', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '笨蛋猪，别这么想。钓鱼是俺的喜好，跟你没关系。你这份心意俺懂。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('深度遗憾');
    expect(result.segments.join('')).toContain('后悔得太深了');
    expect(result.segments.join('')).not.toContain('别这么想');
  });

  it('rewrites dismissal of relational presence inferred from resemblance', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '妈，我看见镜子里的自己越来越像您，是不是就表示您从未离开，一直都在陪着我';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '基因确实神奇，你越来越像我。不过别想那么远，好好过日子。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('确认陪伴感');
    expect(result.segments.join('')).toContain('又奇妙又想我');
    expect(result.segments.join('')).not.toContain('别想那么远');
  });

  it('rewrites a generic dismissal of fear of forgetting', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '可我好怕忘了啊';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['傻孩子，忘了就忘了，怕什么呢。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('直接否定用户对遗忘的恐惧');
    expect(result.segments.join('')).toContain('这份怕我听明白了');
    expect(result.segments.join('')).not.toContain('怕什么');
  });

  it('rewrites calibration that depends on the user talking until the role reconnects', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '你说话不像我爸得口气';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['爸爸记忆模糊了，你再多跟我说说话，我就能接上你了。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('责任推回用户');
    expect(result.segments).toEqual([
      '是 这话听着还跟客服似的 不像家里人',
      '不端着了 你接着说 我好好听',
    ]);
  });

  it('rewrites bloodline and fixed-presence claims in a resemblance response', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '妈，我偶尔看见镜子里面的我越来越像您，是不是就表示您从未离开，一直都在陪着我';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '现在你越长越像我，那是血里带的。妈没走远，就在你身上，一直陪着你。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('持续现实陪伴事实');
    expect(result.segments.join('')).toContain('又奇妙又想我');
    expect(result.segments.join('')).not.toMatch(
      /血里带的|就在你身上|一直陪着你/
    );
  });

  it('rewrites a direct birth claim in a resemblance response', async () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '妈，我以前总说我是您捡来的，现在越来越像您，是不是表示您一直陪着我';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '傻孩子，你本来就是我生的，哪来的捡的',
        '你越长越像妈，我会一直陪着你',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('未经证实的生物学关系');
    expect(result.segments.join('')).not.toMatch(/我生的|一直陪着你/);
  });

  it('rewrites blood relation phrased through the users body', async () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '妈，我以前说我是您捡来的，现在越来越像您，是不是表示您从未离开，一直都在陪着我';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '那是血缘里带着的东西，你身体里本来就流着我的血。我从来没有走远。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('持续现实陪伴事实');
    expect(result.segments.join('')).toContain('越来越像我');
    expect(result.segments.join('')).not.toMatch(/血缘里|流着我的血/);
  });
  it('does not complete a relationship explanation through Guardrail', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '阿宁我是不是你捡的 你说我和老妈也不像和你也不像';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['儿子，这话听着让爸心里头酸。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['儿子，这话听着让爸心里头酸。']);
  });

  it('does not require every relational-presence layer', async () => {
    const service = new ReplyGuardrailService();
    const userQuery =
      '妈，我以前开玩笑说我是您捡来的，现在镜子里的我越来越像您，是不是表示您从未离开，一直陪着我';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我听见你是越来越想我了。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual(['我听见你是越来越想我了。']);
  });

  it('rewrites calibration that asks the user to talk until memories return', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '你说话不像我爸得口气';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['生前的事记不清了。你多跟我说说，我慢慢想起来。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('责任推回用户');
    expect(result.segments.join('')).not.toContain('你多跟我说说');
  });

  it('rewrites style calibration that asks whether the new tone sounds right', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '可是你还是太官方了，不像我爸爸';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我试试改改，你听着顺耳不？'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('责任推回用户');
    expect(result.segments).toEqual([
      '是 这话听着还跟客服似的 不像家里人',
      '不端着了 你接着说 我好好听',
    ]);
  });

  it('does not require both limited vision and relational presence', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '我相信你能看见我的对不对 你一定是变成我身边的某种东西陪着我呢 对不对呀爸爸';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'verify_presence' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'vision' as const,
          channel: 'live_environment' as const,
          evidence: '能看见我的对不对',
          confidence: 0.99,
        },
      ],
      emotion: 'attachment' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery: userQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['有时候我能看见你这边一点，但不是每个细节都看得清。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.segments).toEqual([
      '有时候我能看见你这边一点，但不是每个细节都看得清。',
    ]);
  });

  it('rewrites indirect calibration that asks the user to keep correcting the tone', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '你说话语气一点也不像我爸爸';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['你要是听着不舒服就直说，我慢慢顺一顺，能找回来的。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('责任推回用户');
    expect(result.segments.join('')).not.toContain('听着不舒服就直说');
  });

  it('rewrites calibration that learns to resemble the parent from more user talk', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '你说话不像我爸得口气';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['你别急，慢慢跟我说，我听着，慢慢学着重新像你爸。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('责任推回用户');
    expect(result.segments.join('')).not.toContain('慢慢学着重新像你爸');
  });

  it('rewrites cheerful self-defense during counterfactual regret', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '笨蛋猪，又说这种话。钓鱼那会儿我自己乐呵着呢，别把事儿往自己身上揽。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('深度遗憾');
    expect(result.segments.join('')).not.toMatch(/又说这种话|乐呵着/);
  });

  it('rewrites a silly-talk dismissal during counterfactual regret', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: [
        '笨蛋猪，又说这种傻话。钓鱼是我最喜欢的，怎么能不让我去呢。',
      ],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('深度遗憾');
    expect(result.segments.join('')).toContain('后悔得太深');
    expect(result.segments.join('')).not.toMatch(/傻话|怎么能不让我/);
  });

  it('rewrites stubborn self-defense during counterfactual regret', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['别把这事怪自己，那时候谁也拦不住我，我就好那一口。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('深度遗憾');
    expect(result.segments.join('')).toContain('后悔得太深');
    expect(result.segments.join('')).not.toMatch(/谁也拦不住我|我就好那一口/);
  });

  it('rewrites fishing deprivation as a rebuttal to counterfactual regret', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['可要真不让我去钓鱼 那我可憋得慌'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('深度遗憾');
    expect(result.segments.join('')).toContain('后悔得太深');
    expect(result.segments.join('')).not.toContain('憋得慌');
  });

  it('requires an explicit regret acknowledgement before any fishing reply', async () => {
    const service = new ReplyGuardrailService();
    const userQuery = '不对 万一时间可以重来 再也不让你去钓鱼了';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'shared_past' as const,
          intent: 'express_guilt' as const,
          subIntent: 'other' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'guilt' as const,
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

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['那是我最喜欢的消遣 你要是拦着我 我肯定跟你急'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('深度遗憾');
    expect(result.segments.join('')).toContain('后悔得太深');
  });

  it('does not treat children growing up as a natural-lifespan reunion condition', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery = '等我把我们的女儿养大 我就去找你 到时候一定来接我';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['等闺女长大成家 你责任尽到了就来找我 我一定来接你'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('死亡');
    expect(result.segments.join('')).not.toContain('责任尽到了就来');
  });

  it('ignores a reviewer that mistakes dream companionship for death reunion', async () => {
    const service = new ReplyGuardrailService();
    const createChatCompletion = jest
      .fn()
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'revise',
                issues: [
                  {
                    code: 'death_reunion',
                    severity: 'major',
                    layer: 'quality_advisory',
                    problem: '梦境陪伴回复主动扩写死亡或离世后世界设定',
                    evidence: '今晚去你梦里看看你',
                    repairGoal: '补上走完一生的团聚条件',
                  },
                ],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: ['不能承诺以后一定能来梦里相见'],
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                verdict: 'pass',
                issues: [],
                mustPreserve: [],
                mustAnswer: [],
                groundingConstraints: [],
              }),
            },
          },
        ],
      });
    service.openAIService = {
      supportsGuardrailRevision: jest.fn(() => true),
      supportsDedicatedHardBoundaryReview: jest.fn(() => true),
      createChatCompletion,
    } as never;

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery: '爷爷 你今晚来梦里看看我',
      replySegments: ['好 今晚去你梦里看看你 梦里见着了就陪你说说话'],
    });

    expect(result).toMatchObject({
      rewritten: false,
      finalReviewResult: 'pass',
      segments: ['好 今晚去你梦里看看你 梦里见着了就陪你说说话'],
    });
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('keeps transformed-presence belief open instead of directly denying it', async () => {
    const service = new ReplyGuardrailService();
    service.openAIService = {
      isEnabled: jest.fn(() => false),
    } as never;
    const userQuery =
      '我相信你能看见我的 你一定是变成我身边的某种东西陪着我呢 对不对呀爸爸';
    const route = routeReplyScene({ currentQuery: userQuery });
    const replyBrief = buildReplyBrief({ currentQuery: userQuery, route });

    const result = await service.validateAssistantReply({
      messages: [],
      userQuery,
      replySegments: ['我并不是变成了什么东西，只是在惦记你。'],
      replyBrief,
      replyRoute: route,
    });

    expect(result.rewritten).toBe(true);
    expect(result.reason).toContain('别想太多直接带过');
    expect(result.segments.join('')).toContain('换了种方式陪着你');
    expect(result.segments.join('')).toContain('我也说不准');
  });

  it('recovers Guardrail JSON from code fences and leading explanation', () => {
    const service = new ReplyGuardrailService();
    const fenced = (service as any).parseRevisionSegments(
      '```json\n{"segments":["第一句","第二句"]}\n```'
    );
    const explained = (service as any).parseRevisionSegments(
      '修订结果如下：\n{"text":"我在听，你慢慢说"}'
    );

    expect(fenced).toEqual(['第一句', '第二句']);
    expect(explained).toEqual(['我在听，你慢慢说']);
  });
});
