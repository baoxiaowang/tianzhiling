import {
  buildCoreInfoView,
  type CoreAgentInput,
  type CoreFactInput,
  type CoreInfoInput,
  type CoreTemporalProfileInput,
} from '../../src/service/admin-app-user-core-info';

function fact(
  partial: Partial<CoreFactInput> & { key: string }
): CoreFactInput {
  return {
    id: partial.id || partial.key,
    type: partial.type || 'relationship',
    key: partial.key,
    value: partial.value || '',
    status: partial.status || 'active',
    confidence: partial.confidence || 'extracted',
    priority: partial.priority ?? 2,
    createdAt: partial.createdAt || '2026-01-01T00:00:00.000Z',
    updatedAt: partial.updatedAt || '2026-01-02T00:00:00.000Z',
    sourceMessageId: partial.sourceMessageId || '',
    sourceConversationId: partial.sourceConversationId || '',
    sourceText: partial.sourceText || '',
    timeKind: partial.timeKind || '',
  };
}

function agent(partial: Partial<CoreAgentInput> = {}): CoreAgentInput {
  return {
    id: 'agent-1',
    name: '爷爷',
    realName: '',
    iCallAgent: '',
    agentCallMe: '',
    sex: 'male',
    birthday: '',
    deathDate: '',
    departureDuration: '',
    languageHabits: '',
    relationshipType: '',
    persona: {
      personalityTraits: '',
      languageProfile: {},
      languageProfileSources: {},
      lifeTraits: [],
      coreValues: [],
    },
    ...partial,
  };
}

function input(partial: Partial<CoreInfoInput> = {}): CoreInfoInput {
  return {
    userId: 'user-1',
    agent: agent(),
    facts: [],
    temporalProfiles: [],
    temporalAssertions: [],
    subjectLabels: {},
    ...partial,
  };
}

