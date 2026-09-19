import {
  deriveLanguageSettings,
  selectRoleCoreEntry,
  sourcePriority,
} from '../../src/service/agents/role-core-memory';

describe('role core memory: hometown derived language setting', () => {
  const hometownSource = {
    kind: 'user_explicit' as const,
    messageId: 'm-hometown',
    at: new Date('2026-09-19T07:00:00.000Z'),
  };

  it('derives a product-derived dialect setting from a confirmed hometown', () => {
    const result = deriveLanguageSettings({
      hometown: {
        province: '山东',
        languageLabel: '山东话',
        source: hometownSource,
      },
    });

    expect(result.active).toMatchObject({
      value: '说山东话',
      origin: 'product_derived',
      active: true,
    });
    // 派生设定必须能指回它依据的籍贯事实
    expect(result.active?.derivedFrom).toBe(hometownSource);
    expect(result.superseded).toHaveLength(0);
  });

  it('keeps the hometown fact but stops injecting the derived default once the user says plain Mandarin', () => {
    const result = deriveLanguageSettings({
      hometown: { province: '山东', languageLabel: '山东话', source: hometownSource },
      explicit: {
        value: '一直讲普通话',
        source: { kind: 'user_explicit', messageId: 'm-correction' },
      },
    });

    expect(result.active).toMatchObject({
      value: '一直讲普通话',
      origin: 'user_explicit',
      active: true,
    });
    // 旧的山东默认不再注入，但作为解释保留
    expect(result.superseded).toHaveLength(1);
    expect(result.superseded[0]).toMatchObject({
      value: '说山东话',
      active: false,
    });
    expect(result.superseded[0].reason).toContain('覆盖');
  });

  it('does not invent a dialect when the hometown is confirmed without a language label', () => {
    const result = deriveLanguageSettings({
      hometown: { province: '山东', source: hometownSource },
    });

    expect(result.active).toBeUndefined();
    expect(result.note).toContain('不猜方言');
  });

  it('does not derive anything without a traceable source', () => {
    const result = deriveLanguageSettings({
      hometown: { province: '山东', languageLabel: '山东话' },
    });

    expect(result.active).toBeUndefined();
    expect(result.superseded).toHaveLength(0);
  });

  it('accepts an already verbalized label without doubling the verb', () => {
    const result = deriveLanguageSettings({
      hometown: {
        province: '山东',
        languageLabel: '说山东话',
        source: hometownSource,
      },
    });
    expect(result.active?.value).toBe('说山东话');
  });
});

describe('role core memory: source priority', () => {
  it('ranks explicit corrections above explicit statements, and derived summaries last', () => {
    expect(sourcePriority('user_correction')).toBeGreaterThan(
      sourcePriority('user_explicit')
    );
    expect(sourcePriority('user_explicit')).toBeGreaterThan(
      sourcePriority('import_style')
    );
    expect(sourcePriority('import_style')).toBeGreaterThan(
      sourcePriority('product_derived')
    );
    expect(sourcePriority('product_derived')).toBeGreaterThan(
      sourcePriority('summary')
    );
  });

  it('picks the strongest source instead of the newest string', () => {
    const picked = selectRoleCoreEntry([
      {
        value: '老爷子',
        source: { kind: 'import_style', at: new Date('2026-09-19T09:00:00Z') },
      },
      {
        value: '湾呐',
        source: { kind: 'user_correction', at: new Date('2026-09-19T07:00:00Z') },
      },
    ]);

    expect(picked).toMatchObject({ value: '湾呐', status: 'adopted' });
  });

  it('keeps same-rank conflicts pending rather than silently overwriting', () => {
    const picked = selectRoleCoreEntry([
      { value: '湾呐', source: { kind: 'user_explicit', messageId: 'm1' } },
      { value: '阿湾', source: { kind: 'user_explicit', messageId: 'm2' } },
    ]);

    expect(picked).toMatchObject({ status: 'pending' });
    expect(picked?.reason).toContain('冲突');
  });

  it('treats same-rank equal values as one adopted value', () => {
    const picked = selectRoleCoreEntry([
      { value: '湾呐', source: { kind: 'user_explicit', messageId: 'm1' } },
      { value: '湾呐', source: { kind: 'user_explicit', messageId: 'm2' } },
    ]);

    expect(picked).toMatchObject({ value: '湾呐', status: 'adopted' });
  });
});
