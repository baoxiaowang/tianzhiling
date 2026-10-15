import {
  normalizeCallNameInText,
  primaryCallName,
} from '../../src/common/call-name';

describe('primaryCallName', () => {
  it.each([
    ['老婆，姓傅的', '老婆'],
    ['大宝、老闺宁', '大宝'],
    ['儿子/妹妹', '儿子'],
    ['孔宪红／老婆', '孔宪红'],
    ['儿,或者晓雨', '儿'],
    [' 妈妈 , 娘 ', '妈妈'],
    ['老婆', '老婆'],
    ['', ''],
    [undefined, ''],
    [null, ''],
  ])('turns %p into %p', (input, expected) => {
    expect(primaryCallName(input as string | undefined | null)).toBe(expected);
  });

  it('falls back to the raw text when every segment is empty', () => {
    expect(primaryCallName('，，')).toBe('，，');
  });

  it('does not split inside a single call name', () => {
    expect(primaryCallName('小傅')).toBe('小傅');
  });
});

describe('normalizeCallNameInText', () => {
  it('replaces the multi-value call name inside derived text', () => {
    expect(
      normalizeCallNameInText(
        '老公，男性，你称呼他为老公，他会称呼你为老婆，姓傅的。',
        '老婆，姓傅的'
      )
    ).toBe('老公，男性，你称呼他为老公，他会称呼你为老婆。');
  });

  it('keeps the text untouched when there is no multi-value call name', () => {
    const text = '老公，男性，你称呼他为老公，他会称呼你为老婆。';

    expect(normalizeCallNameInText(text, '老婆')).toBe(text);
    expect(normalizeCallNameInText(text, '')).toBe(text);
    expect(normalizeCallNameInText(undefined, '老婆，姓傅的')).toBe('');
  });
});