describe('admin core info view: reuses @tzl/shared selection rules', () => {
  it('adopts the preferred-name fact over the profile field and reports the loser', () => {
    const view = buildCoreInfoView(
      input({
        agent: agent({ iCallAgent: '爷爷' }),
        facts: [
          fact({
            key: 'relationship.preferred_agent_name',
            value: '当前用户偏好称呼当前角色为老爷子',
            confidence: 'confirmed',
            sourceMessageId: 'msg-1',
          }),
        ],
      })
    );

    expect(view.addresses.userCallsAgent?.value).toBe('老爷子');
    expect(view.addresses.userCallsAgent?.status).toBe('adopted');
    expect(view.addresses.userCallsAgent?.source?.kind).toBe('user_explicit');
    expect(view.addresses.userCallsAgent?.source?.messageId).toBe('msg-1');

    const loser = view.addresses.candidates.find(item => item.value === '爷爷');
    expect(loser?.status).toBe('rejected');
    expect(loser?.reason).toContain('被更高优先级来源覆盖');
  });

  it('marks pending when same-priority candidates disagree', () => {
    const view = buildCoreInfoView(
      input({
        agent: agent({ iCallAgent: '爷爷' }),
        facts: [
          fact({
            key: 'relationship.preferred_agent_name',
            value: '当前用户偏好称呼当前角色为老爷子',
            confidence: 'confirmed',
          }),
        ],
      })
    );
    // preferred fact is user_explicit(50) vs iCallAgent profile_field(40): no conflict.
    expect(view.addresses.userCallsAgent?.status).toBe('adopted');

    const pending = buildCoreInfoView(
      input({
        agent: agent({ iCallAgent: '爷爷' }),
        // no preferred fact -> single profile_field candidate
      })
    );
    expect(pending.addresses.userCallsAgent?.status).toBe('adopted');
  });

  it('reports archived user_corrected facts with a synthesized reason (no raw reason in DB)', () => {
    const view = buildCoreInfoView(
      input({
        facts: [
          fact({
            key: 'relationship.preferred_user_name',
            value: '当前用户希望当前角色称呼其为湾呐',
            status: 'archived',
            confidence: 'user_corrected',
          }),
        ],
      })
    );

    const rejected = view.addresses.candidates.find(item =>
      item.reason.includes('被用户明确更正覆盖')
    );
    expect(rejected).toBeDefined();
    expect(rejected?.reason).toContain('合成');
    expect(view.limitations.join('\n')).toContain('归档路径不写 reason');
  });

  it('never fabricates a year for birthday_observance', () => {
    const profile: CoreTemporalProfileInput = {
      bestAssertionId: 'a-1',
      subjectType: 'agent',
      subjectId: 'agent-1',
      eventType: 'birthday_observance',
      calendar: 'lunar',
      precision: 'month_day',
      resolutionCertainty: 'explicit_exact',
      conflictStatus: 'none',
      normalizedYear: 1935,
      normalizedMonth: 8,
      normalizedDay: 15,
      exactDate: '2026-09-25T00:00:00.000Z',
      estimatedStart: '',
      estimatedEnd: '',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const view = buildCoreInfoView(
      input({
        temporalProfiles: [profile],
        temporalAssertions: [
          {
            id: 'a-1',
            eventType: 'birthday_observance',
            subjectType: 'agent',
            subjectId: 'agent-1',
            rawText: '八月十五是爷爷生日',
            status: 'active',
            sourceMessageId: 'msg-9',
            sourceConversationId: 'conv-1',
            createdAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      })
    );

    const item = view.dates.items[0];
    expect(item.year).toBeNull();
    expect(item.exactDate).toBe('');
    expect(item.monthDay).toBe('08-15');
    expect(item.note).toContain('不写年份');
    expect(item.source?.messageId).toBe('msg-9');
  });

  it('derives regional language through the shared rule and marks it product_derived', () => {
    const view = buildCoreInfoView(
      input({
        facts: [
          fact({
            key: 'origin.hometown',
            value: '当前角色的籍贯是山东省',
            type: 'identity',
          }),
        ],
      })
    );

    expect(view.language.hometown?.province).toBe('山东');
    expect(view.language.adopted?.value).toBe('说山东话');
    expect(view.language.adopted?.source?.kind).toBe('product_derived');
    expect(view.language.adopted?.reason).toContain('产品派生');
  });

  it('lets an explicit language fact override the derived default and keeps the superseded derived entry', () => {
    const view = buildCoreInfoView(
      input({
        facts: [
          fact({ key: 'origin.hometown', value: '当前角色的籍贯是山东省' }),
          fact({
            key: 'profile_source.language_habits',
            value: '当前角色语言习惯：说普通话',
            type: 'preference',
          }),
        ],
      })
    );

    expect(view.language.adopted?.value).toBe('说普通话');
    expect(view.language.adopted?.source?.kind).toBe('profile_field');
    expect(view.language.superseded).toHaveLength(1);
    expect(view.language.superseded[0].value).toBe('说山东话');
    expect(view.language.superseded[0].reason).toContain('被用户明确要求覆盖');
  });

  it('exposes per-dimension import sources and confidence', () => {
    const view = buildCoreInfoView(
      input({
        agent: agent({
          persona: {
            personalityTraits: '急躁、护短',
            languageProfile: { sentenceLength: '多为5至12字的消息' },
            languageProfileSources: {
              sentenceLength: { batchId: 'batch-7', confidence: 0.82 },
            },
            lifeTraits: ['节俭'],
            coreValues: [],
          },
        }),
      })
    );

    expect(view.language.importDimensions).toHaveLength(1);
    expect(view.language.importDimensions[0].batchId).toBe('batch-7');
    expect(view.language.importDimensions[0].confidence).toBe(0.82);
    expect(view.personality.traits.map(item => item.value)).toEqual(
      expect.arrayContaining(['急躁', '护短', '节俭'])
    );
  });

  it('distinguishes stable family facts from possibly-changing ones', () => {
    const view = buildCoreInfoView(
      input({
        facts: [
          fact({
            key: 'family.shared_member.小军',
            value: '用户和当前角色共同的儿子叫小军',
            type: 'family',
            timeKind: 'stable',
          }),
          fact({
            key: 'family.work_status',
            value: '用户和当前角色说过最近在换工作',
            type: 'family',
            timeKind: 'current',
          }),
        ],
      })
    );

    const stable = view.family.items.find(item => item.key.includes('小军'));
    const changing = view.family.items.find(
      item => item.key === 'family.work_status'
    );
    expect(stable?.stability).toBe('stable');
    expect(stable?.personLabel).toBe('小军');
    expect(changing?.stability).toBe('possibly_changing');
    expect(changing?.stabilityLabel).toContain('可能变化');
  });
});
