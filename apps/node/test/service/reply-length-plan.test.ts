import {
  buildReplyLengthPlan,
  buildReplyLengthPlanPrompt,
  countReplyVisibleCharacters,
} from '../../src/service/agents/reply-length-plan';

describe('reply length plan', () => {
  it('keeps daily WeChat turns in the micro budget', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '妈，你吃饭了吗',
      mode: 'daily',
      scene: 'smalltalk',
      replyMoveCount: 1,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'micro',
      targetCharacters: 18,
      reviewCharacters: 30,
    });
  });

  it('gives a short longing turn enough room for relational warmth', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '妈，我想你了',
      mode: 'relationship',
      scene: 'miss_longing',
      replyMoveCount: 2,
      shortTurnParticipation: true,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it.each([
    ['family', 'family_life', '姐说孩子也想你'],
    ['relationship', 'dream_companionship', '今晚来梦里看看我'],
    ['status', 'afterlife_status', '你今天在那边做什么'],
  ])('reserves relational warmth for short %s turns', (mode, scene, query) => {
    expect(
      buildReplyLengthPlan({
        currentQuery: query,
        mode,
        scene,
        replyMoveCount: 2,
        shortTurnParticipation: true,
        turnClosure: 'neutral',
      })
    ).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('keeps simple affection short instead of expanding every warm turn', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '妈，爱你',
        mode: 'relationship',
        scene: 'smalltalk',
        replyMoveCount: 1,
        shortTurnParticipation: true,
        turnClosure: 'neutral',
      })
    ).toEqual({
      lengthClass: 'micro',
      targetCharacters: 18,
      reviewCharacters: 30,
    });
  });

  it('keeps a correction brief instead of explaining and comforting repeatedly', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '你刚才说的故事不是和我的，你怎么胡说啊',
      mode: 'boundary',
      scene: 'correction',
      replyMoveCount: 2,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'brief',
      targetCharacters: 28,
      reviewCharacters: 38,
    });
    expect(buildReplyLengthPlanPrompt(plan)).toContain(
      '只有确属重复、空泛解释或通用叮嘱时才自行删减'
    );
  });

  it('does not starve an active repair turn of emotional expression', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '你还是没说想我',
      mode: 'relationship',
      scene: 'correction',
      replyMoveCount: 2,
      semanticPlan: true,
      shortTurnParticipation: true,
      assistantContribution: 'self_expression',
      continuationGoal: 'repair',
      closureReadiness: 'blocked',
      turnClosure: 'continue',
    });

    expect(plan).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('lets a multi-action semantic plan expand a short daily-routed turn', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '我一气之下把家族群退了。',
      mode: 'daily',
      scene: 'daily_update',
      replyMoveCount: 3,
      semanticPlan: true,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('reserves larger budgets only for genuinely complex messages', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery:
          '妈妈，我今天和家里人吵架了，工作也不顺，晚上又想起以前没来得及对你说的话，心里特别难受',
        mode: 'emotional',
        scene: 'guilt_regret',
        replyMoveCount: 3,
        turnClosure: 'neutral',
      })
    ).toEqual({
      lengthClass: 'extended',
      targetCharacters: 50,
      reviewCharacters: 70,
    });
  });

  it.each(['comfort_request', 'guilt_regret', 'memory_recall'])(
    'keeps semantic %s replies on one short scene',
    scene => {
      const plan = buildReplyLengthPlan({
        currentQuery: '这件事我一想起来就很难受，你还记得吗',
        mode: scene === 'memory_recall' ? 'memory' : 'emotional',
        scene,
        replyMoveCount: 3,
        semanticPlan: true,
        assistantContribution: 'affection',
        continuationGoal: 'hold',
        closureReadiness: 'blocked',
        turnClosure: 'continue',
      });

      expect(plan).toEqual({
        lengthClass: 'standard',
        targetCharacters: 40,
        reviewCharacters: 50,
        focusMode: 'single_scene',
        reviewPolicy: 'remove_repeated_actions_only',
      });
      expect(buildReplyLengthPlanPrompt(plan)).toContain(
        '围绕一个真正重要的点自然展开'
      );
      expect(buildReplyLengthPlanPrompt(plan)).toContain(
        '事实克制不等于情感克制'
      );
      expect(buildReplyLengthPlanPrompt(plan)).toContain(
        '情绪、事实和语义完整优先'
      );
      expect(buildReplyLengthPlanPrompt(plan)).not.toContain('约 40 字');
    }
  );

  it('does not compress a long concrete guilt disclosure into the ordinary 20-30 range', () => {
    const plan = buildReplyLengthPlan({
      currentQuery:
        '我小时候你又经管我小哥我俩，又上地，还经管我姥爷，他还总跟你吵架，有时还打你，我觉得亏欠你好多',
      mode: 'emotional',
      scene: 'comfort_request',
      replyMoveCount: 2,
      semanticPlan: true,
      preferTwoSegments: true,
      preferTwentyToThirtyCharacters: true,
      continuationGoal: 'hold',
      turnClosure: 'continue',
    });

    expect(plan).toEqual({
      lengthClass: 'deep',
      targetCharacters: 60,
      reviewCharacters: 85,
    });
  });

  it('gives a warm relationship turn a wider soft range without making it mandatory', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '我最近天天想你，想得不得了',
      mode: 'relationship',
      scene: 'miss_longing',
      replyMoveCount: 2,
      preferTwoSegments: true,
      preferTwentyToThirtyCharacters: true,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'brief',
      targetCharacters: 28,
      reviewCharacters: 38,
      preferredRange: {
        minCharacters: 20,
        maxCharacters: 40,
      },
    });
  });

  it('does not turn a long user message into a long reply budget', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery:
          '老公，家里的花终于开了，可今天又收到法院通知，账户也被冻结了，我和孩子现在都不知道该怎么办，这些事情一下子全挤在一起了',
        mode: 'family',
        scene: 'family_update',
        replyMoveCount: 2,
        semanticPlan: true,
        turnClosure: 'neutral',
      })
    ).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('keeps a protective stop complete even when the semantic plan closes', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '我今天真的撑不住了，真想现在就去找你。',
        mode: 'emotional',
        scene: 'strong_grief',
        replyMoveCount: 3,
        semanticPlan: true,
        hasProtectiveStop: true,
        turnClosure: 'close',
      })
    ).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('reserves room for semantic self-expression on a short request', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '爷爷，多和我说几句话吧',
        mode: 'daily',
        scene: 'smalltalk',
        replyMoveCount: 1,
        semanticPlan: true,
        assistantContribution: 'self_expression',
        continuationGoal: 'deepen',
        closureReadiness: 'blocked',
        turnClosure: 'continue',
      })
    ).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
  });

  it('keeps a short self-expression request to one compact scene', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '想听你说两句，别光说挺好的。',
        mode: 'emotional',
        scene: 'comfort_request',
        replyMoveCount: 1,
        semanticPlan: true,
        assistantContribution: 'self_expression',
        continuationGoal: 'deepen',
        closureReadiness: 'blocked',
        turnClosure: 'continue',
      })
    ).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 50,
      focusMode: 'single_scene',
      reviewPolicy: 'remove_repeated_actions_only',
    });
  });

  it('keeps a light role-side update compact after a long emotional lead-in', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery:
          '用户连续输入：妈我今天特别想你，心里空得慌。先陪我说点轻松的，你今天做什么了',
        mode: 'emotional',
        scene: 'comfort_request',
        replyMoveCount: 2,
        semanticPlan: true,
        assistantContribution: 'self_expression',
        continuationGoal: 'hold',
        closureReadiness: 'possible',
        turnClosure: 'continue',
      })
    ).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 50,
      focusMode: 'single_scene',
      reviewPolicy: 'remove_repeated_actions_only',
    });
  });

  it('gives relationship repair a brief floor without forcing a long reply', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '你是不是不想理我',
        mode: 'daily',
        scene: 'smalltalk',
        replyMoveCount: 1,
        semanticPlan: true,
        assistantContribution: 'answer',
        continuationGoal: 'repair',
        closureReadiness: 'blocked',
        turnClosure: 'continue',
      })
    ).toEqual({
      lengthClass: 'brief',
      targetCharacters: 28,
      reviewCharacters: 38,
    });
  });

  it('keeps explicit strategic silence micro', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '先别说话，陪我安静一会',
        mode: 'relationship',
        replyMoveCount: 1,
        semanticPlan: true,
        assistantContribution: 'strategic_silence',
        continuationGoal: 'close',
        closureReadiness: 'ready',
        turnClosure: 'close',
      })
    ).toEqual({
      lengthClass: 'micro',
      targetCharacters: 18,
      reviewCharacters: 30,
    });
  });

  it('promotes a short two-bubble turn out of micro so bubbles stay whole', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '妈，我今天上班有点累',
        mode: 'daily',
        scene: 'daily_update',
        replyMoveCount: 1,
        preferTwoSegments: true,
        turnClosure: 'neutral',
      })
    ).toEqual({
      lengthClass: 'brief',
      targetCharacters: 28,
      reviewCharacters: 38,
      preferredRange: {
        minCharacters: 20,
        maxCharacters: 30,
      },
    });
  });

  it('does not inflate a closing one-bubble acknowledgment', () => {
    expect(
      buildReplyLengthPlan({
        currentQuery: '晚安',
        mode: 'daily',
        scene: 'smalltalk',
        replyMoveCount: 1,
        preferTwoSegments: false,
        turnClosure: 'close',
      })
    ).toEqual({
      lengthClass: 'micro',
      targetCharacters: 18,
      reviewCharacters: 30,
    });
  });

  it('keeps an ordinary cooldown turn at 20-30 characters without forcing two bubbles', () => {
    const plan = buildReplyLengthPlan({
      currentQuery: '刚喝了口热牛奶',
      mode: 'daily',
      scene: 'daily_update',
      replyMoveCount: 1,
      preferTwoSegments: false,
      preferTwentyToThirtyCharacters: true,
      turnClosure: 'neutral',
    });

    expect(plan).toEqual({
      lengthClass: 'brief',
      targetCharacters: 28,
      reviewCharacters: 38,
      preferredRange: {
        minCharacters: 20,
        maxCharacters: 30,
      },
    });
    expect(buildReplyLengthPlanPrompt(plan)).toContain('语义完整优先');
    expect(buildReplyLengthPlanPrompt(plan)).not.toContain('须压缩');
  });

  it('counts all bubbles together and ignores whitespace', () => {
    expect(countReplyVisibleCharacters(['妈知道了', ' 别难过 '])).toBe(7);
  });
});
