import {
  AgentContextService,
  resolveSemanticRetrievalQuery,
  shouldTriggerMemoryRetrieval,
} from '../../src/service/agents/agent.context';

describe('memory retrieval gate', () => {
  it('does not retrieve for ordinary chat without a memory signal', () => {
    for (const text of [
      '今天天气不错',
      '我吃完晚饭了',
      '好的',
      '嗯嗯',
      '在吗',
      '我今天有点累',
    ]) {
      expect(shouldTriggerMemoryRetrieval('', text)).toBe(false);
    }
  });

  it('retrieves when the message is a memory question or recall cue', () => {
    for (const text of [
      '核桃是谁',
      '你还记得以前的事吗',
      '上次说的那个事',
      '我妈哪年走的',
      '爸爸的生日是哪天',
      '我以前是不是说过',
      '老家在哪',
    ]) {
      expect(shouldTriggerMemoryRetrieval('', text)).toBe(true);
    }
  });

  it('retrieves when structured keys were extracted', () => {
    expect(shouldTriggerMemoryRetrieval('爸爸 去年', '爸爸去年住院')).toBe(
      true
    );
    expect(shouldTriggerMemoryRetrieval('', '爸爸去年吃饭')).toBe(false);
    expect(shouldTriggerMemoryRetrieval('', '爸爸去年吃饭', true)).toBe(true);
  });
});

describe('resolveSemanticRetrievalQuery', () => {
  it('combines keys, matched known-person names and a short core', () => {
    const query = resolveSemanticRetrievalQuery('核桃 儿子', '核桃是谁', [
      '核桃',
      '何筱伟',
    ]);
    expect(query).toContain('核桃');
    expect(query).toContain('儿子');
    expect(query).not.toContain('何筱伟');
  });

  it('keeps the original sentence as a fallback when nothing else matches', () => {
    const query = resolveSemanticRetrievalQuery('', '你还记得那只猫吗', []);
    expect(query).toContain('你还记得那只猫吗');
  });

  it('dedupes and caps the query length', () => {
    const query = resolveSemanticRetrievalQuery('核桃 核桃', '核桃是谁', [
      '核桃',
    ]);
    expect(query.length).toBeLessThanOrEqual(200);
    expect(query.split(' ').filter(Boolean)).toEqual(
      Array.from(new Set(query.split(' ').filter(Boolean)))
    );
  });
});

describe('current time prompt', () => {
  it('marks the day period without prescribing how to interpret a dream', () => {
    const service = new AgentContextService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    const prompt = (
      service as unknown as {
        buildConversationReturnContextPrompt: (context: unknown) => string;
      }
    ).buildConversationReturnContextPrompt({
      currentTurnAt: '2026-10-07T23:06:00.000Z',
      previousContactAt: '2026-10-07T14:00:00.000Z',
      previousUserContactAt: '2026-10-07T14:00:00.000Z',
      elapsedHours: 9.1,
      elapsedDays: 0.38,
      isReunion: false,
      version: 'conversation_return_context_v2',
    });

    expect(prompt).toContain('07:06（早上）');
    expect(prompt).not.toContain('不要默认用户刚躺下准备睡');
  });
});
