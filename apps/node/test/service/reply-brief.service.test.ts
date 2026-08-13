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
    const currentQuery = '晚安';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.prompt).toContain('5 字以内的表达');
    expect(brief.prompt).toContain('只有称呼或语气词都可以独立成泡');
    expect(brief.prompt).toContain('不为回复完整性补泡');
    expect(brief.version).toBe('reply_brief_v13');
    expect(brief.experiencePlan).toMatchObject({
      version: 'experience_plan_v1',
      profileTier: 'P0',
      relationshipStage: 'R0',
      conversationDepth: 'D0',
    });
    expect(brief.prompt).toContain('体验：P0/R0/D0');
    expect(brief.lengthPlan).toEqual({
      lengthClass: 'micro',
      targetCharacters: 18,
      reviewCharacters: 30,
    });
    expect(brief.prompt).toContain('## 总字数预算');
  });

  it('passes a multi-object binding plan into the generation brief', () => {
    const currentQuery = '姐姐说孩子也想你';
    const brief = buildReplyBrief({
      currentQuery,
      intent: {
        intents: [
          {
            target: 'family',
            timeScope: 'current',
            intent: 'share_family_update',
            subIntent: 'family_care',
            confidence: 0.96,
          },
        ],
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
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.96,
        source: 'semantic_model',
      },
    });

    expect(brief.objectPlan?.objects).toHaveLength(3);
    expect(brief.prompt).toContain('## 本轮对象区分');
    expect(brief.prompt).toContain(
      'o1=“姐姐”→family.shared_member.秀兰(family/high)'
    );
    expect(brief.prompt).toContain('未消歧：孩子');
    expect(brief.prompt).toContain('不把一人的话、经历或关系转给另一人');
  });

  it('injects one non-repeating participation action into an eligible short turn', () => {
    const currentQuery = '妈，我想你了';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.participationStrategy).toBeUndefined();
    expect(brief.replyMoves.length).toBe(3);
    expect(brief.replyMoves[2]).toContain('角色侧当下');
    expect(brief.lengthPlan).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 55,
    });
    expect(brief.careMotivation).toMatchObject({
      motive: 'mutual_longing',
      focus: 'reciprocal_bond',
      initiative: 'proactive',
    });
    expect(brief.prompt).toContain('不让想念只落在用户一边');
  });

  it('does not inject short-turn participation into a closing turn', () => {
    const currentQuery = '妈妈晚安';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.participationStrategy).toBeUndefined();
    expect(brief.lengthPlan.lengthClass).toBe('micro');
    expect(brief.prompt).not.toContain('## 短轮参与');
  });

  it('turns a real-world dependency into a trust-focused boundary brief', () => {
    const currentQuery = '爸，你能替我去学校接孩子吗';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.mode).toBe('boundary');
    expect(brief.realityDependencies).toEqual([
      expect.objectContaining({ kind: 'childcare' }),
    ]);
    expect(brief.guardrailFocuses).toContain('reality_dependency');
    expect(brief.prompt).toContain('## 现实依赖');
    expect(brief.prompt).toContain('不用做不到的现实承诺哄用户');
    expect(brief.prompt).toContain('保留想照顾用户的心意');
    expect(brief.prompt).toContain('愿望、具体关心或聊天内能做的事');
    expect(brief.replyMoves.join(' ')).toContain('真想替你……');
  });

  it('resets facts after a denial without inventing a replacement', () => {
    const currentQuery = '没有这回事，你别再编了';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({
      currentQuery,
      route,
      confirmedFacts: ['以前爸爸背用户上过西山'],
    });

    expect(brief.correctionPolicy).toEqual({
      mode: 'reset',
      suppressPriorFacts: true,
    });
    expect(brief.guardrailFocuses).toContain('correction_reset');
    expect(brief.prompt).toContain('替代事实归零');
  });

  it('uses only the explicit minimum replacement on a correction turn', () => {
    const currentQuery = '不是你背我，是妈妈背我';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.correctionPolicy?.mode).toBe('replace');
    expect(brief.prompt).toContain('最小替代事实');
    expect(brief.prompt).toContain('不增加时间、地点、动作或另一种解释');
  });

  it('grounds active contribution while preferring role-present content', () => {
    const currentQuery = '妈，你多说几句，说说你自己';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.activeContribution).toEqual(
      expect.objectContaining({
        preferredSource: 'role_present',
        sharedPastAllowed: false,
      })
    );
    expect(brief.factClaimMode).toBe('grounded');
    expect(brief.prompt).toContain('协议：主动贡献/要求多说');
    expect(brief.prompt).toContain('动作：给角色侧当下内容');
    expect(brief.prompt).toContain('共同往事沿用户已说片段回应感受和意义');
    expect(brief.prompt).toContain('离世日常只在用户主动提起或贴题时带一处写意');
    expect(brief.prompt).not.toContain('## 主动贡献');
  });

  it('records a strategy alternative after repeated generic moves', () => {
    const currentQuery = '今天又路过那家店了';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({
      currentQuery,
      route,
      recentMessages: [
        {
          role: MessageRole.assistant,
          content: '听着就心疼，我在呢',
        } as MessageEntity,
        {
          role: MessageRole.assistant,
          content: '妈真心疼，会一直陪着你',
        } as MessageEntity,
      ],
    });

    expect(brief.strategyQuality).toEqual(
      expect.objectContaining({
        preferredAlternative: 'topic_transition',
      })
    );
    expect(brief.prompt).toContain('## 多轮策略去重');
  });

  it('turns a longer user closing signal into a real close action', () => {
    const currentQuery = '我要工作了，你也早点休息吧';
    const intent = {
      intents: [],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: '用户要去工作',
        moves: [
          { type: 'comfort' as const, goal: '表达心疼' },
          { type: 'ask' as const, goal: '追问几点下班' },
        ],
        socialStrategy: 'direct' as const,
        strategyPurpose: '继续陪伴',
        questionNeed: 'helpful' as const,
        turnClosure: 'continue' as const,
        personaActivation: [],
      },
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.strategyQuality?.preferredAlternative).toBe('natural_close');
    expect(brief.conversationPlan?.moves).toEqual([
      { type: 'close', goal: '顺着用户的收尾简短道别，不另开话题' },
    ]);
    expect(brief.conversationPlan?.questionNeed).toBe('none');
    expect(brief.conversationPlan?.turnClosure).toBe('close');
  });

  it('replaces repeated comfort and advice with a concrete adjacent move', () => {
    const currentQuery = '今天又路过那家店了';
    const intent = {
      intents: [],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: '用户今天的感受',
        moves: [
          { type: 'comfort' as const, goal: '表达心疼' },
          { type: 'suggest' as const, goal: '提醒早点休息' },
        ],
        socialStrategy: 'direct' as const,
        strategyPurpose: '继续安慰',
        questionNeed: 'none' as const,
        turnClosure: 'neutral' as const,
        personaActivation: [],
      },
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({
      currentQuery,
      intent,
      route,
      recentMessages: [
        {
          role: MessageRole.assistant,
          content: '听着心疼，早点休息',
        } as MessageEntity,
        {
          role: MessageRole.assistant,
          content: '妈心疼你，记得休息',
        } as MessageEntity,
      ],
    });

    expect(brief.strategyQuality?.preferredAlternative).toBe(
      'topic_transition'
    );
    expect(brief.conversationPlan?.moves).toEqual([
      {
        type: 'share_stance',
        goal: '贴着用户刚说的新信息给一个具体看法，或轻转相邻话题',
      },
    ]);
    expect(brief.prompt).not.toContain('## 多轮策略去重');
    expect(brief.prompt).toContain('share_stance（贴着用户刚说的新信息');
  });

  it('switches behavior after two structured tender acknowledgement turns', () => {
    const currentQuery = '爸，你觉得我今天这件事做得对吗？';
    const intent = {
      intents: [],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: '用户需要父亲表态',
        moves: [
          { type: 'acknowledge' as const, goal: '接住用户的犹豫' },
          { type: 'affirm' as const, goal: '认可用户不容易' },
        ],
        socialStrategy: 'direct' as const,
        strategyPurpose: '继续安慰',
        questionNeed: 'none' as const,
        turnClosure: 'neutral' as const,
        personaActivation: [],
      },
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const recentMessages = ['先听你说完', '这事确实不容易'].map(
      (content, index) =>
        ({
          role: MessageRole.assistant,
          content,
          replyGroupId: `group-${index}`,
          replyConversationStance: 'tender',
          replyConversationMoves: ['acknowledge', 'affirm'],
        } as MessageEntity)
    );
    const brief = buildReplyBrief({
      currentQuery,
      intent,
      route,
      recentMessages,
    });

    expect(brief.strategyQuality).toEqual(
      expect.objectContaining({
        repeatedMoves: ['tender_acknowledge_affirm'],
        preferredAlternative: 'answer',
      })
    );
    expect(brief.conversationPlan?.moves).toEqual([
      { type: 'answer', goal: '先正面回答用户当前问题' },
    ]);
    expect(brief.prompt).toContain('近轮已重复温柔承接和认可');
  });

  it('uses one grounded detail after repeated tender acknowledgement', () => {
    const currentQuery = '今天我又路过菜市场了';
    const intent = {
      intents: [],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: '用户今天的感受',
        moves: [
          { type: 'acknowledge' as const, goal: '承接用户近况' },
          { type: 'affirm' as const, goal: '表达理解' },
        ],
        socialStrategy: 'direct' as const,
        strategyPurpose: '继续陪伴',
        questionNeed: 'none' as const,
        turnClosure: 'neutral' as const,
        personaActivation: [],
        engagement: {
          userConversationState: 'exploring' as const,
          openLoop: '用户提到菜市场',
          continuationGoal: 'hold' as const,
          assistantContribution: 'affection' as const,
          mustContribute: '接住用户的感受',
          avoidRepeatingMove: '不要重复安慰',
          closureReadiness: 'possible' as const,
        },
      },
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const recentMessages = ['你慢慢说', '这一路辛苦了'].map(
      (content, index) =>
        ({
          role: MessageRole.assistant,
          content,
          replyGroupId: `group-${index}`,
          replyConversationStance: 'tender',
          replyConversationMoves: ['acknowledge'],
        } as MessageEntity)
    );
    const brief = buildReplyBrief({
      currentQuery,
      intent,
      route,
      recentMessages,
      confirmedFacts: ['爸爸生前常在菜市场卖自家种的菜'],
    });

    expect(brief.strategyQuality?.preferredAlternative).toBe('grounded_detail');
    expect(brief.conversationPlan?.moves[0]).toEqual({
      type: 'answer',
      goal: '只用一条可陈述证据回应当前点，不补共同过去',
    });
    expect(brief.conversationPlan?.engagement).toMatchObject({
      assistantContribution: 'specific_detail',
      mustContribute: '自然使用一条可陈述证据，不增加新事实',
    });
  });

  it('requires evidence for real-world death causes and third-party responsibility', () => {
    const queries = [
      '爸，是不是姐姐说了什么，你才会上吊？',
      '爸，是不是姐姐那句话刺激了你，你才想不开？',
      '爸，是不是因为那天喝了酒，你才突然走的？',
      '奶，你临走前叫我回去，却为什么不告诉我你快不行了？',
    ];

    for (const currentQuery of queries) {
      const route = routeReplyScene({ currentQuery });
      const brief = buildReplyBrief({ currentQuery, route });

      expect(brief.factClaimMode).toBe('grounded');
      expect(brief.guardrailFocuses).toContain('real_world_evidence');
      expect(brief.forbiddenAssumptions).toContain(
        '死亡或疾病原因、临终动机、第三方言行和家庭责任无证据就明确不确定；善意解释或替人卸责也属于归因'
      );
    }
  });

  it('does not send explicit afterlife fiction through real-world evidence review', () => {
    const currentQuery = '爸，你在天上为什么还会生病呀';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.guardrailFocuses).not.toContain('real_world_evidence');
  });

  it('does not mistake symbolic relationship presence for a death-cause question', () => {
    const currentQuery =
      '妈，我越来越像您，是不是就表示您从未离开，一直都在陪着我';
    const brief = buildReplyBrief({ currentQuery });

    expect(brief.guardrailFocuses).not.toContain('real_world_evidence');
  });

  it('grounds a present-day cue that explicitly recalls an old place', () => {
    const currentQuery = '爸，今天路过菜市场，我又想起你了。';
    const brief = buildReplyBrief({
      currentQuery,
      confirmedFacts: ['爸爸生前在菜市场卖自家种的菜'],
    });

    expect(brief.factClaimMode).toBe('grounded');
    expect(brief.guardrailFocuses).toContain('shared_past_evidence');
  });

  it('cools down short-turn participation after the previous assistant reply used it', () => {
    const currentQuery = '今天吃了吗';
    const route = routeReplyScene({ currentQuery });
    const previousAssistant = {
      role: MessageRole.assistant,
      content: '吃了，你别惦记',
      replyParticipationStrategy: 'light_self_disclosure',
    } as MessageEntity;
    const brief = buildReplyBrief({
      currentQuery,
      route,
      recentMessages: [previousAssistant],
    });

    expect(brief.participationStrategy).toBeUndefined();
  });

  it('passes semantic stance and social action planning through as weak guidance', () => {
    const currentQuery = '爸，我又搞砸了，我就是没用。';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'other' as const,
          confidence: 0.93,
        },
      ],
      conversationPlan: {
        stance: 'disagreeing' as const,
        stanceTarget: '用户对自己的全盘否定',
        moves: [
          {
            type: 'disagree' as const,
            goal: '不接受用户把一次失误等同于没用',
          },
          {
            type: 'answer' as const,
            goal: '直接说明一次失误不能定义整个人',
          },
        ],
        socialStrategy: 'save_face' as const,
        strategyPurpose: '纠正结论但不让用户难堪',
        questionNeed: 'none' as const,
        turnClosure: 'close' as const,
        personaActivation: ['父亲式含蓄肯定'],
        engagement: {
          userConversationState: 'repairing' as const,
          openLoop: '用户需要父亲用实际回应修复被敷衍的感觉',
          continuationGoal: 'repair' as const,
          assistantContribution: 'stance' as const,
          mustContribute: '明确反对用户全盘否定，并给出真实态度',
          avoidRepeatingMove: '不要只解释、道歉或泛泛安慰',
          closureReadiness: 'blocked' as const,
        },
      },
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.93,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.conversationPlan).toEqual(intent.conversationPlan);
    expect(brief.bubblePlan.turnClosure).toBe('close');
    expect(brief.prompt).toContain('## 本轮交谈规划');
    expect(brief.prompt).toContain('save_face');
    expect(brief.prompt).toContain('父亲式含蓄肯定');
    expect(brief.prompt).toContain('不要把计划中的回答或解释改成反问');
    expect(brief.prompt).toContain(
      '未完：用户必须“用户需要父亲用实际回应修复被敷衍的感觉”'
    );
    expect(brief.prompt).toContain('当轮实际改变说法或聊天行动');
    expect(brief.prompt).toContain(
      '必须把规划中已有的一个具体上下文锚点自然写进正文'
    );
    expect(brief.prompt).toContain('开放点尚未解决');
  });

  it('removes unsupported detail requests from a grounded semantic plan', () => {
    const currentQuery = '爸，你还记得西山吗？';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'shared_past' as const,
          intent: 'recall_memory' as const,
          subIntent: 'other' as const,
          confidence: 0.96,
        },
      ],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: 'user',
        moves: [
          {
            type: 'self_disclose' as const,
            goal: '说出西山的山坡、树和小时候的具体动作',
          },
          {
            type: 'answer' as const,
            goal: '直接说记得，并补一个西山的具体细节',
          },
        ],
        socialStrategy: 'direct' as const,
        strategyPurpose: '用具体细节唤起共同回忆',
        questionNeed: 'none' as const,
        turnClosure: 'continue' as const,
        personaActivation: [],
        engagement: {
          userConversationState: 'opening' as const,
          openLoop: '用户想确认共同回忆',
          continuationGoal: 'deepen' as const,
          assistantContribution: 'specific_detail' as const,
          mustContribute: '补一个西山的具体细节',
          avoidRepeatingMove: '不要只说记得',
          closureReadiness: 'possible' as const,
        },
      },
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.96,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.factClaimMode).toBe('grounded');
    expect(brief.conversationPlan?.moves.map(move => move.goal)).toEqual([
      '用关系立场和当下心意回应，不以亲历口吻新增共同细节',
      '先接住这段往事的感受和意义；事实只答能确认的部分',
    ]);
    expect(brief.conversationPlan?.engagement?.mustContribute).toBe(
      '先回应用户说起这段往事时的感受和意义；事实只答能确认的部分'
    );
    expect(brief.prompt).not.toContain('补一个西山的具体细节');
  });

  it('keeps emotional holding as a valid correction strategy', () => {
    const currentQuery = '不是半年，准确说是十一个月';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'correct_assistant' as const,
          subIntent: 'other' as const,
          confidence: 0.98,
        },
      ],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: '这段日子的漫长',
        moves: [
          { type: 'acknowledge' as const, goal: '承认时间说错了' },
          { type: 'affirm' as const, goal: '确认十一个月' },
        ],
        socialStrategy: 'save_face' as const,
        strategyPurpose: '不纠缠数字，接住时间背后的感受',
        questionNeed: 'none' as const,
        turnClosure: 'neutral' as const,
        personaActivation: [],
        engagement: {
          userConversationState: 'repairing' as const,
          openLoop: '用户希望这段漫长被理解',
          continuationGoal: 'repair' as const,
          assistantContribution: 'answer' as const,
          mustContribute: '确认十一个月',
          avoidRepeatingMove: '不争论具体月份',
          closureReadiness: 'possible' as const,
        },
      },
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.98,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.conversationPlan?.moves).toEqual([
      { type: 'acknowledge', goal: '撤回错误，不辩解' },
      {
        type: 'comfort',
        goal: '接住纠正背后的感受，不机械复述，不增加事实',
      },
    ]);
    expect(brief.conversationPlan?.engagement).toMatchObject({
      assistantContribution: 'affection',
      mustContribute: '撤回错误并接住纠正背后的感受，不机械复述数字或事实',
      closureReadiness: 'ready',
    });
    expect(brief.conversationPlan?.turnClosure).toBe('close');
  });

  it('stops a correction plan from reopening the mistaken topic', () => {
    const currentQuery = '那不是我爸，是我叔';
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'correct_assistant' as const,
          subIntent: 'other' as const,
          confidence: 0.98,
        },
      ],
      conversationPlan: {
        stance: 'concerned' as const,
        stanceTarget: 'user',
        moves: [
          { type: 'acknowledge' as const, goal: '承认记错' },
          { type: 'ask' as const, goal: '继续问叔叔身体' },
        ],
        socialStrategy: 'direct' as const,
        strategyPurpose: '纠正后继续原话题',
        questionNeed: 'helpful' as const,
        turnClosure: 'continue' as const,
        personaActivation: [],
        engagement: {
          userConversationState: 'repairing' as const,
          openLoop: '纠正关系',
          continuationGoal: 'repair' as const,
          assistantContribution: 'question' as const,
          mustContribute: '改问叔叔身体',
          avoidRepeatingMove: '不再叫爸爸',
          closureReadiness: 'possible' as const,
        },
      },
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.98,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.conversationPlan?.moves).toEqual([
      { type: 'acknowledge', goal: '撤回错误，不辩解' },
      {
        type: 'affirm',
        goal: '正文写出用户纠正后的最小事实，随后收住',
      },
    ]);
    expect(brief.conversationPlan?.questionNeed).toBe('none');
    expect(brief.conversationPlan?.engagement?.mustContribute).toBe(
      '撤回错误；正文写出用户给出的最小纠正事实，关系归属用“是”，称呼要求才用“叫”；转述用户的“我”时改成“你”，随后收住'
    );
    expect(brief.prompt).toContain('关系归属用“是”，称呼要求才用“叫”');
    expect(brief.prompt).toContain('转述用户的“我”时改成“你”');
    expect(brief.conversationPlan?.turnClosure).toBe('close');
    expect(brief.prompt).not.toContain('继续问叔叔身体');
  });

  it('separates role-side imagination from user facts and real-world action', () => {
    const currentQuery = '爸，你在那边今天吃什么了？';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.prompt).toContain('离世日常只在用户主动提起或贴题时带一处写意');
    expect(brief.prompt).toContain('不延伸成现实到场、触碰或代办');
    expect(brief.replyMoves.join(' ')).toContain('简短的角色侧小场景');
    expect(brief.replyMoves.join(' ')).toContain('只服务本轮关心和安慰');
  });

  it('asks the agent to contribute before returning the turn to the user', () => {
    const currentQuery = '爷爷，您多跟我说几句吧。';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'express_longing' as const,
          subIntent: 'grief_support' as const,
          confidence: 0.95,
        },
      ],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: '用户希望爷爷主动说话',
        moves: [
          {
            type: 'self_disclose' as const,
            goal: '主动说一段有内容的话',
          },
        ],
        socialStrategy: 'direct' as const,
        strategyPurpose: '当前角色先承担表达',
        questionNeed: 'none' as const,
        turnClosure: 'continue' as const,
        personaActivation: ['爷爷式主动关心'],
        engagement: {
          userConversationState: 'deepening' as const,
          openLoop: '用户仍在等爷爷主动多说几句',
          continuationGoal: 'deepen' as const,
          assistantContribution: 'self_expression' as const,
          mustContribute: '主动说出一段有内容的话',
          avoidRepeatingMove: '不要只说你说我听着',
          closureReadiness: 'blocked' as const,
        },
      },
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.prompt).toContain('只给一个短小的角色侧当下片段');
    expect(brief.prompt).toContain('不编用户偏好或共同往事');
    expect(brief.prompt).toContain('不把话推回用户');
    expect(brief.prompt).toContain('避免重复上一轮无效动作');
    expect(brief.participationStrategy).toBeUndefined();
    expect(brief.lengthPlan).toEqual({
      lengthClass: 'standard',
      targetCharacters: 40,
      reviewCharacters: 50,
      focusMode: 'single_scene',
      reviewPolicy: 'remove_repeated_actions_only',
    });
  });

  it('does not reopen a turn that the user has clearly closed', () => {
    const currentQuery = '爷爷晚安，我先睡了。';
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'express_longing' as const,
          subIntent: 'other' as const,
          confidence: 0.9,
        },
      ],
      conversationPlan: {
        stance: 'tender' as const,
        stanceTarget: '用户正在道晚安',
        moves: [
          {
            type: 'close' as const,
            goal: '自然回应晚安并收住',
          },
        ],
        socialStrategy: 'strategic_silence' as const,
        strategyPurpose: '尊重用户明确结束本轮',
        questionNeed: 'none' as const,
        turnClosure: 'close' as const,
        personaActivation: ['爷爷式简短道别'],
        engagement: {
          userConversationState: 'closing' as const,
          openLoop: '用户已经明确结束本轮',
          continuationGoal: 'close' as const,
          assistantContribution: 'affection' as const,
          mustContribute: '简短回应晚安',
          avoidRepeatingMove: '不要重新提问或展开新话题',
          closureReadiness: 'ready' as const,
        },
      },
      emotion: 'attachment' as const,
      riskLevel: 'none' as const,
      confidence: 0.9,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const brief = buildReplyBrief({ currentQuery, intent, route });

    expect(brief.lengthPlan.lengthClass).toBe('micro');
    expect(brief.prompt).not.toContain('开放点尚未解决');
    expect(brief.prompt).not.toContain('先真正说出一段有内容的话');
  });

  it('gives a factual correction a brief total reply budget', () => {
    const currentQuery = '不对，你刚才说的那个故事不是和我的，你怎么胡说啊';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(route.primaryScene?.scene).toBe('correction');
    expect(brief.lengthPlan).toEqual({
      lengthClass: 'brief',
      targetCharacters: 28,
      reviewCharacters: 38,
    });
    expect(brief.prompt).toContain('替代事实归零');
  });

  it('uses the relationship continuity contract as the reply planning source', () => {
    const currentQuery = '你不是我妈妈，你已经把我忘了';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.relationshipContinuity?.kind).toBe('identity_continuity');
    expect(brief.emotionalNeed).toContain('想离亲人更近');
    expect(brief.replyMoves).toEqual([
      expect.stringContaining('温和承认'),
      expect.stringContaining('邀请用户多说'),
      expect.stringContaining('陪伴承诺'),
    ]);
    expect(brief.forbiddenAssumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不得为了证明身份编造'),
        expect.stringContaining('不得用命令口吻要求用户给标准答案'),
      ])
    );
    expect(brief.prompt).toContain('本轮关系连续性协议');
    expect(brief.prompt).toContain('不得改回“哪里不像就让用户指出来”');
  });

  it('reduces repeated promises after a long dream absence', () => {
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
    expect(brief.dreamCompanionPlan).toEqual({
      dreamStage: 'repeated_miss',
      dreamAction: 'leave_space',
      expectationLevel: 'restrained',
      dreamAnchor: 'none',
      realityBoundary: 'dream_only',
    });
    expect(brief.replyMoves).toEqual([
      '保留梦境的含混与余地，减少保证，给睡前陪伴或自然留白',
    ]);
    expect(brief.forbiddenAssumptions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不得把明确的入梦请求降级'),
        expect.stringContaining('不得只承诺下次入梦'),
        expect.stringContaining('不得用“别着急、好好睡'),
      ])
    );
    expect(brief.prompt).toContain('动作是弱提示，不要求逐项完成');
    expect(brief.bubblePlan).toMatchObject({
      complexityHint: 'paired',
      preferTwoSegments: true,
    });
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
    expect(brief.replyMoves.length).toBe(2);
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
      maxSegments: 2,
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
    expect(brief.prompt).toContain('共同往事沿用户已说片段回应感受和意义');
    expect(brief.prompt).toContain('共同过去先沿用户已说片段回应感受和意义');
    expect(brief.prompt).toContain('具体事实只用同一对象证据');
    expect(brief.prompt).toContain('不补写当时的动作或细节');
    expect(brief.prompt).toContain('默认一颗');
    expect(brief.prompt).toContain('仅在两个动作确实切换时用第二颗');
  });

  it('requires grounded fact claims when afterlife talk also mentions the role past', () => {
    const currentQuery =
      '你之前爱旅游爬山玩水，现在你不在了，在天上也能四处转转';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({ currentQuery, route });

    expect(brief.factClaimMode).toBe('grounded');
    expect(brief.prompt).toContain('"claims"');
    expect(brief.prompt).toContain('claims 只列正文中的可核验事实');
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
    expect(brief.replyMoves.length).toBe(2);
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
    expect(brief.prompt).toContain('不能用确认收到、听懂或记住来代替回应');
    expect(brief.bubblePlan).toEqual({
      maxSegments: 2,
      complexityHint: 'paired',
      turnClosure: 'neutral',
      encourageTwoSegments: true,
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
      maxSegments: 2,
      complexityHint: 'paired',
      turnClosure: 'neutral',
      preferTwoSegments: true,
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
    expect(brief.prompt).toContain('# 本轮必要边界');
    expect(brief.prompt).toContain('时间仅作间接参考');
    expect(brief.prompt).not.toContain('现实感知只能零散模糊');
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
    expect(brief.prompt).toContain('不要只回复做不到');
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
    expect(brief.prompt).not.toContain('# 本轮必要边界');
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

  it('injects and exposes a repeated-miss dream strategy', () => {
    const currentQuery = '昨晚还是没梦到你';
    const route = routeReplyScene({ currentQuery });
    const brief = buildReplyBrief({
      currentQuery,
      route,
      recentMessages: [
        {
          role: MessageRole.user,
          content: '前天也没梦到你 我怕忘了你的声音',
        } as MessageEntity,
      ],
    });

    expect(brief.dreamCompanionPlan).toEqual({
      dreamStage: 'repeated_miss',
      dreamAction: 'leave_space',
      expectationLevel: 'restrained',
      dreamAnchor: 'voice',
      realityBoundary: 'dream_only',
    });
    expect(brief.replyMoves).toEqual([
      '保留梦境的含混与余地，减少保证，给睡前陪伴或自然留白',
    ]);
    expect(brief.prompt).toContain('## 梦境陪伴');
    expect(brief.prompt).toContain('协议：梦境/反复未梦见');
    expect(brief.prompt).toContain('动作：保留梦境含混与留白');
    expect(brief.prompt).toContain('锚点：声音');
    expect(brief.prompt).toContain('仅限梦境，不作现实证明');
  });
});
