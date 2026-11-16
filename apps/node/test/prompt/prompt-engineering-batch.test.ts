import {
  buildDepartedSystemPrompt,
  HONESTY_VIRTUE_PRINCIPLE,
} from '../../src/prompt/departed';
import {
  buildAgentPersonaPrompt,
  PRODUCT_DERIVED_DIALECT_GUARD,
} from '../../src/service/agents/agent-persona';
import { buildPromptSizeRecord } from '../../src/service/agents/prompt-size-audit';
import {
  DEFAULT_CONDITIONAL_PROMPT_MAX_CHARS,
  MAX_CONDITIONAL_PROMPT_MAX_CHARS,
  MIN_CONDITIONAL_PROMPT_MAX_CHARS,
  resolveConditionalPromptMaxChars,
} from '../../src/config/prompt-engineering';
import { buildRegionDialectHint, deriveLanguageSettings } from '@tzl/shared';
import { compileConditionalPrompts } from '../../src/service/agents/conditional-prompt';

describe('诚实美德句开关（D1 A/B）', () => {
  it('关闭：九条原则，无美德句（现行行为不变）', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: 'u',
      agentId: 'a',
      honestyVirtue: false,
    });
    expect(prompt).not.toContain(HONESTY_VIRTUE_PRINCIPLE);
    expect(prompt).toContain('9. ');
    expect(prompt).not.toContain('10. ');
  });

  it('显式开启：追加为第 10 条原则', () => {
    const prompt = buildDepartedSystemPrompt({
      userId: 'u',
      agentId: 'a',
      honestyVirtue: true,
    });
    expect(prompt).toContain(`10. ${HONESTY_VIRTUE_PRINCIPLE}`);
    expect(prompt).toContain('9. ');
  });
});

describe('条件预算配置钳制（P2-4 修正）', () => {
  it('越界值钳制到边界并标记 adjusted', () => {
    expect(resolveConditionalPromptMaxChars(250)).toEqual({
      value: MIN_CONDITIONAL_PROMPT_MAX_CHARS,
      adjusted: true,
    });
    expect(resolveConditionalPromptMaxChars(5000)).toEqual({
      value: MAX_CONDITIONAL_PROMPT_MAX_CHARS,
      adjusted: true,
    });
  });

  it('合法值与缺省值不标记 adjusted', () => {
    expect(resolveConditionalPromptMaxChars(1000)).toEqual({
      value: 1000,
      adjusted: false,
    });
    expect(resolveConditionalPromptMaxChars(undefined)).toEqual({
      value: DEFAULT_CONDITIONAL_PROMPT_MAX_CHARS,
      adjusted: false,
    });
    expect(resolveConditionalPromptMaxChars('800')).toEqual({
      value: 800,
      adjusted: false,
    });
  });
});

describe('条件段预算行为（P2-1/P2-4/P3-2 补测）', () => {
  const block = (id: string, chars: number) => ({
    id,
    priority: 45,
    text: `${id}:` + 'x'.repeat(Math.max(0, chars - id.length - 1)),
  });

  it('旧预算 400 下 522 字的 local_candidate 结构性无法注入（复现生产饿死）', () => {
    const result = compileConditionalPrompts(
      [block('local_memory_candidate', 522)],
      { maxBlocks: 3, maxChars: 400 }
    );
    expect(result.fired).toEqual([]);
    expect(result.dropped).toContain('local_memory_candidate');
  });

  it('预算 1000 下 candidate(522)+initiative(377) 可共存', () => {
    const result = compileConditionalPrompts(
      [block('local_memory_candidate', 522), block('initiative', 377)],
      { maxBlocks: 3, maxChars: 1000 }
    );
    expect(result.fired).toEqual(
      expect.arrayContaining(['local_memory_candidate', 'initiative'])
    );
  });

  it('极小值（0/负数）不会意外全灭而是钳制行为由调用方负责', () => {
    const result = compileConditionalPrompts([block('a', 100)], {
      maxBlocks: 3,
      maxChars: 0,
    });
    expect(result.fired).toEqual([]);
    expect(result.dropped).toContain('a');
  });

  it('预算恰好 1000 时放行，1001 时裁掉后一块（边界语义含分隔符）', () => {
    const exact = compileConditionalPrompts(
      [block('a', 500), block('b', 499)],
      { maxBlocks: 3, maxChars: 1000 }
    );
    expect(exact.fired).toEqual(['a', 'b']);

    const over = compileConditionalPrompts(
      [block('a', 500), block('b', 500)],
      { maxBlocks: 3, maxChars: 1000 }
    );
    expect(over.fired).toEqual(['a']);
    expect(over.dropped).toContain('b');
  });
});

