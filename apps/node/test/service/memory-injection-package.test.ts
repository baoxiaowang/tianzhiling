import {
  renderMemoryPackageNarrative,
  selectInjectableMemoryPackages,
  trimPackageMembersToCapacity,
} from '../../src/service/agents/memory-injection-package';
import {
  buildChainViews,
  heatForGroup,
} from '../../src/service/memory/memory-grouping';

function member(
  overrides: Partial<{
    id: string;
    content: string;
    createdAt: string;
    score: number;
    groupId: string;
  }> = {}
) {
  return {
    id: overrides.id ?? `m${Math.random().toString(36).slice(2, 8)}`,
    content: overrides.content ?? '用户提到的一件事',
    createdAt: overrides.createdAt ?? '2026-11-01T10:00:00+08:00',
    score: overrides.score ?? 0.5,
    groupId: overrides.groupId,
  };
}

const T = (day: number, hour = 10) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+08:00`;

describe('memory package injection', () => {
  it('选中即整包：不因单条分数切散', () => {
    const items = [
      member({ id: 'a1', groupId: 'g1', score: 0.9, createdAt: T(1) }),
      member({ id: 'a2', groupId: 'g1', score: 0.3, createdAt: T(2) }),
      member({ id: 'a3', groupId: 'g1', score: 0.2, createdAt: T(3) }),
      member({ id: 'b1', groupId: 'g2', score: 0.89, createdAt: T(4) }),
    ];
    const result = selectInjectableMemoryPackages(items);
    const g1Ids = result.items.filter(i => i.groupId === 'g1').map(i => i.id);
    expect(g1Ids).toEqual(['a1', 'a2', 'a3']); // 整包注入
    expect(result.items.filter(i => i.groupId === 'g2')).toHaveLength(0); // 包间 gap 0.01 < 0.02 只留 1 包
    expect(result.oversizedCount).toBe(0);
  });

  it('包间 score-gap 有区分度时注入两包', () => {
    const items = [
      member({ groupId: 'g1', score: 0.9 }),
      member({ groupId: 'g2', score: 0.7 }),
    ];
    const result = selectInjectableMemoryPackages(items);
    expect(result.packages).toHaveLength(2);
  });

  it('单包成员数硬顶：截断时最高分成员必留、标记 truncated', () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      member({ id: `m${i}`, groupId: 'g1', score: i === 5 ? 0.95 : 0.2, createdAt: T(i + 1) })
    );
    const result = selectInjectableMemoryPackages(items, {
      maxMembersPerPackage: 4,
    });
    const ids = result.items.map(i => i.id);
    expect(ids).toContain('m5'); // 最高分必留
    expect(result.items).toHaveLength(4);
    expect(result.packages[0]).toMatchObject({
      originalMembers: 9,
      injectedMembers: 4,
      truncated: true,
    });
    expect(result.oversizedCount).toBe(1);
  });

  it('单包字符硬顶：超字符丢弃最旧非必留成员', () => {
    const items = [
      member({ id: 'old', groupId: 'g1', content: 'x'.repeat(200), createdAt: T(1), score: 0.2 }),
      member({ id: 'anchor', groupId: 'g1', content: 'y'.repeat(200), createdAt: T(5), score: 0.95 }),
      member({ id: 'new', groupId: 'g1', content: 'z'.repeat(200), createdAt: T(9), score: 0.3 }),
    ];
    const result = selectInjectableMemoryPackages(items, {
      maxCharsPerPackage: 450,
    });
    const ids = result.items.map(i => i.id);
    expect(ids).toContain('anchor');
    expect(ids).toContain('new'); // 时间近优先填充
    expect(ids).not.toContain('old'); // 最旧被字符顶挤掉
    expect(result.packages[0].truncated).toBe(true);
  });

  it('全局双预算封顶：不可能无限大', () => {
    const items = [
      ...Array.from({ length: 6 }, (_, i) =>
        member({ id: `a${i}`, groupId: 'g1', score: 0.9, createdAt: T(i + 1) })
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        member({ id: `b${i}`, groupId: 'g2', score: 0.8, createdAt: T(i + 1) })
      ),
    ];
    const result = selectInjectableMemoryPackages(items, {
      maxTotalMembers: 5,
      maxTotalChars: 60,
    });
    expect(result.items.length).toBeLessThanOrEqual(5);
    const totalChars = result.items.reduce((s, i) => s + i.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(60);
  });

  it('无 groupId 的证据作为单件包参与排序', () => {
    const items = [
      member({ id: 's1', score: 0.9 }),
      member({ id: 'g1a', groupId: 'g1', score: 0.5 }),
    ];
    const result = selectInjectableMemoryPackages(items);
    expect(result.items.map(i => i.id)).toEqual(['s1', 'g1a']); // gap 大，单件包与组包都注入，按分排
    expect(result.packages[0].groupId).toBe('singleton');
    expect(result.packages[0].originalMembers).toBe(1);
  });

  it('包内成员按时间正序（叙事连贯）', () => {
    const items = [
      member({ id: 'late', groupId: 'g1', createdAt: T(9), score: 0.9 }),
      member({ id: 'early', groupId: 'g1', createdAt: T(1), score: 0.2 }),
      member({ id: 'mid', groupId: 'g1', createdAt: T(5), score: 0.3 }),
    ];
    const result = selectInjectableMemoryPackages(items);
    expect(result.items.map(i => i.id)).toEqual(['early', 'mid', 'late']);
  });

  it('空输入与全空包安全返回', () => {
    expect(selectInjectableMemoryPackages([])).toEqual({
      items: [],
      packages: [],
      oversizedCount: 0,
    });
  });

  it('trimPackageMembersToCapacity：容量内原样返回（仍按时间正序）', () => {
    const members = [
      member({ id: 'b', createdAt: T(2) }),
      member({ id: 'a', createdAt: T(1) }),
    ];
    const trimmed = trimPackageMembersToCapacity(members, {
      maxMembers: 6,
      maxChars: 420,
    }, () => 1);
    expect(trimmed.kept.map(m => m.id)).toEqual(['a', 'b']);
    expect(trimmed.truncated).toBe(false);
  });

  it('recencyFactor 参与包得分排序（新包优先）', () => {
    const recent = new Date();
    const old = new Date(Date.now() - 800 * 24 * 3600 * 1000);
    const items = [
      member({ groupId: 'old', score: 0.5, createdAt: old.toISOString() }),
      member({ groupId: 'recent', score: 0.5, createdAt: recent.toISOString() }),
    ];
    const result = selectInjectableMemoryPackages(items, {
      recencyFactor: (createdAt?: string) => {
        if (!createdAt) return 1;
        const ageDays = (Date.now() - Date.parse(createdAt)) / 86400000;
        return ageDays <= 180 ? 1 : Math.max(0.7, 1 - ((ageDays - 180) / 730) * 0.3);
      },
    });
    expect(result.items[0].groupId).toBe('recent');
  });

  it('summarize 压缩：超限包产出诚实的压缩行；drop 不产出', () => {
    const dense = Array.from({ length: 9 }, (_, i) =>
      member({ id: `d${i}`, groupId: 'g1', score: 0.5, createdAt: T(i + 1) })
    );
    const summarized = selectInjectableMemoryPackages(dense, {
      maxMembersPerPackage: 4,
      compression: 'summarize',
    });
    expect(summarized.packages[0].truncated).toBe(true);
    expect(summarized.packages[0].compressionLine).toBe(
      '【本场共 9 条提及，超容量保留 4 条】'
    );
    const dropped = selectInjectableMemoryPackages(dense, {
      maxMembersPerPackage: 4,
      compression: 'drop',
    });
    expect(dropped.packages[0].truncated).toBe(true);
    expect(dropped.packages[0].compressionLine).toBeUndefined();
  });

  it('叙事块渲染：标题+前情链+压缩行+时间正序原话引用', () => {
    const block = renderMemoryPackageNarrative(
      {
        groupId: 'g1',
        title: '复查',
        subjectRef: '妈妈',
        topicKey: '就医复查',
        spanFrom: '2026-11-10T09:00:00+08:00',
        spanTo: '2026-11-10T10:30:00+08:00',
        chain: [
          {
            title: '住院那段',
            spanFrom: '2026-06-01T09:00:00+08:00',
            spanTo: '2026-06-20T09:00:00+08:00',
            memberCount: 5,
          },
        ],
      },
      ['妈妈下周要复查', '结果还没出来'],
      '【本场共 4 条提及，超容量保留 2 条】'
    );
    expect(block).toBe(
      [
        '【妈妈的就医复查｜11-10~11-10】',
        '前情：住院那段（06-01~06-20，5 次提及）',
        '【本场共 4 条提及，超容量保留 2 条】',
        '原话（按时间先后，引用只认带引号部分）：',
        '- 「妈妈下周要复查」',
        '- 「结果还没出来」',
      ].join('\n')
    );
  });

  it('heatForGroup：新近+多成员+未了结升温，陈旧降温，值域钳制', () => {
    const now = new Date('2026-11-16T12:00:00+08:00');
    const fresh = heatForGroup({
      memberCount: 6,
      spanTo: new Date('2026-11-15T12:00:00+08:00'),
      hasActiveOpenItem: true,
      now,
    });
    const stale = heatForGroup({
      memberCount: 1,
      spanTo: new Date('2024-11-16T12:00:00+08:00'),
      now,
    });
    expect(fresh).toBeGreaterThan(stale);
    expect(fresh).toBeLessThanOrEqual(1.5);
    expect(stale).toBeGreaterThanOrEqual(0.6);
  });

  it('buildChainViews：只链更早场次、同主体优先、按时间倒序取 2', () => {
    const current = {
      subjectRef: '妈妈',
      spanFrom: new Date('2026-11-10T09:00:00+08:00'),
    };
    const mk = (id: string, day: string, subjectRef?: string, n = 3) => ({
      id,
      title: id,
      subjectRef,
      spanFrom: new Date(day),
      spanTo: new Date(day),
      memberCount: n,
    });
    const chain = buildChainViews(current, [
      mk('later', '2026-11-12'), // 比本场晚：不链
      mk('other-person', '2026-11-01', '二哥'), // 主体不同：不链
      mk('june', '2026-06-10', '妈妈', 5),
      mk('sept', '2026-09-01', '妈妈', 4),
      mk('may', '2026-05-01', undefined, 2), // 历史场无主体：视为可链
    ]);
    expect(chain.map(entry => entry.title)).toEqual(['sept', 'june']);
    expect(chain[0].memberCount).toBe(4);
  });
});
