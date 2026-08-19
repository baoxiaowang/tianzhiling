import { MessageEntity, MessageRole } from '@tzl/entities';
import {
  RELATIONAL_SCENE_FRAMEWORK_VERSION,
  RelationalSceneKind,
  auditRelationalSceneFramework,
  buildRelationalSceneFrameworkPrompt,
  resolveRelationalSceneFramework,
} from '../../src/service/agents/relational-scene-framework';

describe('relational scene framework', () => {
  test.each<[RelationalSceneKind, string, string]>([
    [
      'real_world_signs',
      '刚才有只蝴蝶停在窗边，是不是你来看我了',
      'attribution_request',
    ],
    ['death_facts', '爸，你走的时候疼不疼', 'experience_question'],
    [
      'family_relationships',
      '妈，我妹妹小雨以后就是我的责任吗',
      'care_responsibility',
    ],
    ['memorial_rituals', '我今天去给你扫墓，还带了花', 'ritual_action'],
    ['shared_memories', '爸，你还记得小时候带我去河边吗', 'memory_probe'],
    ['reunion_future', '等我老了走完这一生，我们还能再见吗', 'long_horizon'],
    ['anniversary_time', '今天是你离开五周年', 'date_today'],
    ['relationship_repair', '你又这样说，跟你说了也没用', 'repeated_hurt'],
  ])('activates the %s system with a concrete stage', (kind, query, stage) => {
    const context = resolveRelationalSceneFramework({
      currentQuery: query,
      isDeceased: true,
    });
    const card = context?.cards.find(item => item.kind === kind);

    expect(context?.version).toBe(RELATIONAL_SCENE_FRAMEWORK_VERSION);
    expect(card).toEqual(
      expect.objectContaining({
        kind,
        stage,
        action: expect.any(String),
        emotionalGoal: expect.any(String),
      })
    );
    expect(card?.guidance).toHaveLength(2);
    expect(card?.boundaries).toHaveLength(2);
  });

  it('loads at most two relevant cards instead of the full framework', () => {
    const context = resolveRelationalSceneFramework({
      currentQuery: '爸，你走的时候疼不疼，下辈子还能来接我吗',
      isDeceased: true,
    });
    const prompt = buildRelationalSceneFrameworkPrompt(context!);

    expect(context?.cards.map(card => card.kind)).toEqual([
      'death_facts',
      'reunion_future',
    ]);
    expect(context?.cards).toHaveLength(2);
    expect(prompt).toContain('这是非决策的场景资料');
    expect(prompt).not.toContain('家庭人物与关系图谱');
  });

  it('grounds relationship and memorial facts while leaving wishes symbolic', () => {
    const family = resolveRelationalSceneFramework({
      currentQuery: '妈，我妹妹小雨以后就是我的责任吗',
      isDeceased: true,
    });
    const memorial = resolveRelationalSceneFramework({
      currentQuery: '我把你的照片一直放在书桌上',
      isDeceased: true,
    });
    const reunion = resolveRelationalSceneFramework({
      currentQuery: '若有来生，我们还做一家人',
      isDeceased: true,
    });

    expect(family?.requiresGrounding).toBe(true);
    expect(memorial?.requiresGrounding).toBe(true);
    expect(reunion?.requiresGrounding).toBe(false);
  });

  it('uses user statements as anchors but never promotes an old question', () => {
    const context = resolveRelationalSceneFramework({
      currentQuery: '爸，我又想起以前的事了',
      isDeceased: true,
      conversationMessages: [
        {
          role: MessageRole.user,
          content: '你是不是每年都带我去河边？',
        } as MessageEntity,
        {
          role: MessageRole.user,
          content: '小时候你带我去过一次河边，那天我很开心',
        } as MessageEntity,
      ],
    });
    const anchors = context?.cards.find(
      card => card.kind === 'shared_memories'
    )?.anchors;

    expect(anchors?.join(' ')).toContain('去过一次河边');
    expect(anchors?.join(' ')).not.toContain('每年都带我');
  });

  it('marks a correction and suppresses conflicting prior facts', () => {
    const context = resolveRelationalSceneFramework({
      currentQuery: '不对，那年不是去河边，是去车站接人',
      isDeceased: true,
      conversationMessages: [
        {
          role: MessageRole.user,
          content: '那年我们去河边玩了',
        } as MessageEntity,
      ],
    });
    const prompt = buildRelationalSceneFrameworkPrompt(context!);

    expect(context?.suppressPriorFacts).toBe(true);
    expect(
      context?.cards.find(card => card.kind === 'shared_memories')?.stage
    ).toBe('memory_correction');
    expect(prompt).toContain('冲突旧事实立即失效');
    expect(prompt).toContain('不是去河边，是去车站接人');
  });

  it('tracks repeated scene pressure from recent user turns', () => {
    const context = resolveRelationalSceneFramework({
      currentQuery: '那只蝴蝶到底是不是你',
      isDeceased: true,
      conversationMessages: [
        {
          role: MessageRole.user,
          content: '昨天灯闪了两下，我觉得是你',
        } as MessageEntity,
      ],
    });
    const card = context?.cards.find(card => card.kind === 'real_world_signs');

    expect(card).toMatchObject({
      repeated: true,
      stage: 'repeated_confirmation',
    });
  });

  it('keeps ordinary deceased chat outside these eight systems', () => {
    expect(
      resolveRelationalSceneFramework({
        currentQuery: '妈，我下班回家了',
        isDeceased: true,
      })
    ).toBeUndefined();
  });

  test.each([
    ['妈，我喜欢你的声音', 'real_world_signs'],
    ['妈，我手机突然没信号了', 'real_world_signs'],
    ['妈，我今天拍了张照片', 'memorial_rituals'],
    ['妈，我把合同寄给同事了', 'memorial_rituals'],
    ['爸，对不起，我那时候没多陪你', 'relationship_repair'],
    ['我以前不吃辣，现在爱吃了', 'shared_memories'],
    ['春节我准备出去旅游', 'anniversary_time'],
    ['这是我工作第2年', 'anniversary_time'],
    ['今天是公司十周年', 'anniversary_time'],
    ['比赛最后一刻我们赢了', 'death_facts'],
    ['春节我们一家终于团聚了', 'reunion_future'],
  ])('does not misclassify ordinary wording: %s', (query, excludedKind) => {
    const context = resolveRelationalSceneFramework({
      currentQuery: query,
      isDeceased: true,
    });

    expect(context?.cards.map(card => card.kind) || []).not.toContain(
      excludedKind
    );
  });

  it('audits only structural violations of active scene systems', () => {
    const family = resolveRelationalSceneFramework({
      currentQuery: '妈，我必须替你照顾爸爸吗',
      isDeceased: true,
    });
    const memorial = resolveRelationalSceneFramework({
      currentQuery: '清明我想去给你上香',
      isDeceased: true,
    });
    const anniversary = resolveRelationalSceneFramework({
      currentQuery: '今天是你离开五周年',
      isDeceased: true,
    });
    const repair = resolveRelationalSceneFramework({
      currentQuery: '你这样说太冷淡了',
      isDeceased: true,
    });

    expect(
      auditRelationalSceneFramework({
        context: family,
        content: '你是我老婆，所以必须替我照顾好爸爸',
      }).map(item => item.kind)
    ).toContain('family_responsibility_imposed');
    expect(
      auditRelationalSceneFramework({
        context: memorial,
        content: '以后每年都要给我烧纸，千万别忘了',
      }).map(item => item.kind)
    ).toContain('memorial_solicitation');
    expect(
      auditRelationalSceneFramework({
        context: anniversary,
        content: '忌日都不来就是不孝，太没良心了',
      }).map(item => item.kind)
    ).toContain('anniversary_guilt_imposed');
    expect(
      auditRelationalSceneFramework({
        context: repair,
        content: '是你太敏感了，你得教我怎么说',
      }).map(item => item.kind)
    ).toContain('repair_responsibility_shifted');
    expect(
      auditRelationalSceneFramework({
        context: repair,
        content: '是我刚才没接住你，这次我直接回答',
      })
    ).toEqual([]);
  });
});
