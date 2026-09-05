import {
  AgentEntity,
  MessageEntity,
  MongoObjectId,
  PersonTemporalAssertionEntity,
  PersonTemporalAssertionStatus,
  PersonTemporalConflictStatus,
  PersonTemporalProfileEntity,
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

function createHarness(options: { deathDate?: Date; owner?: boolean } = {}) {
  const service = new PersonTemporalMemoryService();
  const assertions: PersonTemporalAssertionEntity[] = [];
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
});