describe('普通话标签特判（P3-1）', () => {
  it('label=普通话 原样返回，不生成"带普通话口音倾向的普通话"病句', async () => {
    const { deriveLanguageSettings } = await import('@tzl/shared');
    const result = deriveLanguageSettings({
      hometown: {
        province: '北京',
        languageLabel: '普通话',
        source: { kind: 'user_explicit' },
      },
    });
    expect(result.active?.value).toBe('普通话');
  });
});

describe('region→口音倾向映射（S5）', () => {
  it('命中分区：一行式，含"语气像，不演方言戏"分寸句', () => {
    const hint = buildRegionDialectHint({ provinceName: '山东省' });
    expect(hint).toContain('用户地区表达偏好：山东省一带口音倾向');
    expect(hint).toContain('语气像，不演方言戏');
    expect(hint).toContain('除非用户自己使用方言词');
  });

  it('各分区命中且措辞不同', () => {
    const shandong = buildRegionDialectHint({ provinceName: '山东省' });
    const sichuan = buildRegionDialectHint({ provinceName: '四川省' });
    const guangdong = buildRegionDialectHint({ provinceName: '广东省' });
    expect(shandong).toBeTruthy();
    expect(sichuan).toBeTruthy();
    expect(guangdong).toBeTruthy();
    expect(new Set([shandong, sichuan, guangdong]).size).toBe(3);
  });

  it('无省份或未命中返回空串（调用方整段省略）', () => {
    expect(buildRegionDialectHint({})).toBe('');
    expect(buildRegionDialectHint({ provinceName: '' })).toBe('');
  });

});

describe('语言分寸随设定渲染（事实/指令分离，P1-1 修正）', () => {
  const derivedSetting = () =>
    deriveLanguageSettings({
      hometown: {
        province: '山东',
        languageLabel: '山东话',
        source: { kind: 'user_explicit' },
      },
    }).active!;
  const explicitSetting = () =>
    deriveLanguageSettings({
      explicit: { value: '说山东话', source: { kind: 'user_explicit' } },
    }).active!;

  it('产品派生设定：分寸句恰好出现一次，事实值本身不含分寸句', () => {
    const setting = derivedSetting();
    expect(setting.value).toBe('带山东话口音倾向的普通话');
    const { prompt } = buildAgentPersonaPrompt({
      agent: null,
      coreLanguageSettings: [setting],
    });
    expect(prompt.split(PRODUCT_DERIVED_DIALECT_GUARD).length - 1).toBe(1);
  });

  it('用户明说方言：不追加分寸句（尊重明说口径）', () => {
    const { prompt } = buildAgentPersonaPrompt({
      agent: null,
      coreLanguageSettings: [explicitSetting()],
    });
    expect(prompt).toContain('说山东话');
    expect(prompt).not.toContain(PRODUCT_DERIVED_DIALECT_GUARD);
  });

  it('无语言设定：不出现分寸句（无设定用户零成本）', () => {
    const { prompt } = buildAgentPersonaPrompt({ agent: null });
    expect(prompt).not.toContain(PRODUCT_DERIVED_DIALECT_GUARD);
    expect(prompt).not.toContain('口音倾向');
  });
});

describe('审计行带本轮条件预算（P4 生效可见）', () => {
  it('conditionalMaxChars 写入记录，缺省不写字段', () => {
    const withBudget = buildPromptSizeRecord({
      stableChars: 10,
      taskChars: 20,
      totalChars: 30,
      conditionalMaxChars: 1000,
    });
    expect(withBudget.conditionalMaxChars).toBe(1000);

    const without = buildPromptSizeRecord({
      stableChars: 10,
      taskChars: 20,
      totalChars: 30,
    });
    expect(without).not.toHaveProperty('conditionalMaxChars');
  });
});
