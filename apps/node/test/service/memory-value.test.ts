import {
  MemoryValueInput,
  parseMemoryValueOutput,
  needsMemoryReview,
  isMemoryCurrent,
  isCanonicalUserNameEvidence,
  withMemorySpeakers,
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
});
