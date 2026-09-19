import {
  HOMETOWN_FACT_KEY,
  buildHometownFactValue,
  deriveLanguageSettings,
} from '@tzl/shared';
import { buildCoreLanguageSettings } from '../../src/service/agents/agent.context';
import { buildAgentPersonaPrompt } from '../../src/service/agents/agent-persona';
import { AgentSex } from '@tzl/entities';

describe('role core pathway: stated hometown -> adopted language -> final prompt', () => {
  const hometownFact = (value: string) => ({
    key: HOMETOWN_FACT_KEY,
    value,
    status: 'active',
    sourceMessageId: 'msg-hometown',
    createdAt: new Date('2026-09-19T07:00:00.000Z'),
  });

  it('projects a stated hometown into an adopted dialect setting with its source nature', () => {
    const settings = buildCoreLanguageSettings({
      profileFacts: [hometownFact(buildHometownFactValue('山东'))],
    });

    const active = settings.find(item => item.active);
    expect(active).toMatchObject({
      value: '说山东话',
      origin: 'product_derived',
    });
    // 派生设定必须指回籍贯事实的来源
    expect(active?.derivedFrom?.messageId).toBe('msg-hometown');
  });

  it('renders the adopted setting in the final persona prompt and labels it as derived', () => {
    const settings = buildCoreLanguageSettings({
      profileFacts: [hometownFact(buildHometownFactValue('山东'))],
    });
    const { prompt } = buildAgentPersonaPrompt({
      agent: { name: '爷爷', sex: AgentSex.man } as never,
      coreLanguageSettings: settings,
    });

    expect(prompt).toContain('说山东话');
    expect(prompt).toContain('由籍贯生成');
  });

  it('lets a reliable profile language habit override the region default without deleting the fact', () => {
    const settings = buildCoreLanguageSettings({
      profileFacts: [
        hometownFact(buildHometownFactValue('山东')),
        {
          key: 'profile_source.language_habits',
          value: '当前角色语言习惯：一直讲普通话',
          status: 'active',
        },
      ],
    });

    const active = settings.find(item => item.active);
    expect(active?.value).toBe('一直讲普通话');
    // 旧的山东默认保留但不再 active
    const superseded = settings.find(item => !item.active);
    expect(superseded?.value).toBe('说山东话');

    const { prompt } = buildAgentPersonaPrompt({
      agent: { name: '爷爷', sex: AgentSex.man } as never,
      coreLanguageSettings: settings,
    });
    expect(prompt).toContain('一直讲普通话');
    expect(prompt).not.toContain('说山东话');
  });

  it('does not turn a user hometown into the relative language setting', () => {
    // 用户本人的籍贯不是当前角色的事实：没有 origin.hometown 事实就不产出方言设定。
    const settings = buildCoreLanguageSettings({
      profileFacts: [
        {
          key: 'user.identity.hometown',
          value: '当前角色的籍贯是山东',
          status: 'active',
        },
      ],
    });
    expect(settings).toHaveLength(0);
  });

  it('ignores archived hometown facts', () => {
    const settings = buildCoreLanguageSettings({
      profileFacts: [
        { ...hometownFact(buildHometownFactValue('山东')), status: 'archived' },
      ],
    });
    expect(settings).toHaveLength(0);
  });
});

describe('role core pathway: deriveLanguageSettings stays the single decision rule', () => {
  it('is the same function used by the wiring', () => {
    const viaRule = deriveLanguageSettings({
      hometown: {
        province: '山东',
        languageLabel: '山东话',
        source: { kind: 'user_explicit' },
      },
    });
    expect(viaRule.active?.value).toBe('说山东话');
  });
});
