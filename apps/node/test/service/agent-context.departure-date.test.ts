import { AgentEntity, ConversationEntity, MongoObjectId } from '@tzl/entities';
import { buildDepartureDateContext } from '../../src/common/departure-date-context';
import { AgentContextService } from '../../src/service/agents/agent.context';
const now = new Date('2026-11-20T08:00:00Z');
const deathDate = new Date('2026-08-15T00:00:00Z');
describe('stored departure date in actual model context', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());
  it.each([
    '你是哪天走的',
    '你离开我多少天了',
    '你的忌日是哪一天',
    '今天风真大',
  ])('keeps the date for %s', async currentQuery => {
    const service = new AgentContextService();
    service.messageModel = { find: jest.fn().mockResolvedValue([]) } as never;
    service.retrieveService = {
      retrieveConversationMemories: jest.fn().mockResolvedValue([]),
    } as never;
    service.agentProfileFactService = {
      listFactsForPrompt: jest.fn().mockResolvedValue([]),
    } as never;
    const userId = new MongoObjectId('665000000000000000000001');
    const agentId = new MongoObjectId('665000000000000000000010');
    const context = await service.buildConversationContext({
      auth: {
        sub: String(userId),
        accountId: '665000000000000000000101',
        account: 'test',
        iat: 0,
        exp: 0,
        nonce: 'test',
      },
      conversation: Object.assign(new ConversationEntity(), {
        id: new MongoObjectId('665000000000000000000020'),
        userId,
        agentId,
      }),
      agent: Object.assign(new AgentEntity(), {
        id: agentId,
        name: '亲人',
        deathDate,
        departureDuration: '过期时长',
      }),
      currentQuery,
    } as never);
    const prompt = context.messages
      .map(message => String(message.content))
      .join('\n');
    expect(prompt).toContain('离世日期是2026-08-15');
    expect(prompt).toContain('相隔97个自然日');
    expect(prompt).not.toContain('过期时长');
  });
  it('keeps the identity date when correction suppresses old memories', () => {
    const evidence = (new AgentContextService() as any).buildEvidencePack({
      currentQuery: '不对，你记错了',
      agent: { name: '亲人', deathDate },
      recentMessages: [],
      profileFacts: [],
      hardFacts: [],
      retrievedMemories: [],
      suppressPriorFacts: true,
      referenceTime: now,
    });
    expect(
      evidence.some((item: any) => item.factKey === 'identity.death_date')
    ).toBe(true);
  });
});
describe('Beijing date arithmetic', () => {
  it.each([
    ['2026-08-15T00:00:00Z', '2026-08-15T15:59:59Z', 0],
    ['2026-08-15T00:00:00Z', '2026-08-15T16:00:00Z', 1],
    ['2026-12-31T00:00:00Z', '2027-01-01T00:00:00Z', 1],
    ['2024-02-28T00:00:00Z', '2024-03-01T00:00:00Z', 2],
  ])('counts %s to %s', (from, to, days) => {
    const result = buildDepartureDateContext(new Date(from), new Date(to));
    expect(result?.elapsedText).toContain(`相隔${days}个自然日`);
    expect(result?.elapsedText).toContain(`第${days + 1}天`);
  });
  it('does not infer missing dates or negative elapsed days', () => {
    expect(buildDepartureDateContext(undefined, now)).toBeNull();
    expect(buildDepartureDateContext(new Date('invalid'), now)).toBeNull();
    expect(
      buildDepartureDateContext(new Date('2027-01-01'), now)?.elapsedText
    ).toBeUndefined();
  });
});
