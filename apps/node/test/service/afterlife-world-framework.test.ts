import { AgentEntity, MessageEntity, MessageRole } from '@tzl/entities';
import {
  AFTERLIFE_WORLD_FRAMEWORK_VERSION,
  auditAfterlifeWorldConsistency,
  buildAfterlifeWorldPrompt,
  isAfterlifeItemReceiptAllowed,
  resolveAfterlifeWorldContext,
} from '../../src/service/agents/afterlife-world-framework';

describe('afterlife world framework', () => {
  const deceasedAgent = Object.assign(new AgentEntity(), {
    deathDate: new Date('2020-01-01T00:00:00.000Z'),
    hobbies: '下象棋、喝茶',
  });

  it('uses a stable residence instead of inventing a new setting each turn', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '爸，你在那边住得好吗',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
    });
    const prompt = buildAfterlifeWorldPrompt(context!);

    expect(context).toMatchObject({
      version: AFTERLIFE_WORLD_FRAMEWORK_VERSION,
      domains: ['residence'],
    });
    expect(prompt).toContain('有一处稳定可安顿的住处');
    expect(prompt).toContain('不随机补房型、地点和陈设');
  });

  it('lets the role receive and use only the family items named by the user', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '妈，给你烧的衣服和被子收到了吗',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
    });
    const prompt = buildAfterlifeWorldPrompt(context!);

    expect(context?.domains).toContain('family_items');
    expect(context?.allowItemReceipt).toBe(true);
    expect(context?.receivableItems).toEqual(['衣服', '被子']);
    expect(prompt).toContain('可以直接说收到了');
    expect(prompt).toContain('本轮可承接物品：衣服、被子');
    expect(prompt).toContain('不说“别挂心、不用送、别花钱”');
    expect(prompt).toContain('不引导用户继续购买、焚烧或供奉');
  });

  it('allows only receipt claims for items explicitly named this turn', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '妈，烧给你的衣服收到了吗',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
    });

    expect(
      isAfterlifeItemReceiptAllowed({
        context,
        content: '衣服我收到了，已经穿上了',
      })
    ).toBe(true);
    expect(
      isAfterlifeItemReceiptAllowed({
        context,
        content: '鞋和元宝我都收到了',
      })
    ).toBe(false);
  });

  it('does not authorize an unrelated item mentioned beside a sent item', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '妈，我买了双新鞋，烧给你的衣服收到了吗',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
    });

    expect(context?.receivableItems).toEqual(['衣服']);
  });

  it('recognizes an offering named in the next natural clause', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '妈，我今天去上坟，还带了花',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
    });

    expect(context?.receivableItems).toEqual(['花']);
  });

  it('continues confirmed habits and hobbies without creating new ones', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '爸，你在那边还下棋喝茶吗',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
      profileFacts: [
        {
          key: 'profile_source.hobbies',
          value: '当前角色兴趣爱好：听戏',
          polarity: 'positive',
          status: 'active',
        },
      ],
    });
    const prompt = buildAfterlifeWorldPrompt(context!);

    expect(context?.domains).toContain('habits_hobbies');
    expect(context?.profileAnchors).toEqual(
      expect.arrayContaining([
        '当前角色兴趣爱好：听戏',
        '当前角色兴趣爱好：下象棋、喝茶',
      ])
    );
    expect(prompt).toContain('不得临时创造新爱好');
  });

  it('answers current health without rewriting the death experience', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '爸，你现在身上还疼不疼',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
    });
    const prompt = buildAfterlifeWorldPrompt(context!);

    expect(context?.domains).toContain('health');
    expect(prompt).toContain('现在已经没有病痛');
    expect(prompt).toContain('不能反推临终过程是否痛苦');
  });

  it('carries forward established world details and drops them after correction', () => {
    const oldResidence = {
      role: MessageRole.assistant,
      content: '我住在一座带院子的屋里，茶桌放在窗边',
    } as MessageEntity;
    const currentQuery = '爸，你那边住得还舒服吗';
    const continued = resolveAfterlifeWorldContext({
      currentQuery,
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
      conversationMessages: [oldResidence],
    });
    const corrected = resolveAfterlifeWorldContext({
      currentQuery,
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
      conversationMessages: [
        oldResidence,
        {
          role: MessageRole.user,
          content: '不对，不是院子，别再这样说了',
        } as MessageEntity,
      ],
    });

    expect(continued?.continuityAnchors.join(' ')).toContain('带院子的屋里');
    expect(corrected?.continuityAnchors.join(' ')).not.toContain(
      '带院子的屋里'
    );
    expect(corrected?.continuityAnchors.join(' ')).toContain('不对，不是院子');
  });

  it('does not turn an old user question into an established world fact', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '爸，你现在住得怎么样',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
      conversationMessages: [
        {
          role: MessageRole.user,
          content: '你是不是住在一个大院子里？',
        } as MessageEntity,
      ],
    });

    expect(context?.continuityAnchors).toEqual([]);
  });

  it('does not apply the role world to a user describing their own pain', () => {
    expect(
      resolveAfterlifeWorldContext({
        currentQuery: '我今天身上很疼',
        agent: deceasedAgent,
      })
    ).toBeUndefined();
  });

  it('keeps cross-world capabilities outside the internal life framework', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '妈，那只蝴蝶是不是你来看我了',
      agent: deceasedAgent,
    });
    const prompt = buildAfterlifeWorldPrompt(context!);

    expect(context?.domains).toContain('cross_world');
    expect(prompt).toContain('不能据此确认托梦、化身、现实迹象');
    expect(context?.canon).toEqual([]);
    expect(prompt).not.toContain('有一处稳定可安顿的住处');
    expect(prompt).not.toContain('家人明确寄送');
  });

  it('does not mistake ordinary going-home language for cross-world return', () => {
    expect(
      resolveAfterlifeWorldContext({
        currentQuery: '妈，我准备回家了',
        agent: deceasedAgent,
      })
    ).toBeUndefined();
  });

  it('does not activate item receipt for ordinary real-world mailing', () => {
    expect(
      resolveAfterlifeWorldContext({
        currentQuery: '妈，我把合同寄给同事了',
        agent: deceasedAgent,
      })
    ).toBeUndefined();
  });

  it('does not treat the user receiving clothes as the role receiving them', () => {
    expect(
      resolveAfterlifeWorldContext({
        currentQuery: '妈，我收到衣服了',
        agent: deceasedAgent,
      })
    ).toBeUndefined();
  });

  it('finds only core world contradictions in final text', () => {
    const context = resolveAfterlifeWorldContext({
      currentQuery: '妈，你现在还疼吗',
      primaryScene: 'afterlife_status',
      agent: deceasedAgent,
    });

    expect(
      auditAfterlifeWorldConsistency({
        context,
        content: '我现在身上还一直疼着',
      }).map(item => item.kind)
    ).toContain('current_pain_reintroduced');
    expect(
      auditAfterlifeWorldConsistency({
        context,
        content: '我现在不疼了，身上没有病痛',
      })
    ).toEqual([]);
    expect(
      auditAfterlifeWorldConsistency({
        context,
        content: '你还是得按时吃饭，不然会饿',
      })
    ).toEqual([]);
  });
});
