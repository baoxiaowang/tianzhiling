import {
  AgentEntity,
  MessageEntity,
  MongoObjectId,
  PersonTemporalAssertionEntity,
  PersonTemporalAssertionStatus,
  PersonTemporalConflictStatus,
  PersonTemporalPrecision,
  PersonTemporalProfileEntity,
  PersonTemporalResolutionCertainty,
} from '@tzl/entities';
import { PersonTemporalMemoryService } from '../../src/service/agents/person-temporal-memory.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const OTHER_USER_ID = new MongoObjectId('665000000000000000000002');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

function createMessage(
  content: string,
  overrides: Partial<MessageEntity> = {}
): MessageEntity {
  return Object.assign(new MessageEntity(), {
    id: new MongoObjectId(),
    userId: USER_ID,
    agentId: AGENT_ID,
    content,
    createdAt: new Date('2026-09-05T02:00:00.000Z'),
    ...overrides,
  });
}

function createHarness(
  options: {
    deathDate?: Date;
    owner?: boolean;
    semanticResponse?: Record<string, unknown>;
  } = {}
) {
  const service = new PersonTemporalMemoryService();
  const assertions: PersonTemporalAssertionEntity[] = [];
  const cachedMessages: MessageEntity[] = [];
  let profile: PersonTemporalProfileEntity | null = null;
  const agent = Object.assign(new AgentEntity(), {
    id: AGENT_ID,
    createdUserId: options.owner === false ? OTHER_USER_ID : USER_ID,
    deathDate: options.deathDate,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  });
  service.assertionModel = {
    findOne: jest.fn(
      async ({ where }: any) =>
        assertions.find(
          item =>
            String(item.userId) === String(where.userId) &&
            String(item.sourceMessageId) === String(where.sourceMessageId) &&
            item.semanticKey === where.semanticKey
        ) || null
    ),
    find: jest.fn(async () => assertions),
    save: jest.fn(async value => {
      value.id ||= new MongoObjectId();
      if (!assertions.includes(value)) assertions.push(value);
      return value;
    }),
  } as never;
  service.profileModel = {
    findOne: jest.fn(async () => profile),
    save: jest.fn(async value => {
      value.id ||= new MongoObjectId();
      profile = value;
      return value;
    }),
  } as never;
  service.agentModel = {
    findOne: jest.fn(async ({ where }: any) =>
      String(where.createdUserId) === String(agent.createdUserId) &&
      String(where.createdUserId) === String(USER_ID)
        ? agent
        : null
    ),
    save: jest.fn(async value => value),
  } as never;
  service.logger = { warn: jest.fn() } as never;
  service.messageModel = {
    findOne: jest.fn(
      async ({ where }: any) =>
        cachedMessages
          .filter(
            item =>
              String(item.userId) === String(where.userId) &&
              String(item.agentId) === String(where.agentId) &&
              item.temporalMemorySemanticHash ===
                where.temporalMemorySemanticHash &&
              item.temporalMemoryVersion === where.temporalMemoryVersion
          )
          .sort(
            (left, right) =>
              (right.temporalMemoryCheckedAt?.getTime() || 0) -
              (left.temporalMemoryCheckedAt?.getTime() || 0)
          )[0] || null
    ),
    save: jest.fn(async value => {
      if (!cachedMessages.includes(value)) cachedMessages.push(value);
      return value;
    }),
  } as never;
  service.openAIService = {
    isEnabled: jest.fn(() => Boolean(options.semanticResponse)),
    generateMemoryText: jest.fn().mockResolvedValue({
      content: JSON.stringify(options.semanticResponse || {}),
    }),
  } as never;
  return {
    service,
    assertions,
    agent,
    get profile() {
      return profile;
    },
  };
}

