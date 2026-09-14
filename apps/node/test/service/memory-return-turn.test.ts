import { AgentContextService } from '../../src/service/agents/agent.context';
import { MongoObjectId } from '@tzl/entities';
import {
  buildElapsedFeelingInstruction,
  buildReturnTurnMaterialPrompt,
  listRaisedOpenItems,
  matchRaisedOpenItem,
  scoreOpenItemMention,
  resolveReturnTurnHistoryLimit,
  resolveReturnTurnPlan,
  selectReturnTurnItems,
} from '../../src/service/memory/memory-return-turn';
import type { MemoryOpenItemView } from '../../src/service/memory/memory-module.types';

const NOW = new Date('2026-09-20T12:00:00.000Z');

function item(overrides: Partial<MemoryOpenItemView> = {}): MemoryOpenItemView {
  return {
    id: 'i1',
    summary: '我挂了明早的号',
    state: 'awaiting_result',
    stateHistory: [],
    importance: 3,
    raisedCount: 0,
    sourceMessageIds: ['m1'],
    updatedAt: '2026-09-13T10:00:00.000Z',
    ...overrides,
  } as MemoryOpenItemView;
}

describe('回归轮的尾巴长度', () => {
  it('清单不再看间隔：不足 6 小时也能拿到，只是不裁尾巴', () => {
    const plan = resolveReturnTurnPlan({ elapsedHours: 3 });
    expect(plan).toEqual({ tier: 'none', historyLimit: 0, includeItems: true });
    expect(resolveReturnTurnHistoryLimit({ plan, modeLimit: 16 })).toBe(16);
  });

  it('6–36 小时不裁尾巴，但开始给清单', () => {
    const plan = resolveReturnTurnPlan({ elapsedHours: 20 });
    expect(plan.tier).toBe('brief');
    expect(plan.historyLimit).toBe(0);
    expect(plan.includeItems).toBe(true);
  });

  it('隔得越久尾巴越短', () => {
    expect(resolveReturnTurnPlan({ elapsedHours: 72 }).historyLimit).toBe(6);
    expect(resolveReturnTurnPlan({ elapsedHours: 24 * 20 }).historyLimit).toBe(
      3
    );
    expect(resolveReturnTurnPlan({ elapsedHours: 24 * 60 }).historyLimit).toBe(
      2
    );
    expect(
      resolveReturnTurnHistoryLimit({
        plan: resolveReturnTurnPlan({ elapsedHours: 24 * 60 }),
        modeLimit: 8,
      })
    ).toBe(2);
  });
});

describe('回归轮清单的排除', () => {
  it('原话已经在这轮历史里的，不给', () => {
    const selection = selectReturnTurnItems({
      items: [item({ sourceMessageIds: ['m1', 'm2'] })],
      historyMessageIds: ['m2'],
      historyTexts: [],
      now: NOW,
    });
    expect(selection.items).toHaveLength(0);
    expect(selection.exclusion.inHistory).toHaveLength(1);
  });

  it('同一件事的另一种说法已经在历史里出现，也不给', () => {
    const selection = selectReturnTurnItems({
      items: [item({ summary: '我挂了明早的号' })],
      historyMessageIds: [],
      historyTexts: ['亲人: 你那个号挂上了吗', '用户: 我挂了明早的号'],
      now: NOW,
    });
    expect(selection.items).toHaveLength(0);
    expect(selection.exclusion.mentionedInHistory).toHaveLength(1);
  });

  it('最近刚问过的先不给，过了冷却再给', () => {
    const raisedRecently = selectReturnTurnItems({
      items: [
        item({
          id: 'a',
          raisedCount: 1,
          lastRaisedAt: '2026-09-19T12:00:00.000Z',
        }),
      ],
      historyMessageIds: [],
      historyTexts: [],
      now: NOW,
    });
    expect(raisedRecently.items).toHaveLength(0);
    expect(raisedRecently.exclusion.recentlyRaised).toHaveLength(1);

    const cooledDown = selectReturnTurnItems({
      items: [
        item({
          id: 'b',
          raisedCount: 1,
          lastRaisedAt: '2026-09-14T12:00:00.000Z',
        }),
      ],
      historyMessageIds: [],
      historyTexts: [],
      now: NOW,
    });
    expect(cooledDown.items).toHaveLength(1);
  });

  it('最多给 5 条，且更新时间近的在前', () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      item({
        id: `i${index}`,
        summary: `第${index}件没完的事`,
        updatedAt: `2026-09-${String(10 + index).padStart(
          2,
          '0'
        )}T10:00:00.000Z`,
      })
    );
    const selection = selectReturnTurnItems({
      items,
      historyMessageIds: [],
      historyTexts: [],
      now: NOW,
    });
    expect(selection.items).toHaveLength(5);
    expect(selection.items[0].id).toBe('i6');
  });
});

