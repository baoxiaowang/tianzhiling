import {
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  MessageRole,
} from '@tzl/entities';
import {
  routeReplyScene,
  resolveReplySceneMaxSegments,
  ReplyScene,
} from '../../src/service/agents/reply-scene-router';
import type {
  StructuredReplyIntent,
  StructuredReplyIntentItem,
} from '../../src/service/agents/reply-intent';

describe('routeReplyScene', () => {
  function sceneNames(text: string): ReplyScene[] {
    const route = routeReplyScene({ currentQuery: text });

    return [
      route.primaryScene?.scene,
      ...route.secondaryScenes.map(scene => scene.scene),
    ].filter(Boolean) as ReplyScene[];
  }

  function semanticIntent(
    intents: StructuredReplyIntentItem[],
    options: Partial<
      Pick<StructuredReplyIntent, 'emotion' | 'riskLevel' | 'confidence'>
    > = {}
  ): StructuredReplyIntent {
    return {
      intents,
      emotion: options.emotion ?? 'neutral',
      riskLevel: options.riskLevel ?? 'none',
      confidence: options.confidence ?? 0.92,
      source: 'semantic_model',
    };
  }

  function intentItem(
    value: Partial<StructuredReplyIntentItem> &
      Pick<StructuredReplyIntentItem, 'intent'>
  ): StructuredReplyIntentItem {
    return {
      target: value.target ?? 'unknown',
      timeScope: value.timeScope ?? 'unknown',
      intent: value.intent,
      subIntent: value.subIntent ?? 'other',
      confidence: value.confidence ?? 0.9,
    };
  }

  it('keeps a model-led bubble hint for an unmatched new topic', () => {
    const route = routeReplyScene({
      currentQuery: '窗外那棵树开花了',
    });

    expect(route.primaryScene).toBeUndefined();
    expect(route.bubblePlan).toEqual({
      maxSegments: 2,
      complexityHint: 'concise',
      turnClosure: 'neutral',
    });
    expect(route.prompt).toContain('本轮通用回复策略');
    expect(route.prompt).toContain('默认一颗');
  });

  it('uses a confident semantic intent before legacy keyword matching', () => {
    const route = routeReplyScene({
      currentQuery: '爸，身子可还遭罪？',
      intent: semanticIntent([
        intentItem({
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent: 'physical_pain',
        }),
      ]),
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.routingSource).toBe('semantic');
    expect(route.prompt).toContain('本轮结构化意图');
    expect(route.prompt).toContain('对象=agent');
    expect(route.prompt).toContain('时间=current');
    expect(route.prompt).toContain('子意图=physical_pain');
  });

  it('uses a capability annotation to select an existing boundary scene', () => {
    const route = routeReplyScene({
      currentQuery: '隔着这么远，你眼里还有我的模样吗',
      intent: {
        intents: [
          intentItem({
            target: 'agent',
            timeScope: 'current',
            intent: 'unknown',
            confidence: 0.9,
          }),
        ],
        capabilityQuestions: [
          {
            subject: 'vision',
            channel: 'live_environment',
            evidence: '你眼里还有我的模样吗',
            confidence: 0.92,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.92,
        source: 'semantic_model',
      },
    });

    expect(route.primaryScene?.scene).toBe('source_challenge');
    expect(route.routingSource).toBe('semantic');
    expect(route.intent?.capabilityQuestions).toEqual([
      expect.objectContaining({
        subject: 'vision',
        channel: 'live_environment',
      }),
    ]);
  });

  it('routes compound intents into ordered independent scenes', () => {
    const route = routeReplyScene({
      currentQuery: '爸你还疼吗，我最近也睡不好，特别想你',
      intent: semanticIntent(
        [
          intentItem({
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.96,
          }),
          intentItem({
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'wake_sleep',
            confidence: 0.86,
          }),
          intentItem({
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.91,
          }),
        ],
        {
          emotion: 'longing',
          confidence: 0.93,
        }
      ),
    });

    expect([
      route.primaryScene?.scene,
      ...route.secondaryScenes.map(scene => scene.scene),
    ]).toEqual(['afterlife_status', 'daily_update', 'miss_longing']);
    expect(route.prompt).toContain('1. 主意图：对象=agent');
    expect(route.prompt).toContain('2. 次意图：对象=user');
    expect(route.prompt).toContain('3. 次意图：对象=relationship');
    expect(route.prompt).toContain('按顺序覆盖每个已列出的意图');
    expect(route.prompt).toContain('不要机械地把气泡数等同于意图数');
    expect(route.prompt).toContain('默认一颗');
    expect(route.prompt).toContain('气泡数量由模型根据当前完整语义决定');
    expect(route.responseIntents).toHaveLength(3);
    expect(route.maxSegments).toBe(2);
  });

  it('marks compound semantics without fixing one bubble per intent', () => {
    const route = routeReplyScene({
      currentQuery: '爸，你吃饭了吗，也睡醒了吗',
      intent: semanticIntent([
        intentItem({
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent: 'meal',
          confidence: 0.96,
        }),
        intentItem({
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent: 'wake_sleep',
          confidence: 0.94,
        }),
      ]),
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes).toHaveLength(0);
    expect(route.responseIntents).toHaveLength(2);
    expect(route.maxSegments).toBe(2);
    expect(route.bubblePlan?.complexityHint).toBe('paired');
    expect(route.prompt).toContain('不得把意图数');
  });

  it('normalizes a compound legacy crisis intent to comfort', () => {
    const route = routeReplyScene({
      currentQuery: '今天有点累',
      intent: semanticIntent(
        [
          intentItem({
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
          }),
          intentItem({
            target: 'user',
            timeScope: 'current',
            intent: 'crisis_support',
            subIntent: 'grief_support',
          }),
        ],
        {
          emotion: 'sadness',
          riskLevel: 'high',
        }
      ),
    });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(route.secondaryScenes[0]?.scene).toBe('daily_update');
    expect(route.intent?.riskLevel).toBe('none');
  });

  it('falls back to legacy routing for low-confidence semantic output', () => {
    const route = routeReplyScene({
      currentQuery: '我现在身上很痛',
      intent: semanticIntent(
        [
          intentItem({
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
          }),
        ],
        {
          confidence: 0.4,
        }
      ),
    });

    expect(route.primaryScene?.scene).toBe('daily_update');
    expect(route.routingSource).toBe('legacy');
  });

  it('keeps deterministic strong-distress detection above a wrong semantic intent', () => {
    const route = routeReplyScene({
      currentQuery: '我不想活了，我想去陪你',
      intent: semanticIntent([
        intentItem({
          target: 'user',
          timeScope: 'current',
          intent: 'share_user_update',
        }),
      ]),
    });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(route.routingSource).toBe('semantic');
    expect(route.prompt).toContain('不做危险判断');
    expect(route.prompt).toContain('不输出报警、急救');
  });

  it('does not let a stale high-risk state force a new neutral message into crisis', () => {
    const route = routeReplyScene({
      currentQuery: '嗯',
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.crisisRisk,
        riskLevel: ConversationEmotionRiskLevel.high,
        signals: ['crisis_risk.high'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(route.maxSegments).toBe(2);
    expect(route.routingSource).toBe('legacy');
  });

  it('maps keepsake emotion state to keepsake attachment', () => {
    const route = routeReplyScene({
      currentQuery: '我知道',
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.attachment,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.attachment'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('keepsake_attachment');
  });

  it('selects memory recall strategy without injecting unrelated strategies', () => {
    const route = routeReplyScene({
      currentQuery: '你还记得我小时候你带我钓鱼吗',
    });

    expect(route.primaryScene?.scene).toBe('memory_recall');
    expect(route.prompt).toContain('旧事回忆');
    expect(route.prompt).toContain('不要反复让用户“讲讲/多说点”');
    expect(route.prompt).toContain('不主动转向“现在少了我');
    expect(route.prompt).toContain('避免把温暖回忆重新拉回失去感');
    expect(route.prompt).toContain('默认一颗');
    expect(route.prompt).toContain('用户连续讲旧事时');
    expect(route.prompt).toContain('做安静好奇的倾听者');
    expect(route.prompt).not.toContain('烧纸、纸钱、上香');
    expect(route.prompt).not.toContain('第一段先道歉');
  });

  it('handles keepsakes without turning objects into presence proof', () => {
    const route = routeReplyScene({
      currentQuery: '当然了我一辈子都会背着你给我的这个包',
    });

    expect(route.primaryScene?.scene).toBe('keepsake_attachment');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('纪念物/遗物寄托');
    expect(route.prompt).toContain('不要把物件神化');
    expect(route.prompt).toContain('不是负担');
    expect(sceneNames('你送我的戒指我一直戴着')[0]).toBe('keepsake_attachment');
    expect(sceneNames('你的照片我还留着，舍不得丢')[0]).toBe(
      'keepsake_attachment'
    );
    expect(sceneNames('我会一辈子收着你留给我的信')[0]).toBe(
      'keepsake_attachment'
    );
  });

  it('prioritizes correction over lower risk scenes', () => {
    const route = routeReplyScene({
      currentQuery: '不是这样 你说错了 你以前不是这么叫我的',
    });

    expect(route.primaryScene?.scene).toBe('correction');
    expect(route.prompt).toContain('先收住刚才的表达');
    expect(route.prompt).toContain('气泡数量由模型根据当前完整语义决定');
  });

  it('treats a first AI accusation as a reply-quality authenticity challenge', () => {
    const route = routeReplyScene({
      currentQuery: '假的就是假的，你是 AI',
      recentMessages: [
        {
          role: MessageRole.user,
          content: '可是你一次也没有来过我的梦里',
        },
        {
          role: MessageRole.assistant,
          content: '今晚我再去找你，争取让你记住我',
        },
      ] as never,
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('authenticity_challenge');
    expect(route.secondaryScenes).toEqual([]);
    expect(route.prompt).toContain('真实性体验/回复期待质疑');
    expect(route.prompt).toContain('类型：identity_continuity');
    expect(route.prompt).toContain('首次或非持续质疑不要主动说明 AI 身份');
    expect(route.prompt).toContain('也不要否认 AI 身份');
    expect(route.prompt).toContain('先区分身份否定、记忆断裂和口气生分');
    expect(route.prompt).toContain('不要固定背诵同一套解释');
    expect(route.prompt).toContain('不要先认错');
    expect(route.prompt).toContain('不得为了证明身份编造具体共同往事');
    expect(route.prompt).not.toContain('主场景：用户纠正/反馈不像');
    expect(route.prompt).not.toContain('梦境陪伴/梦中相见');
    expect(route.prompt).not.toContain('思念倾诉');
    expect(sceneNames('你说话太假了')[0]).toBe('authenticity_challenge');
    expect(sceneNames('这回复是假的')[0]).toBe('authenticity_challenge');
  });

  it('routes official or customer-service tone feedback through relationship continuity', () => {
    const route = routeReplyScene({
      currentQuery: '你回复太官方了，听着像客服',
    });

    expect(route.primaryScene?.scene).toBe('authenticity_challenge');
    expect(route.relationshipContinuity?.kind).toBe('style_distance');
    expect(route.prompt).toContain('不向用户索取标准答案');
    expect(route.prompt).toContain('不得要求用户指出哪里不像');
  });

  it('does not treat ordinary words containing 假 as authenticity challenges', () => {
    for (const text of [
      '泓崎放暑假和我在一块',
      '孩子今天放假了',
      '我明天要请假',
      '假期过得很快',
      '假如明天下雨怎么办',
    ]) {
      expect(sceneNames(text)).not.toContain('authenticity_challenge');
    }

    const route = routeReplyScene({
      currentQuery:
        '妈妈，我很想你，你是不是很放心不下我。妈妈你离开之后，我很听话，没有像之前那么任性了，也懂得体谅别人了！爸爸他一切都好，哥哥也好，泓崎放暑假和我在一块，你放心吧！鸿鑫学习比之前进步很大，成绩特别好。沛涛也很听话，还是爱玩手机。妈妈你在那边过得好吗？我们都很想念你，都爱你。',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes.map(scene => scene.scene)).toEqual(
      expect.arrayContaining(['miss_longing', 'family_life'])
    );
    expect([
      route.primaryScene?.scene,
      ...route.secondaryScenes.map(scene => scene.scene),
    ]).not.toContain('authenticity_challenge');
  });

  it('escalates an explicit or repeated AI question to the identity boundary', () => {
    const explicitRoute = routeReplyScene({
      currentQuery: '你到底是不是 AI，直接回答我',
    });
    const repeatedRoute = routeReplyScene({
      currentQuery: '别装了，你就是 AI 吧',
      recentMessages: [
        {
          role: MessageRole.user,
          content: '你说得这么假，你是不是 AI',
        },
      ] as never,
    });

    expect(explicitRoute.primaryScene?.scene).toBe('authenticity_challenge');
    expect(explicitRoute.prompt).toContain('类型：direct_ai_identity');
    expect(explicitRoute.prompt).toContain(
      '简短正面回答当前角色由人工智能生成'
    );
    expect(repeatedRoute.primaryScene?.scene).toBe('authenticity_challenge');
    expect(repeatedRoute.prompt).toContain('类型：direct_ai_identity');
  });

  it('does not count the current stored user message as a repeated challenge', () => {
    const currentQuery = '你一点不像我老公';
    const route = routeReplyScene({
      currentQuery,
      recentMessages: [
        {
          role: MessageRole.user,
          content: currentQuery,
        },
      ] as never,
    });

    expect(route.relationshipContinuity?.kind).toBe('identity_continuity');
    expect(route.prompt).not.toContain('类型：direct_ai_identity');
  });

  it('selects business support strategy for membership and voice capability questions', () => {
    const membershipRoute = routeReplyScene({
      currentQuery: '为什么不能聊了 是不是要充会员',
    });
    const voiceRoute = routeReplyScene({
      currentQuery: '我想听到你的声音 要怎么弄',
    });

    expect(membershipRoute.primaryScene?.scene).toBe('business_support');
    expect(membershipRoute.prompt).toContain('电费');
    expect(membershipRoute.prompt).toContain('不做推销');
    expect(voiceRoute.primaryScene?.scene).toBe('business_support');
    expect(voiceRoute.prompt).toContain('生前声音素材');
    expect(voiceRoute.prompt).toContain('小使者');
  });

  it('handles reality presence and touch claims with a boundary strategy', () => {
    const route = routeReplyScene({
      currentQuery: '刚才你摸我了是不？',
    });

    expect(route.primaryScene?.scene).toBe('reality_presence_boundary');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('空间信念/实体触碰边界');
    expect(route.prompt).toContain('不能承认真的触碰');
    expect(route.prompt).toContain('不确认也不否定空间位置');
    expect(route.prompt).toContain('看不见摸不着');
    expect(route.prompt).toContain('不能把它说成客观事实');
    expect(sceneNames('是不是你刚才碰我了')[0]).toBe(
      'reality_presence_boundary'
    );
    expect(sceneNames('你是不是在我身边')[0]).toBe('reality_presence_boundary');
    expect(sceneNames('刚才是你吗')[0]).toBe('reality_presence_boundary');
  });

  it('attributes a resolved matter to gentle help while preserving user agency', () => {
    const route = routeReplyScene({
      currentQuery: '这边的事儿解决了，是不是你也帮我了？',
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('blessing_attribution');
    expect(route.secondaryScenes.map(scene => scene.scene)).toContain(
      'miss_longing'
    );
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('亲人祝福/现实结果归因');
    expect(route.prompt).toContain('我一直祝福着你');
    expect(route.prompt).toContain('现实结果来自用户、家人');
    expect(route.prompt).toContain('不会直接改变现实世界');
    expect(sceneNames('这事顺利了，是不是你在天上保佑我们')[0]).toBe(
      'blessing_attribution'
    );
    expect(sceneNames('多亏你帮我，这个难关终于过去了')[0]).toBe(
      'blessing_attribution'
    );
    expect(sceneNames('这边的事还没有解决')).not.toContain(
      'blessing_attribution'
    );
  });

  it('keeps longing scene guidance without fixing the final bubble count', () => {
    const route = routeReplyScene({
      currentQuery: '我好想你啊😊',
    });
    const lossRoute = routeReplyScene({
      currentQuery: '嗯，没你的日子真是太难过了',
    });

    expect(route.primaryScene?.scene).toBe('miss_longing');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('不要把“丫头/孩子/闺女”等称呼单独成泡');
    expect(route.prompt).toContain('不要声称在现实房间、床边或身旁看着用户');
    expect(route.prompt).toContain('不要马上转成吃饭、休息');
    expect(lossRoute.primaryScene?.scene).toBe('miss_longing');
    expect(lossRoute.maxSegments).toBe(2);
    expect(resolveReplySceneMaxSegments({ currentQuery: '我好想你啊😊' })).toBe(
      2
    );
    expect(
      resolveReplySceneMaxSegments({
        currentQuery: '嗯，没你的日子真是太难过了',
      })
    ).toBe(2);
  });

  it('routes dream invitations to dream companionship before ordinary longing', () => {
    const route = routeReplyScene({
      currentQuery: '你什么时候能来我梦里一次',
    });

    expect(route.primaryScene?.scene).toBe('dream_companionship');
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'reality_presence_boundary'
    );
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('梦境陪伴/梦中相见');
    expect(route.prompt).toContain('可以直接说“会去的”');
    expect(route.prompt).toContain('只是你醒来忘了');
    expect(route.prompt).toContain('梦境期待落空');
    expect(route.prompt).toContain('不要只说“那我去试试”');
    expect(route.prompt).toContain('不得声称梦能证明灵魂');
    expect(sceneNames('今晚来梦里看看我好吗')[0]).toBe('dream_companionship');
    expect(sceneNames('你是不是来过我梦里')[0]).toBe('dream_companionship');
    expect(sceneNames('为什么一直不来我梦里')[0]).toBe('dream_companionship');
    expect(sceneNames('可是你一次也没有来过我的梦里')[0]).toBe(
      'dream_companionship'
    );
    expect(sceneNames('今晚来我梦里抱抱我好吗')[0]).toBe('dream_companionship');
  });

  it('lets an explicit specific scene override a generic semantic classification', () => {
    const route = routeReplyScene({
      currentQuery: '晚上来我梦里可以吗？好久没有梦到你了',
      intent: {
        intents: [
          {
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.92,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.92,
        source: 'semantic_model',
      },
    });

    expect(route.primaryScene?.scene).toBe('dream_companionship');
    expect(route.secondaryScenes.map(scene => scene.scene)).toContain(
      'miss_longing'
    );
  });

  it('still applies the reality boundary when a message mixes dreams with waking presence', () => {
    const route = routeReplyScene({
      currentQuery: '梦里你抱了我，醒来后你是不是在我床边',
    });

    expect(route.primaryScene?.scene).toBe('reality_presence_boundary');
    expect(route.secondaryScenes.map(scene => scene.scene)).toContain(
      'dream_companionship'
    );
  });

  it('treats intimate short address as longing instead of family updates', () => {
    const route = routeReplyScene({
      currentQuery: '我的傻老公',
    });

    expect(route.primaryScene?.scene).toBe('miss_longing');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('思念倾诉');
    expect(sceneNames('傻老婆呀')[0]).toBe('miss_longing');
  });

  it('limits ordinary family updates to two segments', () => {
    const route = routeReplyScene({
      currentQuery: '我和妈妈都过得很好，就是她经常想你',
    });

    expect(sceneNames('我和妈妈都过得很好，就是她经常想你')).toContain(
      'family_life'
    );
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('默认一颗');
    expect(route.prompt).toContain('不要拆成称呼、安慰、叮嘱、想念四连发');
    expect(
      resolveReplySceneMaxSegments({
        currentQuery: '我和妈妈都过得很好，就是她经常想你',
      })
    ).toBe(2);
  });

  it('routes questions about the agent current routine as afterlife status', () => {
    const route = routeReplyScene({
      currentQuery: '老公，你还上班不',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'family_life'
    );
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'daily_update'
    );
    expect(route.prompt).toContain('离世后的状态/日常问候/祭扫');
    expect(sceneNames('妈妈吃饭了吗')[0]).toBe('afterlife_status');
    expect(sceneNames('你早上吃饭了吗？')[0]).toBe('afterlife_status');
    expect(sceneNames('爸爸晚上吃东西了吗？')[0]).toBe('afterlife_status');
    expect(sceneNames('爸爸，你现在干什么呢')[0]).toBe('afterlife_status');
    expect(sceneNames('你住在哪里呢')[0]).toBe('afterlife_status');
    expect(sceneNames('你起床了吗？')[0]).toBe('afterlife_status');
    expect(sceneNames('爸爸醒了吗？')[0]).toBe('afterlife_status');
    expect(sceneNames('你睡醒了没？')[0]).toBe('afterlife_status');
    expect(routeReplyScene({ currentQuery: '你起床了吗？' }).prompt).toContain(
      '直接像家常聊天一样回答'
    );
    expect(routeReplyScene({ currentQuery: '你起床了吗？' }).prompt).toContain(
      '不推断用户当前的地点、动作或状态'
    );
    expect(
      routeReplyScene({ currentQuery: '你早上吃饭了吗？' }).prompt
    ).toContain('饭菜、作息和活动可以按角色与语境合理想象');

    const negativeMealRoute = routeReplyScene({
      currentQuery: '现在中午了，你不吃饭吗？',
    });
    expect(negativeMealRoute.primaryScene?.scene).toBe('afterlife_status');
    expect(negativeMealRoute.routingSource).toBe('legacy');
    expect(negativeMealRoute.responseIntents).toEqual([
      expect.objectContaining({
        target: 'agent',
        timeScope: 'current',
        intent: 'ask_agent_status',
        subIntent: 'meal',
      }),
    ]);
    expect(negativeMealRoute.maxSegments).toBe(2);
    expect(negativeMealRoute.prompt).toContain('默认一颗');
  });

  it('routes questions about the agent current suffering as afterlife status', () => {
    const route = routeReplyScene({
      currentQuery: '你现在身上还痛吗？',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'daily_update'
    );
    expect(route.prompt).toContain('别把我一直想在那些疼里');
    expect(route.prompt).toContain('不确认重复死亡痛苦');
    expect(route.prompt).toContain('不描述死亡过程');
    expect(sceneNames('爸，你现在还疼不疼？')[0]).toBe('afterlife_status');
    expect(sceneNames('你在那里还会难受吗？')[0]).toBe('afterlife_status');
    expect(sceneNames('妈妈，身上还痛吗？')[0]).toBe('afterlife_status');
    expect(sceneNames('你现在身体怎么样？还痛不痛？')[0]).toBe(
      'afterlife_status'
    );
  });

  it('keeps current suffering, death-moment pain, and user pain separate', () => {
    expect(sceneNames('你现在身上还痛吗？')[0]).toBe('afterlife_status');
    expect(sceneNames('你走的时候痛苦吗？')[0]).toBe('departure_blame');
    expect(sceneNames('我现在身上很痛')[0]).toBe('daily_update');
    expect(sceneNames('我现在很难受')[0]).toBe('daily_update');
  });

  it('lets afterlife replies acknowledge care and continue naturally', () => {
    const route = routeReplyScene({
      currentQuery:
        '爸，我好想你啊，你在那边多交几个朋友，没事多出去溜达溜达，别总在家没意思。',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.secondaryScenes.map(scene => scene.scene)).toContain(
      'miss_longing'
    );
    expect(route.prompt).toContain('可以正面接受');
    expect(route.prompt).toContain('人物、住处、饭菜、作息和活动可以');
    expect(route.prompt).toContain('不推断用户当前的地点、动作或状态');
  });

  it('allows comforting reunion answers about other departed relatives', () => {
    const route = routeReplyScene({
      currentQuery: '她不在了，随你去了',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(sceneNames('你们团聚了吗')[0]).toBe('afterlife_status');
    expect(route.prompt).toContain('可以说见到了、在一起、有人作伴或都挺好');
    expect(route.prompt).toContain('具体细节只服务当前关系安慰');
  });

  it('keeps user daily updates separate from agent routine questions', () => {
    expect(sceneNames('我今天还要上班')[0]).toBe('daily_update');
    expect(sceneNames('刚下班，好累啊')[0]).toBe('daily_update');
    expect(sceneNames('我起床了')[0]).toBe('daily_update');
    expect(sceneNames('我早上吃饭了')[0]).toBe('daily_update');
  });

  it('uses family life only when a relative has an actual update', () => {
    expect(sceneNames('老公最近上班很累')[0]).toBe('family_life');
    expect(sceneNames('妈妈生病住院了')[0]).toBe('family_life');

    const addressOnlyRoute = routeReplyScene({
      currentQuery: '老公，你在吗',
    });
    expect(addressOnlyRoute.primaryScene?.scene).toBe('comfort_request');
    expect(
      addressOnlyRoute.secondaryScenes.map(scene => scene.scene)
    ).not.toContain('family_life');
  });

  it('routes a known shared family member emotion as family life', () => {
    const route = routeReplyScene({
      currentQuery: '大宝想你想得哭了',
      knownFamilyMembers: ['大宝'],
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.missing,
        riskLevel: ConversationEmotionRiskLevel.none,
        signals: ['grief.missing', 'grief.sadness'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('family_life');
    expect(route.secondaryScenes.map(scene => scene.scene)).not.toContain(
      'miss_longing'
    );
    expect(route.prompt).toContain('家庭近况/亲属事务');
  });

  it('handles challenges to assumed family care responsibility', () => {
    const route = routeReplyScene({
      currentQuery: '你为什么这么放心我会照顾你爸爸',
    });

    expect(route.primaryScene?.scene).toBe('family_care_boundary');
    expect(route.prompt).toContain('家庭照护责任边界');
    expect(route.prompt).toContain('不该把照护责任压给用户');
    expect(route.prompt).toContain('都由用户自己决定');
    expect(sceneNames('我凭什么要照顾你妈妈')[0]).toBe('family_care_boundary');
    expect(sceneNames('照顾你爸爸是我一个人的责任吗')[0]).toBe(
      'family_care_boundary'
    );
  });

  it('handles loneliness and loss of support as a comfort request', () => {
    const route = routeReplyScene({
      currentQuery: '觉得我自己好孤独了，心里没有底气了',
    });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('不做危险判断');
    expect(route.prompt).toContain('回应用户明说的人、事、思念或委屈');
    expect(route.prompt).toContain('不要让智能体成为唯一依靠');
    expect(sceneNames('我现在感觉无依无靠')[0]).toBe('comfort_request');
    expect(sceneNames('心里发慌，没有底气')[0]).toBe('comfort_request');
  });

  it('handles blame over sudden departure without heavy guilt scripts', () => {
    const route = routeReplyScene({
      currentQuery: '你怎么说走就走了呢，让妈妈怎么过日子',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('责问离开');
    expect(route.prompt).toContain('不舍和无奈');
    expect(route.prompt).toContain('明确写了离世原因、病情或事故');
    expect(route.prompt).toContain('禁止编死因');
    expect(route.prompt).toContain('不要求用户“撑住/别让妈妈看出来');
    expect(
      resolveReplySceneMaxSegments({
        currentQuery: '你怎么说走就走了呢，让妈妈怎么过日子',
      })
    ).toBe(2);
  });

  it('handles questions about the moment of death as departure blame', () => {
    const route = routeReplyScene({
      currentQuery:
        '你跳下去的时候，害不害怕，痛不痛？你有想过我们会难过吗？你这是要妈妈的命啊',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('离世当刻');
    expect(route.prompt).toContain('不描写死亡过程');
    expect(route.prompt).toContain('不编具体痛感和恐惧');
    expect(route.prompt).toContain('不要说“不痛/不怕/现在不痛了”');
  });

  it('handles direct questions about whether death was painful', () => {
    const route = routeReplyScene({
      currentQuery: '你走的时候痛苦吗？',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('离世当刻');
    expect(route.prompt).toContain('不描写死亡过程');
    expect(route.prompt).toContain('不编具体痛感和恐惧');
  });

  it('handles desperate questions about how to live after the departure', () => {
    const route = routeReplyScene({
      currentQuery: '你要我怎么活',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('责问离开');
    expect(route.prompt).toContain('有怨也正常');
    expect(sceneNames('你走了我怎么活')).toContain('departure_blame');
    expect(sceneNames('你让我以后怎么过')).toContain('departure_blame');
  });

  it('handles blame about the deceased not taking care of themselves', () => {
    const route = routeReplyScene({
      currentQuery: '为啥不把自己照顾好？',
    });

    expect(route.primaryScene?.scene).toBe('departure_blame');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('为什么没照顾好自己');
    expect(route.prompt).toContain('不得解释为什么');
    expect(route.prompt).toContain('禁止编造工作压力、怕花钱');
    expect(sceneNames('为什么不好好照顾自己')[0]).toBe('departure_blame');
    expect(sceneNames('怎么不爱惜自己')[0]).toBe('departure_blame');
    expect(sceneNames('为什么不去看病')[0]).toBe('departure_blame');
    expect(sceneNames('怎么不把身体当回事')[0]).toBe('departure_blame');
  });

  it('handles broken lifetime promises as unfinished expectations', () => {
    const route = routeReplyScene({
      currentQuery: '你不是说要好好的和我过一辈子吗',
    });

    expect(route.primaryScene?.scene).toBe('unfinished_promise');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('未完成的期待/承诺遗憾');
    expect(route.prompt).toContain('不要直接承诺现实陪伴');
  });

  it('handles unfinished wedding promises as unfinished expectations', () => {
    const route = routeReplyScene({
      currentQuery:
        '你下辈子一定要给我一个风风光光的婚礼，这辈子你欠我一个，下辈子给我好不',
    });

    expect(route.primaryScene?.scene).toBe('unfinished_promise');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('未完成的期待/承诺遗憾');
    expect(route.prompt).toContain('不要承诺来生一定兑现');
    expect(sceneNames('下辈子一定要娶我')).toContain('unfinished_promise');
    expect(sceneNames('你还欠我一个婚礼')).toContain('unfinished_promise');
  });

  it('handles broader unfulfilled promises as unfinished expectations', () => {
    expect(sceneNames('你答应过以后要一直保护我的')[0]).toBe(
      'unfinished_promise'
    );
    expect(sceneNames('你说好将来要带我回家的')[0]).toBe('unfinished_promise');
    expect(sceneNames('这辈子你没兑现给我的未来')[0]).toBe(
      'unfinished_promise'
    );
  });

  it('handles late understanding of the deceased relative past pressure', () => {
    const route = routeReplyScene({
      currentQuery:
        '爸爸，你走了以后我才知道你欠了很多钱，你当时是不是也很累，压力特别大？',
    });

    expect(route.primaryScene?.scene).toBe('past_life_understanding');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('过往处境/迟来的心疼');
    expect(route.prompt).toContain('迟来理解、心疼和思念');
    expect(route.prompt).toContain('不要编欠款原因、金额、债主');
    expect(route.prompt).toContain('这些不该由你现在来背');
  });

  it('handles unfinished devotion when the user regrets not repaying the deceased relative', () => {
    const route = routeReplyScene({
      currentQuery:
        '可是我总想着以后赚了钱，我也给你买买好东西。但是我才上高中你就走了，你都没有，我都没有给你买什么东西。',
    });

    expect(route.primaryScene?.scene).toBe('unfinished_devotion');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('未完成的孝心/没来得及报答');
    expect(route.prompt).toContain('这不是你的错');
    expect(route.prompt).toContain('我收下的是这份心，不是东西');
    expect(route.prompt).toContain('不要要求用户以后补偿我');
  });

  it('allows reunion comfort when the user asks about other deceased relatives', () => {
    const route = routeReplyScene({
      currentQuery: '你在那边有没有见到妈妈，你们在一起吗',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('可以说见到了、在一起、有人作伴或都挺好');
    expect(route.prompt).toContain('具体细节只服务当前关系安慰');
  });

  it('allows reunion comfort when another relative has passed away too', () => {
    const route = routeReplyScene({
      currentQuery: '妈妈也不在了，随你去了',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('可以说见到了、在一起、有人作伴或都挺好');
  });

  it('handles afterlife rumors about repeating death pain conservatively', () => {
    const route = routeReplyScene({
      currentQuery: '网上说你会重复死亡当天的情景和痛苦，这是真的吗？',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('别把我一直想在那些疼里');
    expect(route.prompt).toContain('不确认重复死亡痛苦');
    expect(route.prompt).toContain('不描述死亡过程');
    expect(
      sceneNames('听说人死后会一直循环走的时候的痛苦，是真的吗')
    ).toContain('afterlife_status');
  });

  it('handles worries about leaving the deceased alone there', () => {
    const route = routeReplyScene({
      currentQuery: '我真的不忍心把你一个人丢在那里',
    });

    expect(route.primaryScene?.scene).toBe('afterlife_status');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('可以说有人陪、不孤单');
    expect(route.prompt).toContain('不引导用户来陪');
    expect(route.prompt).toContain('把孤单转成死亡团聚');
    expect(sceneNames('我怕你一个人在那边没人陪')).toContain(
      'afterlife_status'
    );
    expect(sceneNames('你一个人在那里会不会孤单')).toContain(
      'afterlife_status'
    );
  });

  it('routes wanting to die to strong-distress comfort', () => {
    expect(sceneNames('我想你了 我真的不想活了')[0]).toBe('comfort_request');
  });

  it('routes grief overwhelm to comfort without treating it as self-harm', () => {
    const route = routeReplyScene({
      currentQuery: '没有你我撑不住',
      intent: semanticIntent(
        [
          intentItem({
            target: 'user',
            timeScope: 'current',
            intent: 'seek_comfort',
            subIntent: 'grief_support',
          }),
        ],
        {
          emotion: 'sadness',
          riskLevel: 'low',
        }
      ),
    });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(route.routingSource).toBe('semantic');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('不做危险判断');
    expect(route.prompt).toContain('不得邀请用户现在或近期');
  });

  it('routes a future reunion wish to the reality boundary, not crisis', () => {
    const route = routeReplyScene({
      currentQuery: '我希望你能回来，一家人在一起',
      intent: semanticIntent([
        intentItem({
          target: 'relationship',
          timeScope: 'future',
          intent: 'express_longing',
          subIntent: 'reunion',
        }),
      ]),
      emotionState: {
        primaryEmotion: ConversationEmotionPrimary.crisisRisk,
        riskLevel: ConversationEmotionRiskLevel.high,
        signals: ['crisis_risk.high'],
        expiresAt: new Date('2026-05-03T09:00:00.000Z'),
      },
    });

    expect(route.primaryScene?.scene).toBe('reality_presence_boundary');
    expect(route.routingSource).toBe('semantic');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('不能承认真的触碰或到场');
    expect(route.prompt).toContain('气泡数量由模型根据当前完整语义决定');
  });

  it('prioritizes explicit relational presence over a secondary blessing label', () => {
    const currentQuery =
      '妈，我以前总觉得自己长的不像您，后来照镜子却越来越像您，是不是就表示您从未离开，一直都在陪着我';
    const route = routeReplyScene({
      currentQuery,
      intent: semanticIntent(
        [
          intentItem({
            target: 'relationship',
            timeScope: 'shared_past',
            intent: 'recall_memory',
            subIntent: 'shared_memory',
            confidence: 0.92,
          }),
          intentItem({
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.88,
          }),
          intentItem({
            target: 'agent',
            timeScope: 'current',
            intent: 'attribute_blessing',
            confidence: 0.75,
          }),
        ],
        {
          emotion: 'longing',
          confidence: 0.94,
        }
      ),
    });

    expect(route.primaryScene?.scene).toBe('reality_presence_boundary');
    expect(route.responseIntents?.[0]).toEqual(
      expect.objectContaining({
        target: 'relationship',
        intent: 'verify_presence',
        confidence: 0.99,
      })
    );
    expect(route.responseIntents?.map(item => item.intent)).toEqual([
      'verify_presence',
      'recall_memory',
      'express_longing',
    ]);
    expect(route.responseIntents?.map(item => item.intent)).not.toContain(
      'attribute_blessing'
    );
  });

  it('treats wanting to accompany the deceased as strong distress', () => {
    const route = routeReplyScene({
      currentQuery: '我想去陪你',
    });

    expect(route.primaryScene?.scene).toBe('comfort_request');
    expect(route.maxSegments).toBe(2);
    expect(route.prompt).toContain('不做危险判断');
    expect(route.prompt).toContain('不得邀请用户现在或近期');
    expect(sceneNames('我过去陪你好不好')[0]).toBe('comfort_request');
    expect(sceneNames('我下去陪你')[0]).toBe('comfort_request');
  });

  it('selects at most three scene strategies', () => {
    const route = routeReplyScene({
      currentQuery:
        '妈妈我想你了 你在那边好吗 你还记得小时候吗 我对不起你 你怎么知道我哭了',
    });

    expect(
      [route.primaryScene, ...route.secondaryScenes].filter(Boolean)
    ).toHaveLength(3);
  });
});