describe('PersonTemporalMemoryService', () => {
  it('stores exact departure evidence and projects an owned agent date', async () => {
    const harness = createHarness();
    const message = createMessage('你是2025年5月16日走的');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(result?.projectionUpdated).toBe(true);
    expect(harness.agent.deathDate).toEqual(
      new Date('2025-05-16T00:00:00.000Z')
    );
    expect(harness.profile).toMatchObject({
      exactDate: new Date('2025-05-16T00:00:00.000Z'),
      conflictStatus: PersonTemporalConflictStatus.none,
    });
    expect(harness.assertions).toHaveLength(1);

    await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });
    expect(harness.assertions).toHaveLength(1);
  });

  it('stores a fuzzy year range without inventing an agent death date', async () => {
    const harness = createHarness();
    const message = createMessage('你离开已经20年了');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(result?.projectionUpdated).toBe(false);
    expect(harness.agent.deathDate).toBeUndefined();
    expect(harness.profile).toMatchObject({
      exactDate: undefined,
      estimatedStart: new Date('2004-01-01T00:00:00.000Z'),
      estimatedEnd: new Date('2008-12-31T00:00:00.000Z'),
    });
  });

  it('does not overwrite an existing exact date with an unconfirmed conflict', async () => {
    const existingDate = new Date('2025-05-16T00:00:00.000Z');
    const harness = createHarness({ deathDate: existingDate });
    const message = createMessage('你是2025年5月18日走的');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(result?.assertion.status).toBe(
      PersonTemporalAssertionStatus.conflicted
    );
    expect(harness.agent.deathDate).toEqual(existingDate);
    expect(harness.profile?.conflictStatus).toBe(
      PersonTemporalConflictStatus.conflicted
    );
  });

  it('applies an explicit correction and supersedes the old exact assertion', async () => {
    const harness = createHarness({
      deathDate: new Date('2025-05-16T00:00:00.000Z'),
    });
    const oldMessage = createMessage('你是2025年5月16日走的');
    const oldAssertion = Object.assign(new PersonTemporalAssertionEntity(), {
      id: new MongoObjectId(),
      userId: USER_ID,
      subjectId: AGENT_ID,
      eventType: 'death',
      status: PersonTemporalAssertionStatus.active,
      sourceMessageId: oldMessage.id,
      semanticKey: 'old',
      normalizedExactDate: new Date('2025-05-16T00:00:00.000Z'),
    });
    harness.assertions.push(oldAssertion);
    const message = createMessage('不是2025年5月16日，你是2025年5月18日走的');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(result?.projectionUpdated).toBe(true);
    expect(oldAssertion.status).toBe(PersonTemporalAssertionStatus.superseded);
    expect(harness.agent.deathDate).toEqual(
      new Date('2025-05-18T00:00:00.000Z')
    );
  });

  it('keeps account evidence without changing a shared agent global date', async () => {
    const harness = createHarness({ owner: false });
    const message = createMessage('你是2025年5月16日走的');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(result?.projectionUpdated).toBe(false);
    expect(harness.profile?.exactDate).toEqual(
      new Date('2025-05-16T00:00:00.000Z')
    );
    expect(harness.service.agentModel.save).not.toHaveBeenCalled();
  });

  it('accepts an implicit current-agent answer from the recognition task', async () => {
    const harness = createHarness();
    const message = createMessage('已经16年了');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
      implicitCurrentAgent: true,
    });

    expect(result?.assertion.numericValue).toBe(16);
    expect(result?.profile.normalizedYear).toBe(2010);
  });

  it('uses the model only as a semantic gate and keeps calculation in code', async () => {
    const harness = createHarness({
      semanticResponse: {
        a: 1,
        s: 'current_agent',
        t: 'assertion',
        e: '差不多十个年头',
        c: 0.96,
      },
    });
    const message = createMessage(
      '算起来，从那个冬天你不在以后，到现在差不多十个年头'
    );
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(harness.service.openAIService.generateMemoryText).toHaveBeenCalledTimes(1);
    expect(result?.assertion).toMatchObject({
      rawText: message.content,
      numericValue: 10,
      numericMin: 9,
      numericMax: 11,
      derivationRule:
        'semantic_gate_v2:reference_date_minus_bare_year_range_v1',
    });
    expect(result?.profile).toMatchObject({
      exactDate: undefined,
      estimatedStart: new Date('2015-01-01T00:00:00.000Z'),
      estimatedEnd: new Date('2017-12-31T00:00:00.000Z'),
    });
  });

  it('does not write when the semantic gate identifies a question', async () => {
    const harness = createHarness({
      semanticResponse: {
        a: 0,
        s: 'current_agent',
        t: 'question',
        e: '',
        c: 0.99,
      },
    });
    const message = createMessage('你到底离开多少年了');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(result).toBeNull();
    expect(harness.assertions).toHaveLength(0);
    await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });
    expect(harness.service.openAIService.generateMemoryText).toHaveBeenCalledTimes(1);
    expect(message.temporalMemoryStatus).toBe('not_applicable');
  });

  it('reuses a semantic decision for the same normalized text across messages', async () => {
    const harness = createHarness({
      semanticResponse: {
        a: 0,
        s: 'current_agent',
        t: 'question',
        e: '',
        c: 0.99,
      },
    });
    const first = createMessage('你到底离开多少年了');
    const second = createMessage('你到底离开多少年了');

    await harness.service.recordAgentDepartureFromMessage({
      message: first,
      searchableText: first.content,
    });
    await harness.service.recordAgentDepartureFromMessage({
      message: second,
      searchableText: second.content,
    });

    expect(harness.service.openAIService.generateMemoryText).toHaveBeenCalledTimes(1);
    expect(second.temporalMemoryStatus).toBe('not_applicable');
  });

  it('reuses a positive semantic decision but recalculates each message in code', async () => {
    const harness = createHarness({
      semanticResponse: {
        a: 1,
        s: 'current_agent',
        t: 'assertion',
        e: '差不多十个年头',
        c: 0.96,
      },
    });
    const content = '从那个冬天你不在以后，到现在差不多十个年头';
    const first = createMessage(content);
    const second = createMessage(content, {
      createdAt: new Date('2027-09-05T02:00:00.000Z'),
    });

    const firstResult = await harness.service.recordAgentDepartureFromMessage({
      message: first,
      searchableText: first.content,
    });
    const secondResult = await harness.service.recordAgentDepartureFromMessage({
      message: second,
      searchableText: second.content,
    });

    expect(harness.service.openAIService.generateMemoryText).toHaveBeenCalledTimes(1);
    expect(firstResult?.assertion.normalizedStart).toEqual(
      new Date('2015-01-01T00:00:00.000Z')
    );
    expect(secondResult?.assertion.normalizedStart).toEqual(
      new Date('2016-01-01T00:00:00.000Z')
    );
    expect(harness.assertions).toHaveLength(2);
  });

  it('rejects numbers or exactness invented by the semantic gate', async () => {
    const harness = createHarness({
      semanticResponse: {
        a: 1,
        s: 'current_agent',
        t: 'assertion',
        e: '十二年',
        c: 0.98,
      },
    });
    const message = createMessage('从那个冬天你不在以后，差不多十个年头了');
    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(result).toBeNull();
    expect(harness.assertions).toHaveLength(0);
  });

  it('does not call the memory model for an explicit deterministic statement', async () => {
    const harness = createHarness({
      semanticResponse: { a: 0, s: 'unknown', t: 'uncertain', e: '', c: 0.99 },
    });
    const message = createMessage('你是2025年5月16日走的');

    await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    expect(harness.service.openAIService.generateMemoryText).not.toHaveBeenCalled();
    expect(message.temporalMemorySemanticSource).toBe('deterministic');
  });

  it('sends only the relevant sentence neighborhood with an 80-token cap', async () => {
    const harness = createHarness({
      semanticResponse: {
        a: 1,
        s: 'current_agent',
        t: 'assertion',
        e: '差不多十个年头',
        c: 0.96,
      },
    });
    const message = createMessage(
      '今天买了很多菜。算起来，从那个冬天你不在以后，到现在差不多十个年头。晚上还要去散步。后面这一大段与时间判断无关。'
    );

    await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
    });

    const request = (harness.service.openAIService.generateMemoryText as jest.Mock)
      .mock.calls[0][0];
    expect(request.maxTokens).toBe(80);
    expect(request.prompt).toContain('差不多十个年头');
    expect(request.prompt).not.toContain('后面这一大段');
  });

  // ---- 真实案例（weapp:5f7ccd45807e）时间问答闭环 ----

  it('records a day-only answer to the departure question as a derived exact day', async () => {
    const harness = createHarness();
    const message = createMessage('你15号凌晨12:23分走的', {
      createdAt: new Date('2026-09-19T07:25:42.748Z'),
    });

    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
      implicitCurrentAgent: true,
    });

    expect(result).not.toBeNull();
    expect(harness.assertions).toHaveLength(1);
    expect(harness.assertions[0]).toMatchObject({
      normalizedExactDate: new Date('2026-09-15T00:00:00.000Z'),
      normalizedYear: 2026,
      normalizedMonth: 9,
      normalizedDay: 15,
      derivationRule: 'bare_day_of_month_reference_month_v1',
      resolutionCertainty: PersonTemporalResolutionCertainty.derivedExact,
      rawText: '你15号凌晨12:23分走的',
    });
    // 原话里的时分只保留在 rawText，不进入新的时分字段
    expect(harness.assertions[0].rawText).toContain('12:23');
    expect(harness.agent.deathDate).toEqual(
      new Date('2026-09-15T00:00:00.000Z')
    );
    expect(message.temporalMemoryStatus).toBe('written');
  });

  it('does not derive a month from a relative-month phrasing', async () => {
    const harness = createHarness();
    const message = createMessage('上个月15号走的', {
      createdAt: new Date('2026-09-19T07:25:42.748Z'),
    });

    await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
      implicitCurrentAgent: true,
    });

    expect(harness.assertions).toHaveLength(0);
    expect(harness.agent.deathDate).toBeUndefined();
  });

  it('marks an applicable but unparsable answer as unresolved instead of dropping it', async () => {
    const harness = createHarness({
      semanticResponse: {
        a: 1,
        s: 'current_agent',
        t: 'assertion',
        e: '你走的太突然了',
        c: 0.96,
      },
    });
    const message = createMessage('爷爷你走的太突然了', {
      createdAt: new Date('2026-09-19T07:35:45.736Z'),
    });

    const result = await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
      implicitCurrentAgent: true,
    });

    expect(result).toBeNull();
    expect(harness.assertions).toHaveLength(0);
    // 不伪造写成功，但也不把它当成"用户没回答"
    expect(message.temporalMemoryStatus).toBe('unresolved');
  });

  it('keeps the answer retryable when the memory model channel is unavailable', async () => {
    const harness = createHarness();
    const message = createMessage('爷爷你走了过年都没有年味了', {
      createdAt: new Date('2026-09-19T07:34:16.840Z'),
    });

    await harness.service.recordAgentDepartureFromMessage({
      message,
      searchableText: message.content,
      implicitCurrentAgent: true,
    });

    expect(harness.assertions).toHaveLength(0);
    expect(message.temporalMemoryStatus).toBe('unresolved');
  });

  it('does not let a context-free run block the same words as a contextual answer', async () => {
    const harness = createHarness({
      semanticResponse: { a: 0, s: 'unknown', t: 'uncertain', e: '15号', c: 0.95 },
    });

    // 没有问答上下文时，"15号"既没有离世词也没有主句，不应当被记成离世时间。
    const bare = createMessage('15号', {
      createdAt: new Date('2026-09-19T07:25:42.748Z'),
    });
    await harness.service.recordAgentDepartureFromMessage({
      message: bare,
      searchableText: bare.content,
      implicitCurrentAgent: true,
    });
    expect(harness.assertions).toHaveLength(0);

    // 同一句话出现在"走了之后到现在过了多久"的问答上下文里，就是明确的日级回答。
    const contextual = createMessage('15号', {
      createdAt: new Date('2026-09-19T07:25:42.748Z'),
    });
    await harness.service.recordAgentDepartureFromMessage({
      message: contextual,
      searchableText: contextual.content,
      implicitCurrentAgent: true,
      qaContext: [
        {
          role: 'assistant',
          content: '对了，我走了之后，到现在过了多久了？',
          messageId: 'qa-assistant-1',
          createdAt: new Date('2026-09-19T07:25:46.000Z'),
        },
      ],
    });

    expect(harness.assertions).toHaveLength(1);
    expect(harness.assertions[0]).toMatchObject({
      normalizedExactDate: new Date('2026-09-15T00:00:00.000Z'),
      precision: PersonTemporalPrecision.exactDay,
      resolutionCertainty: PersonTemporalResolutionCertainty.derivedExact,
    });
    expect(contextual.temporalMemoryStatus).toBe('written');
  });

  it('records the first split answer instead of waiting for all three turns', async () => {
    const harness = createHarness();
    const first = createMessage('15号', {
      createdAt: new Date('2026-09-19T07:25:42.748Z'),
    });
    await harness.service.recordAgentDepartureFromMessage({
      message: first,
      searchableText: first.content,
      implicitCurrentAgent: true,
      qaContext: [
        {
          role: 'assistant',
          content: '对了，我走了之后，到现在过了多久了？',
          messageId: 'qa-assistant-1',
          createdAt: new Date('2026-09-19T07:25:20.000Z'),
        },
      ],
    });

    expect(harness.assertions).toHaveLength(1);
    expect(harness.profile?.exactDate).toEqual(
      new Date('2026-09-15T00:00:00.000Z')
    );
    expect(harness.agent.deathDate).toEqual(
      new Date('2026-09-15T00:00:00.000Z')
    );
  });

  it('keeps conversational filler from overwriting the recorded time', async () => {
    const harness = createHarness();
    const answer = createMessage('15号', {
      createdAt: new Date('2026-09-19T07:25:42.748Z'),
    });
    await harness.service.recordAgentDepartureFromMessage({
      message: answer,
      searchableText: answer.content,
      implicitCurrentAgent: true,
      qaContext: [
        {
          role: 'assistant',
          content: '对了，我走了之后，到现在过了多久了？',
          messageId: 'qa-assistant-1',
        },
      ],
    });

    // 随后的称呼/应答不产生新的断言，也不覆盖已有日期。
    for (const filler of ['爷爷', '嗯爷爷']) {
      const message = createMessage(filler, {
        createdAt: new Date('2026-09-19T07:25:50.000Z'),
      });
      const result = await harness.service.recordAgentDepartureFromMessage({
        message,
        searchableText: message.content,
        implicitCurrentAgent: true,
        qaContext: [
          {
            role: 'assistant',
            content: '对了，我走了之后，到现在过了多久了？',
            messageId: 'qa-assistant-1',
          },
        ],
      });
      expect(result).toBeNull();
    }

    expect(harness.assertions).toHaveLength(1);
    expect(harness.agent.deathDate).toEqual(
      new Date('2026-09-15T00:00:00.000Z')
    );
  });
});