describe('回归轮材料的渲染', () => {
  it('只给事实，并说明不提也是常态', () => {
    const plan = resolveReturnTurnPlan({ elapsedHours: 72 });
    const prompt = buildReturnTurnMaterialPrompt({
      plan,
      items: [item({ topicKey: '就医', importance: 3 })],
      calendarItems: [item({ id: 'c1', summary: '再过两天该给您烧六七了' })],
      now: NOW,
    });
    expect(prompt).toContain('# 你记得的事');
    expect(prompt).toContain('用户7 天前说过："我挂了明早的号"');
    expect(prompt).toContain('还没提过');
    // 不再出现会被原样搬进回复的程序状态词
    expect(prompt).not.toContain('还没结果');
    expect(prompt).not.toContain('已经答应要做');
    expect(prompt).toContain('不要用"结果""进展""跟进"这类词');
    expect(prompt).toContain('从下面挑一件自然用上');
    expect(prompt).toContain('只有一种情况可以不用');
    expect(prompt).toContain('# 你记得的日子');
    expect(prompt).toContain('烧六七');
    expect(prompt).not.toMatch(/建议|应该问|必须/);
  });

  it('普通轮只要有未了结的事也给材料（不再看间隔）', () => {
    const prompt = buildReturnTurnMaterialPrompt({
      plan: resolveReturnTurnPlan({ elapsedHours: 2 }),
      items: [item()],
      calendarItems: [],
      now: NOW,
    });
    expect(prompt).toContain('# 你记得的事');
    expect(prompt).toContain('我挂了明早的号');
  });

  it('问过的会标出来', () => {
    const prompt = buildReturnTurnMaterialPrompt({
      plan: resolveReturnTurnPlan({ elapsedHours: 72 }),
      items: [
        item({
          raisedCount: 1,
          lastRaisedAt: '2026-09-16T12:00:00.000Z',
        }),
      ],
      calendarItems: [],
      now: NOW,
    });
    expect(prompt).toContain('上次问过，');
  });
});

describe('回归轮材料接进上下文', () => {
  const userId = new MongoObjectId('665000000000000000000801');
  const conversationId = new MongoObjectId('665000000000000000000802');
  const agentId = new MongoObjectId('665000000000000000000803');

  function buildService(options: {
    mode: 'off' | 'active';
    items: MemoryOpenItemView[];
    calendar?: MemoryOpenItemView[];
  }) {
    const service = new AgentContextService();
    const listOpenItems = jest.fn(
      async (request: { includeCalendar?: boolean }) => ({
        items: request.includeCalendar ? options.calendar || [] : options.items,
        status: 'ok',
        diagnostics: { engine: 'event_v1', total: options.items.length },
      })
    );
    (service as never as { memoryModuleService: unknown }).memoryModuleService =
      {
        describeSelection: () => ({ mode: options.mode, primary: 'event_v1' }),
        listOpenItems,
      };
    service.logger = { warn: jest.fn() } as never;
    return { service, listOpenItems };
  }

  const contextOptions = {
    conversation: { id: conversationId, userId, agentId },
  } as never;

  it('模块关闭时一个字都不给', async () => {
    const { service } = buildService({ mode: 'off', items: [item()] });
    const result = await (
      service as never as {
        buildReturnTurnMaterial: (
          options: unknown
        ) => Promise<{ prompt: string; hasItems: boolean }>;
      }
    ).buildReturnTurnMaterial({
      options: contextOptions,
      plan: resolveReturnTurnPlan({ elapsedHours: 72 }),
      recentHistoryMessages: [],
    });
    expect(result.prompt).toBe('');
    expect(result.hasItems).toBe(false);
  });

  it('尾巴里已经有的不给，剩下的渲染成材料', async () => {
    const { service } = buildService({
      mode: 'active',
      items: [
        item({
          id: 'seen',
          summary: '我挂了明早的号',
          sourceMessageIds: ['m9'],
        }),
        item({ id: 'fresh', summary: '明天儿子又要复查了' }),
      ],
      calendar: [
        item({
          id: 'cal',
          topicKey: '纪念日',
          summary: '再过两天该给您烧六七了',
        }),
      ],
    });
    const result = await (
      service as never as {
        buildReturnTurnMaterial: (
          options: unknown
        ) => Promise<{ prompt: string; hasItems: boolean }>;
      }
    ).buildReturnTurnMaterial({
      options: contextOptions,
      plan: resolveReturnTurnPlan({ elapsedHours: 72 }),
      recentHistoryMessages: [
        {
          id: new MongoObjectId('665000000000000000000809'),
          content: '我挂了明早的号',
        },
      ],
    });
    expect(result.hasItems).toBe(true);
    expect(result.prompt).toContain('明天儿子又要复查了');
    expect(result.prompt).not.toContain('我挂了明早的号');
    expect(result.prompt).toContain('烧六七');
  });
});

