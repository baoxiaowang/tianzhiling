import {
  MemoryValueInput,
  parseMemoryValueOutput,
  needsMemoryReview,
  isMemoryCurrent,
  isCanonicalUserNameEvidence,
  withMemorySpeakers,
  gradeMemoryDecision,
  memoryValueSimilarity,
  resolveNewPeople,
  normalizeRelationKey,
  isContextOnlyNamespace,
  uncoveredMentionedPeople,
} from '../../src/service/agents/memory-value';

const input: MemoryValueInput = {
  currentMessageId: 'm1',
  referenceAt: '2026-09-08T00:00:00.000Z',
  subjects: [
    { ref: 'user:1', label: '妈妈' },
    { ref: 'agent:2', label: '儿子' },
  ],
  messages: [
    { id: 'a0', role: 'assistant', content: '你以前是木匠。' },
    { id: 'm1', role: 'user', content: '你一直是妈妈的骄傲，妈妈腰疼又犯了。' },
  ],
  existing: [],
};
const decision = () => ({
  subjectRef: 'user:1',
  participants: [],
  kind: 'person',
  type: 'memory',
  key: 'health.back_pain',
  value: '用户当前腰疼再次发作',
  retention: 'session',
  certainty: 'explicit',
  timeKind: 'current',
  validUntil: '2026-09-10T00:00:00.000Z',
  operation: 'add',
  reason: '近期关心身体变化',
  evidence: [{ messageId: 'm1', quote: '妈妈腰疼又犯了' }],
  protected: false,
  salience: 2,
});
const parse = (d = decision(), i = input) =>
  parseMemoryValueOutput(JSON.stringify({ decisions: [d] }), i);
