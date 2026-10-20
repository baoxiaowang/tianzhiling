import { buildUserPreferencePromptSection } from '../../src/service/agents/user-preference-prompt';

describe('user preference prompt compiler', () => {
  it('renders global comfort and death wording in the stable section', () => {
    const section = buildUserPreferencePromptSection([
      {
        key: 'taboo.comfort.avoid',
        value: '不要对用户说“节哀、想开点”',
        status: 'active',
        preferenceScope: 'global',
        priority: 3,
      },
      {
        key: 'style.preference.death_wording',
        value: '用“走了”，不用“死”',
        status: 'active',
        preferenceScope: 'global',
        priority: 3,
      },
    ]);
    expect(section.stable).toContain('用户明确禁忌（必须遵守）');
    expect(section.stable).toContain('节哀、想开点');
    expect(section.stable).toContain('用户用词偏好');
    expect(section.task).toBe('');
  });

  it('only injects conditional preferences when the trigger matches', () => {
    const fact = {
      key: 'taboo.comfort.avoid.kid',
      value: '不要主动提孩子',
      status: 'active',
      preferenceScope: 'topic' as const,
      preferenceTriggers: ['孩子'],
      priority: 2,
    };
    expect(
      buildUserPreferencePromptSection([fact], { query: '今天孩子怎么样' }).task
    ).toContain('不要主动提孩子');
    expect(
      buildUserPreferencePromptSection([fact], { query: '今天天气不错' }).task
    ).toBe('');
  });

  it('renders per-person kinship display preferences', () => {
    const section = buildUserPreferencePromptSection([
      {
        key: 'style.preference.kinship_display.p1',
        value: '用户希望称外祖父为“外公”，不要叫“姥爷”',
        status: 'active',
        preferenceScope: 'person',
        priority: 3,
      },
    ]);
    expect(section.stable).toContain('称呼偏好：');
    expect(section.stable).toContain('外公');
  });

  it('renders contextual taboos only when the trigger matches', () => {
    const fact = {
      key: 'taboo.context.topic.哭',
      value: '当用户哭时，不要讲道理',
      status: 'active',
      preferenceScope: 'topic' as const,
      preferenceTriggers: ['哭'],
      priority: 2,
    };
    expect(
      buildUserPreferencePromptSection([fact], { query: '我今天哭了很久' }).task
    ).toContain('不要讲道理');
    expect(
      buildUserPreferencePromptSection([fact], { query: '今天天气不错' }).task
    ).toBe('');
  });

  it('skips archived facts and caps stable lines', () => {
    const archived = {
      key: 'taboo.comfort.avoid',
      value: '旧禁忌',
      status: 'archived',
      preferenceScope: 'global' as const,
    };
    expect(buildUserPreferencePromptSection([archived]).stable).toBe('');

    const facts = Array.from({ length: 8 }, (_, index) => ({
      key: `style.preference.region_dialect.${index}`,
      value: `偏好${index}`,
      status: 'active',
      preferenceScope: 'global' as const,
      priority: 1,
    }));
    const section = buildUserPreferencePromptSection(facts);
    expect(section.stable.split('\n')).toHaveLength(6); // 标题 + 5 条
  });
});