describe('回复里提到了哪一条（提问记账）', () => {
  it('复述了原话的明显片段就认', () => {
    expect(
      scoreOpenItemMention('你那个号挂上了吗？明早别迟到', '我挂了明早的号')
    ).toBeGreaterThanOrEqual(0.5);
    expect(
      scoreOpenItemMention('儿子明天复查别忘了带单子', '明天儿子又要复查了')
    ).toBeGreaterThanOrEqual(0.5);
  });

  it('只是客气一句，不认', () => {
    expect(scoreOpenItemMention('你别太累了，早点休息', '我挂了明早的号')).toBe(
      0
    );
    expect(
      scoreOpenItemMention('好的，我在呢，你说', '明天儿子又要复查了')
    ).toBe(0);
  });

  it('一轮最多认一条，认分数最高的', () => {
    const matched = matchRaisedOpenItem({
      replyText: '儿子明天复查的事别忘了，单子带好',
      items: [
        item({
          id: 'other',
          summary: '我下周要去三门峡，咪咪托运的事还要联系',
        }),
        item({ id: 'target', summary: '明天儿子又要复查了' }),
      ],
    });
    expect(matched?.item.id).toBe('target');
    expect(matched?.score).toBeGreaterThanOrEqual(0.5);
  });

  it('同一件事被拆成两条时，两条都记"问过"（不能只记最像的一条）', () => {
    const matched = listRaisedOpenItems({
      replyText: '手术还顺利吗？',
      items: [
        item({ id: 'a', summary: '爸爸，我刚做完手术，在家躺着' }),
        item({ id: 'b', summary: '我刚做完手术，在家躺着' }),
        item({ id: 'c', summary: '我下周要去医院复查' }),
      ],
    });
    expect(matched.map(entry => entry.item.id).sort()).toEqual(['a', 'b']);
  });

  it('顺带记账有更高门槛：只共有一个词不算（否则一堆条目一起进冷却）', () => {
    const matched = listRaisedOpenItems({
      replyText: '明天记得去复查，别耽误了',
      items: [
        item({ id: 'a', summary: '明天儿子要去复查' }),
        item({ id: 'b', summary: '我下周也要复查' }),
        item({ id: 'c', summary: '复查单子记得带' }),
      ],
    });
    expect(matched.map(entry => entry.item.id)).toEqual(['a']);
  });

  it('都不像就不记（宁可少记，也不要把无关的话记成问过）', () => {
    const matched = matchRaisedOpenItem({
      replyText: '今天天气不错，出去走走散散心吧',
      items: [item({ id: 'target', summary: '明天儿子又要复查了' })],
    });
    expect(matched).toBeUndefined();
  });
});

describe('时间跨度的感受提示', () => {
  it('不到 36 小时不给（同一段对话不用提时间）', () => {
    expect(buildElapsedFeelingInstruction({ elapsedHours: 5 })).toBe('');
  });

  it('只给最小提示：不说也可以、不给例句、不给档位词', () => {
    const prompt = buildElapsedFeelingInstruction({ elapsedHours: 72 });
    expect(prompt).toContain('也可以不带');
    expect(prompt).toContain('不要用固定句式或口头禅');
    expect(prompt).toContain('不要把时间跨度直接搬进开场');
    expect(prompt).toContain('不要带追问或抱怨的语气');
    expect(prompt).toContain('不许说"我一直看着你、守着你、等着你"');
    // 不给任何现成措辞，也不给"几天/几个月"这类会被照抄的档位词
    expect(prompt).not.toContain('没动静');
    expect(prompt).not.toContain('好久不见');
    expect(prompt).not.toContain('隔了一两天到几天');
    expect(prompt).not.toContain('隔了一个多月');
    // 间隔长也还是同一份提示：分寸交给模型，不按档位写死
    expect(buildElapsedFeelingInstruction({ elapsedHours: 24 * 60 })).toBe(
      prompt
    );
  });
});