describe('memory value contract', () => {
  it('requires a source-backed structured name for the account identity projection', () => {
    const source = {
      ...input,
      messages: [{ id: 'm1', role: 'user', content: '赵浩帅' }],
    };
    const d = {
      ...decision(),
      type: 'identity',
      key: 'user.identity.real_name',
      value: '用户正式姓名是赵浩帅',
      evidence: [{ messageId: 'm1', quote: '赵浩帅' }],
      identity: { realName: '赵浩帅' },
    };
    expect(parse(d as any, source)[0].identity?.realName).toBe('赵浩帅');
    expect(() =>
      parse({ ...d, identity: { realName: '赵皓帅' } } as any, source)
    ).toThrow('IDENTITY_EVIDENCE');
    expect(() => parse({ ...d, identity: undefined } as any, source)).toThrow(
      'IDENTITY_PAYLOAD'
    );
    expect(
      parse({ ...d, key: 'identity.real_name' } as any, source)[0].key
    ).toBe('user.identity.real_name');
    expect(() =>
      parse(
        { ...d, key: 'identity.real_name', identity: undefined } as any,
        source
      )
    ).toThrow('IDENTITY_PAYLOAD');
  });
  it('distinguishes the speaking account from the AI persona in question-answer context', () => {
    const normalized = withMemorySpeakers({
      ...input,
      conversationAgentRef: 'agent:2',
    });
    expect(normalized.currentUserRef).toBe('user:1');
    expect(normalized.messages[0]).toMatchObject({
      speakerRef: 'ai:assistant',
      addresseeRef: 'user:1',
      sourceKind: 'ai_generated',
    });
    expect(normalized.messages[1]).toMatchObject({
      speakerRef: 'user:1',
      addresseeRef: 'ai:assistant',
      sourceKind: 'user_original',
    });
  });
  it('keeps user formal names out of secondary fact and vector read sources', () => {
    expect(
      isCanonicalUserNameEvidence({
        key: 'user.identity.real_name',
        governance: { subjectRef: 'user:1' } as any,
      })
    ).toBe(true);
    expect(
      isCanonicalUserNameEvidence({
        key: 'identity.real_name',
        governance: { subjectRef: 'agent:2' } as any,
      })
    ).toBe(false);
  });
  it('preserves user health as a bounded current state', () => {
    expect(parse()[0]).toMatchObject({
      subjectRef: 'user:1',
      retention: 'session',
      timeKind: 'current',
    });
  });
  it('does not accept an assistant statement as user evidence', () => {
    expect(() =>
      parse({
        ...decision(),
        evidence: [{ messageId: 'a0', quote: '你以前是木匠' }],
      })
    ).toThrow('EVIDENCE');
  });
  it('rejects an invented quote even with a valid message id', () => {
    expect(() =>
      parse({
        ...decision(),
        evidence: [{ messageId: 'm1', quote: '妈妈有腰椎间盘突出' }],
      })
    ).toThrow('EVIDENCE');
  });
  it('rejects foreign or invented people', () => {
    expect(() => parse({ ...decision(), subjectRef: 'agent:foreign' })).toThrow(
      'SUBJECT'
    );
  });
  it('requires a real existing target before correction', () => {
    expect(() => parse({ ...decision(), operation: 'replace' })).toThrow(
      'TARGET'
    );
  });
  it('does not confuse discarding a new proposal with revoking an old fact', () => {
    const target = {
      id: 'f1',
      subjectRef: 'user:1',
      key: 'health.back_pain',
      value: '旧记录',
      type: 'memory',
      status: 'active',
      revision: 1,
      protected: false,
    };
    const i = { ...input, existing: [target] };
    expect(() =>
      parse(
        {
          ...decision(),
          operation: 'replace',
          targetId: 'f1',
          retention: 'discard',
        } as any,
        i
      )
    ).toThrow('DISCARD_MUTATION');
    const revoke = parse(
      {
        ...decision(),
        operation: 'archive',
        targetId: 'f1',
        retention: 'discard',
      } as any,
      i
    )[0];
    expect(needsMemoryReview(revoke, i)).toBe(true);
  });
  it('does not let add silently mutate an existing target', () => {
    expect(() => parse({ ...decision(), targetId: 'f1' } as any)).toThrow(
      'TARGET'
    );
  });
  it('allows reviewed reclassification instead of forcing delete-and-recreate', () => {
    const old = {
      id: 'f1',
      subjectRef: 'user:1',
      key: 'occupation.primary',
      value: '骄傲',
      type: 'occupation',
      status: 'active',
      revision: 0,
      protected: false,
    };
    const i = { ...input, existing: [old] };
    const d = parse(
      {
        ...decision(),
        operation: 'replace',
        targetId: 'f1',
        key: 'health.current',
        retention: 'durable',
      } as any,
      i
    )[0];
    expect(d.key).toBe('health.current');
    expect(needsMemoryReview(d, i)).toBe(true);
  });
  it('does not merge a fact into another person', () => {
    expect(() =>
      parse({ ...decision(), operation: 'merge', targetId: 'f1' } as any, {
        ...input,
        existing: [
          {
            id: 'f1',
            subjectRef: 'agent:2',
            key: 'health.back_pain',
            value: '旧记录',
            type: 'memory',
            status: 'active',
            revision: 1,
            protected: false,
          },
        ],
      })
    ).toThrow('TARGET');
  });
  it('requires a future and bounded review time for a temporary state', () => {
    expect(() => parse({ ...decision(), validUntil: '' })).toThrow('EXPIRY');
    expect(() =>
      parse({ ...decision(), validUntil: '2027-09-08T00:00:00Z' })
    ).toThrow('EXPIRY');
  });
  it('escalates identity even if a model omitted protection', () => {
    const d = parse({
      ...decision(),
      type: 'identity',
      retention: 'durable',
    })[0];
    expect(needsMemoryReview(d, input)).toBe(true);
    expect(needsMemoryReview(parse()[0], input)).toBe(false);
  });
  it('requires fresh user evidence when context supplies the subject', () => {
    expect(() =>
      parse(decision(), { ...input, currentMessageId: 'm2' })
    ).toThrow('EVIDENCE');
  });
  it('requires date expressions to be exact source evidence, not a paraphrase', () => {
    expect(() =>
      parse({
        ...decision(),
        kind: 'temporal',
        date: { event: 'death', expression: '离世一个月' },
      } as any)
    ).toThrow('DATE_EVIDENCE');
  });
  it('filters expired state without interpreting it as recovery', () => {
    expect(
      isMemoryCurrent(
        { validUntil: '2026-09-07T00:00:00Z' } as any,
        Date.parse(input.referenceAt)
      )
    ).toBe(false);
    expect(isMemoryCurrent({ timeKind: 'historical' } as any)).toBe(true);
  });
  it('accepts no memory and rejects malformed output', () => {
    expect(parseMemoryValueOutput('{"decisions":[]}', input)).toEqual([]);
    expect(() => parseMemoryValueOutput('稍后再试', input)).toThrow();
  });
  it('drops only invalid decisions instead of losing the whole message', () => {
    const valid = decision();
    // 非法项：operation=replace 却没有 targetId，按旧行为会让整条消息作废。
    const invalid = {
      ...decision(),
      key: 'health.other',
      operation: 'replace',
      value: '用户换了别的情况',
    };
    const decisions = parseMemoryValueOutput(
      JSON.stringify({ decisions: [invalid, valid] }),
      input
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].key).toBe('health.back_pain');
  });
  it('still throws when every decision is invalid so repair can run', () => {
    const invalid = {
      ...decision(),
      operation: 'replace',
    };
    expect(() =>
      parseMemoryValueOutput(JSON.stringify({ decisions: [invalid] }), input)
    ).toThrow();
  });
  it('drops a pure emotion expression instead of storing it', () => {
    expect(() =>
      gradeMemoryDecision(
        {
          ...decision(),
          key: 'current_state.exhaustion',
          value: '用户当前感到极度疲惫',
          retention: 'durable',
          validUntil: undefined,
        } as any,
        input.referenceAt
      )
    ).toThrow('MEMORY_VALUE_EMOTION_ONLY');
  });
  it('drops a value that quotes a term absent from the user message', () => {
    expect(() =>
      gradeMemoryDecision(
        {
          ...decision(),
          key: 'user_to_agent_address',
          value: '该亲人称用户为‘囡囡’',
        } as any,
        input.referenceAt,
        '树下听故事'
      )
    ).toThrow('MEMORY_VALUE_UNSOURCED_QUOTE');
  });
  it('downgrades diagnostic overstatement to a self report', () => {
    const graded = gradeMemoryDecision(
      {
        ...decision(),
        key: 'current_depression',
        value: '用户被诊断为抑郁症',
      } as any,
      input.referenceAt,
      '我抑郁了'
    );
    expect(graded.value).toContain('自述');
    expect(graded.value).not.toContain('被诊断');
  });
  it('normalizes a spouse kinship label on an agent subject', () => {
    const graded = gradeMemoryDecision(
      {
        ...decision(),
        subjectRef: 'agent:2',
        key: 'address_label_for_spouse',
        value: '该亲人的称呼记录',
      } as any,
      input.referenceAt,
      ''
    );
    expect(graded.key).toBe('address_label_for_agent');
  });
  it('drops a decision sourced only by a one-character reply', () => {
    expect(() =>
      gradeMemoryDecision(
        {
          ...decision(),
          key: 'current_state.acknowledgement',
          value: '用户确认日子难捱',
          evidence: [{ messageId: 'm1', quote: '对' }],
        } as any,
        input.referenceAt,
        '对'
      )
    ).toThrow('MEMORY_VALUE_WEAK_EVIDENCE');
  });
  it('drops an agent kinship term absent from the user words', () => {
    expect(() =>
      gradeMemoryDecision(
        {
          ...decision(),
          subjectRef: 'agent:2',
          key: 'relation.current',
          value: '用户与母亲相依为命',
          evidence: [{ messageId: 'm1', quote: '太太我想你' }],
        } as any,
        input.referenceAt,
        '太太我想你'
      )
    ).toThrow('MEMORY_VALUE_UNSOURCED_KINSHIP');
  });
  it('drops an agent departure duration without a departure term in evidence', () => {
    expect(() =>
      gradeMemoryDecision(
        {
          ...decision(),
          subjectRef: 'agent:2',
          key: 'disappearance_timing.five_years_ago',
          value: '该亲人离世至今已五年',
          evidence: [{ messageId: 'm1', quote: '已经有五年了' }],
        } as any,
        input.referenceAt,
        '已经有五年了'
      )
    ).toThrow('MEMORY_VALUE_UNSOURCED_DEPARTURE');
  });
  it('drops a psychologically inferred decision', () => {
    expect(() =>
      gradeMemoryDecision(
        {
          ...decision(),
          key: 'current_state.inferred',
          value: '用户以“嗯…”回应，体现自我保护性情感疏离',
        } as any,
        input.referenceAt
      )
    ).toThrow('MEMORY_VALUE_INFERENCE');
  });
  it('keeps an explicit grief trigger durable instead of grading it down', () => {
    const graded = gradeMemoryDecision(
      {
        ...decision(),
        key: 'grief_trigger.scene.hospital',
        value: '用户听到医院两个字会发抖',
        retention: 'durable',
        validUntil: undefined,
      } as any,
      input.referenceAt
    );
    expect(graded.retention).toBe('durable');
  });
  it('measures near-duplicate values for dedup', () => {
    expect(
      memoryValueSimilarity(
        '用户当前感到身体疼痛，疼得睡不着',
        '用户当前感到身体疼痛'
      )
    ).toBeGreaterThanOrEqual(0.6);
    expect(
      memoryValueSimilarity('用户当前感到身体疼痛', '太太在门口树下讲故事')
    ).toBeLessThan(0.6);
  });
  it('drops inferred decisions but keeps valid ones in the same message', () => {
    const inferred = {
      ...decision(),
      key: 'current_state.inferred',
      value: '用户以“嗯…”回应，体现自我保护性情感疏离',
    };
    const out = parseMemoryValueOutput(
      JSON.stringify({ decisions: [inferred, decision()] }),
      input
    );
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe('health.back_pain');
  });
  it('merges near-duplicate decisions inside one proposal', () => {
    const short = {
      ...decision(),
      key: 'health.pain.short',
      value: '用户当前感到身体疼痛',
    };
    const long = {
      ...decision(),
      key: 'health.pain.long',
      value: '用户当前感到身体疼痛，疼得睡不着',
    };
    const out = parseMemoryValueOutput(
      JSON.stringify({ decisions: [short, long] }),
      input
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toContain('疼得睡不着');
  });
  it('collapses same-key fragments inside one proposal', () => {
    const short = {
      ...decision(),
      key: 'health.phlebotomy',
      value: '用户抽血后手臂淤青',
    };
    const long = {
      ...decision(),
      key: 'health.phlebotomy',
      value: '用户抽血后手臂淤青，夜间被痛醒',
    };
    const out = parseMemoryValueOutput(
      JSON.stringify({ decisions: [short, long] }),
      input
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toContain('痛醒');
  });
  it('rejects merging two different relatives into one person', () => {
    const source = {
      ...input,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '看爸爸每天喝了酒不吃饭，妈妈身体也不舒服',
        },
      ],
    };
    const conflated = {
      ...decision(),
      subjectRef: 'agent:2',
      key: 'family.father_drinking',
      value: '嗲嗲婆婆（爸爸）每天喝酒不吃饭',
      evidence: [{ messageId: 'm1', quote: '看爸爸每天喝了酒不吃饭' }],
    };
    expect(() => parse(conflated as any, source)).toThrow(
      'KINSHIP_CONFLATION'
    );
    const samePerson = {
      ...decision(),
      value: '用户提到妈妈（母亲）身体不舒服',
      evidence: [{ messageId: 'm1', quote: '妈妈身体也不舒服' }],
    };
    expect(parse(samePerson as any, source)).toHaveLength(1);
  });
  it('rejects attributing speech to a relative when only the user spoke', () => {
    const d = {
      ...decision(),
      subjectRef: 'agent:2',
      key: 'communication.advice',
      value: '该亲人曾叮嘱用户按时吃饭',
    };
    expect(() => parse(d as any)).toThrow('SPEAKER_DIRECTION');
  });
  it('drops psychosocial inference wording beyond the original list', () => {
    for (const value of [
      '用户在疼痛时渴望母亲在场，凸显母女依恋的锚定作用',
      '该提问反映用户与亲人当前处于不同物理空间',
      '用户的远嫁认知源于接到电话后的自责',
    ]) {
      expect(() => parse({ ...decision(), value } as any)).toThrow('INFERENCE');
    }
  });
  it('drops plain heartache and helplessness as emotions, not facts', () => {
    for (const value of [
      '用户想起母亲时感到心疼',
      '用户探视时感到无助',
      '用户人前笑嘻嘻，人后独自难过',
    ]) {
      expect(() => parse({ ...decision(), value } as any)).toThrow(
        'EMOTION_ONLY'
      );
    }
  });
  it('keeps valid facts when one declared person is malformed', () => {
    const source: MemoryValueInput = {
      ...input,
      messages: [
        { id: 'm1', role: 'user', content: '爸爸每天喝酒不吃饭，妈妈走了' },
      ],
    };
    const good = {
      ref: 'new:father',
      label: '爸爸',
      relationToUser: '父亲',
      evidence: [{ messageId: 'm1', quote: '爸爸每天喝酒不吃饭' }],
    };
    const bad = {
      ref: 'not-a-new-ref',
      label: '强',
      relationToUser: '哥哥',
      evidence: [{ messageId: 'm1', quote: '爸爸每天喝酒不吃饭' }],
    };
    const { refs, accepted } = resolveNewPeople([good, bad], source);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].ref.startsWith('relative:')).toBe(true);
    expect(refs.get('new:father')?.startsWith('relative:')).toBe(true);
    expect(source.subjects.some(s => s.label.includes('爸爸'))).toBe(true);
    expect(source.subjects.some(s => s.label.includes('强'))).toBe(false);
  });
  it('accepts a declared person whose reference is not ASCII', () => {
    const source: MemoryValueInput = {
      ...input,
      messages: [{ id: 'm1', role: 'user', content: '爸爸每天喝酒不吃饭' }],
    };
    const { accepted } = resolveNewPeople(
      [
        {
          ref: 'new:爸爸',
          label: '爸爸',
          relationToUser: '父亲',
          evidence: [{ messageId: 'm1', quote: '爸爸每天喝酒不吃饭' }],
        },
      ],
      source
    );
    expect(accepted).toHaveLength(1);
  });
  it('drops momentary activity states', () => {
    for (const value of [
      '用户当前正在休息',
      '用户刚吃完饭',
      '用户现在在上班',
    ]) {
      expect(() => parse({ ...decision(), value } as any)).toThrow(
        'MOMENTARY_STATE'
      );
    }
    // 长期生活常态要保留。
    expect(
      parse({ ...decision(), value: '用户每天六点下班' } as any)
    ).toHaveLength(1);
  });
  it('drops psychology inferred from emoji or punctuation', () => {
    for (const value of [
      '用户通过连续哭泣表情符号表达强烈悲痛',
      '用户借助叹号强调其绝望心理状态',
    ]) {
      expect(() => parse({ ...decision(), value } as any)).toThrow('INFERENCE');
    }
  });
  it('drops vague aggregate family status but keeps named relatives', () => {
    for (const value of [
      '家里其他人都还好',
      '家里人也都很好',
      '他们过得都不错',
    ]) {
      expect(() => parse({ ...decision(), value } as any)).toThrow(
        'VAGUE_STATUS'
      );
    }
    // 对具体的人说“挺好”是有效事实，不能误杀。
    expect(
      parse({ ...decision(), value: '奶奶身体挺好' } as any)
    ).toHaveLength(1);
  });
  it('gives one person the same id across different messages', () => {
    const message = { id: 'm1', role: 'user', content: '小孙子快四岁了' };
    const first: MemoryValueInput = { ...input, messages: [message] };
    const second: MemoryValueInput = {
      ...input,
      currentMessageId: 'm2',
      messages: [{ id: 'm2', role: 'user', content: '小孙子很调皮' }],
    };
    const person = {
      ref: 'new:grandson',
      label: '小孙子',
      relationToUser: '孙子',
      evidence: [{ messageId: 'm1', quote: '小孙子快四岁了' }],
    };
    const a = resolveNewPeople([{ ...person }], first);
    const b = resolveNewPeople(
      [
        {
          ref: 'new:grandson_again',
          label: '毛璟琨',
          relationToUser: '孙子',
          evidence: [{ messageId: 'm2', quote: '小孙子很调皮' }],
        },
      ],
      second
    );
    expect(a.accepted).toHaveLength(1);
    expect(b.accepted).toHaveLength(1);
    // 同一个人换个称呼也要落到同一个主体：先按关系复用已有人物。
    expect(a.refs.get('new:grandson')).toBeDefined();
    expect(b.refs.get('new:grandson_again')).toBe(
      a.refs.get('new:grandson')
    );
  });
  it('does not fold a third party relation into a core relative', () => {
    // “母亲的兄弟”是舅舅，不能归到母亲身份上（否则出现“妈妈是妈妈的兄弟”）。
    expect(normalizeRelationKey('母亲的兄弟')).toBe('母亲的兄弟');
    expect(normalizeRelationKey('爷爷的姐姐')).toBe('爷爷的姐姐');
    expect(normalizeRelationKey('用户的舅舅')).toBe('舅舅');
    expect(normalizeRelationKey('小孙子')).toBe('孙辈');
    expect(normalizeRelationKey('外孙')).toBe('孙辈');
    expect(normalizeRelationKey('孙子')).toBe('孙辈');
  });
  it('only re-asks for core relatives, not distant ones', () => {
    const decisions = [
      {
        key: 'family.grandmother_granddaughter',
        value: '用户是奶奶的孙女',
        participants: [],
      },
    ];
    expect(
      uncoveredMentionedPeople(
        [
          { label: '奶奶' },
          { label: '弟弟' },
          { label: '妈妈' },
          { label: '爷爷的三姐', relation: '爷爷的姐姐' },
          { label: '老舅', relation: '舅舅' },
          { label: '弟弟' },
        ],
        decisions
      )
    ).toEqual(['弟弟', '妈妈']);
    // 以“名字”出现时靠 relation 判档：孙辈是核心亲人。
    expect(
      uncoveredMentionedPeople(
        [{ label: '毛璟琨', relation: '小孙子' }],
        decisions
      )
    ).toEqual(['毛璟琨']);
    expect(uncoveredMentionedPeople(undefined, decisions)).toEqual([]);
    expect(uncoveredMentionedPeople([{ label: '' }], decisions)).toEqual([]);
  });
  it('routes feeling-shaped memory namespaces to context-only', () => {
    for (const key of [
      'grief.shock_on_hearing_news',
      'grief_trigger.absence_of_mother_at_home',
      'emotion.response_to_father_s_grief',
      'emotional_state.forced_smile_fatigue',
      'behavior.emotional_masking',
      'need.unacknowledged_distress',
      'regret.self_blame',
      'social_support.absence_of_check_in',
      // 模型会不断发明新的前缀：白名单之外一律降级。
      'security_through_protection',
      'emotional_regulation_style',
      'home_as_mothered_space',
      'absence_of_emotional_support',
      'perception.external_validation_misalignment',
    ]) {
      expect(isContextOnlyNamespace(key)).toBe(true);
    }
    for (const key of [
      'health.foot_swelling_recent',
      'relationship.marital_disengagement_with_spouse',
      'occupation.sedentary_work_pattern',
      'family.child_high_school_grade_1',
      'time_since_passing',
      'preference.not_disclosing_marital_strain_to_family',
    ]) {
      expect(isContextOnlyNamespace(key)).toBe(false);
    }
  });
  it('rewrites listener-relative kin terms when the user is the subject', () => {
    const text = '就想着你小外孙刚高一都忍了，你女婿也不管';
    const graded = gradeMemoryDecision(
      {
        ...decision(),
        value: '用户因小外孙刚高一而忍耐，女婿不管事',
        evidence: [{ messageId: 'm1', quote: '就想着你小外孙刚高一都忍了' }],
      } as any,
      '2026-09-08T00:00:00.000Z',
      text
    );
    expect(graded.value).toContain('孩子');
    expect(graded.value).toContain('丈夫');
    expect(graded.value).not.toContain('外孙');
    expect(graded.value).not.toContain('女婿');
  });
  it('downgrades feeling-shaped facts to short-lived, non-assertable memory', () => {    const graded = gradeMemoryDecision(
      {
        ...decision(),
        key: 'grief.shock_on_hearing_news',
        value: '用户接到电话时难以相信',
        retention: 'durable',
        timeKind: 'historical',
      } as any,
      '2026-09-08T00:00:00.000Z',
      '接到电话真的不能相信'
    );
    expect(graded.retention).toBe('session');
    expect(graded.timeKind).toBe('current');
    expect(Date.parse(graded.validUntil!)).toBeGreaterThan(
      Date.parse('2026-09-08T00:00:00.000Z')
    );
  });
});
