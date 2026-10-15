import {
  buildCallNamePool,
  normalizeCallNameInText,
  parseCallNames,
  primaryCallName,
} from '../../src/common/call-name';

describe('parseCallNames', () => {
  it.each([
    ['老婆，姓傅的', ['老婆', '姓傅的']],
    ['大宝、老闺宁', ['大宝', '老闺宁']],
    ['儿子/妹妹', ['儿子', '妹妹']],
    ['孔宪红／老婆', ['孔宪红', '老婆']],
    ['儿,或者晓雨', ['儿', '晓雨']],
    ['乖妞，宝贝，亲爱的', ['乖妞', '宝贝', '亲爱的']],
    ['妹妹，小妖精，宝贝', ['妹妹', '小妖精', '宝贝']],
    ['昵，或者燕子 李文燕', ['昵', '燕子', '李文燕']],
    ['幺儿。文女子，文娃子', ['文娃子']],
    ['峰峰就行', ['峰峰']],
    [' 妈妈？ ', ['妈妈']],
    ['妈妈。', ['妈妈']],
    [' 妈妈 , 娘 ', ['妈妈', '娘']],
    ['宝宝，老婆，宝宝', ['宝宝', '老婆']],
    ['', []],
    [undefined, []],
    [null, []],
    ['，，', []],
    ['我好想妈妈外婆大舅啊', []],
    ['爸爸，你在那边好吗？', ['爸爸']],
  ])('parses %p into %p', (input, expected) => {
    expect(parseCallNames(input as string | undefined | null)).toEqual(
      expected
    );
  });

  it('keeps a single call name untouched', () => {
    expect(parseCallNames('小傅')).toEqual(['小傅']);
  });
});

describe('primaryCallName', () => {
  it('returns the first usable call name', () => {
    expect(primaryCallName('老婆，姓傅的')).toBe('老婆');
    expect(primaryCallName('孔宪红／老婆')).toBe('孔宪红');
    expect(primaryCallName('老婆')).toBe('老婆');
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(primaryCallName('，，')).toBe('');
    expect(primaryCallName('')).toBe('');
    expect(primaryCallName(undefined)).toBe('');
  });
});

describe('buildCallNamePool', () => {
  it('puts the dynamically taught name ahead of the configured order', () => {
    expect(buildCallNamePool('老婆，姓傅的', '宝贝')).toEqual([
      '宝贝',
      '老婆',
      '姓傅的',
    ]);
  });

  it('uses only the configured order when no dynamic name exists', () => {
    expect(buildCallNamePool('女儿，闺女', undefined)).toEqual([
      '女儿',
      '闺女',
    ]);
  });

  it('deduplicates a dynamic name that is already configured', () => {
    expect(buildCallNamePool('老婆，姓傅的', '老婆')).toEqual([
      '老婆',
      '姓傅的',
    ]);
  });
});

describe('normalizeCallNameInText', () => {
  it('replaces the whole multi-value sequence with the primary name', () => {
    expect(
      normalizeCallNameInText(
        '老公，男性，你称呼他为老公，他会称呼你为老婆，姓傅的。',
        '老婆，姓傅的'
      )
    ).toBe('老公，男性，你称呼他为老公，他会称呼你为老婆。');
  });

  it('uses the selected name of the current turn when provided', () => {
    expect(
      normalizeCallNameInText(
        '老公，男性，你称呼他为老公，他会称呼你为老婆，姓傅的。',
        '老婆，姓傅的',
        '姓傅的'
      )
    ).toBe('老公，男性，你称呼他为老公，他会称呼你为姓傅的。');
  });

  it('collapses alternatives that were written separately', () => {
    expect(
      normalizeCallNameInText(
        '他会称呼你为老婆或者姓傅的。',
        '老婆，姓傅的',
        '老婆'
      )
    ).toBe('他会称呼你为老婆。');
  });

  it('keeps the text untouched when there is no multi-value call name', () => {
    const text = '老公，男性，你称呼他为老公，他会称呼你为老婆。';

    expect(normalizeCallNameInText(text, '老婆')).toBe(text);
    expect(normalizeCallNameInText(text, '')).toBe(text);
    expect(normalizeCallNameInText(undefined, '老婆，姓傅的')).toBe('');
  });
});
