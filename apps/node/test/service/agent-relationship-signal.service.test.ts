import {
  AgentRelationshipSignalAssertionPolicy,
  AgentRelationshipSignalEntity,
  AgentRelationshipSignalStatus,
  AgentRelationshipSignalSubject,
  AgentRelationshipSignalTopic,
  AgentRelationshipSignalType,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentRelationshipSignalService } from '../../src/service/agents/agent-relationship-signal.service';
import type { StructuredReplyIntent } from '../../src/service/agents/reply-intent';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

function createMessage(id: string, content: string): MessageEntity {
  const message = new MessageEntity();
  Object.assign(message, {
    id: new MongoObjectId(id),
    conversationId: new MongoObjectId('665000000000000000000020'),
    userId: USER_ID,
    agentId: AGENT_ID,
    role: MessageRole.user,
    type: MessageType.text,
    content,
    status: MessageStatus.sent,
    createdAt: new Date('2026-07-28T08:00:00.000Z'),
    updatedAt: new Date('2026-07-28T08:00:00.000Z'),
  });

  return message;
}

function createPainIntent(): StructuredReplyIntent {
  return {
    intents: [
      {
        target: 'agent',
        timeScope: 'current',
        intent: 'ask_agent_status',
        subIntent: 'physical_pain',
        confidence: 0.99,
      },
    ],
    emotion: 'concern',
    riskLevel: 'none',
    confidence: 0.99,
    source: 'hard_rule',
  };
}

function createService() {
  const signals: AgentRelationshipSignalEntity[] = [];
  const service = new AgentRelationshipSignalService();
  service.signalModel = {
    findOne: jest.fn(async ({ where }: any) => {
      return (
        signals.find(
          signal =>
            signal.userId.equals(where.userId) &&
            signal.agentId.equals(where.agentId) &&
            signal.signalType === where.signalType &&
            signal.topic === where.topic
        ) ?? null
      );
    }),
    find: jest.fn(async () => signals),
    save: jest.fn(async signal => {
      if (!signal.id) {
        signal.id = new MongoObjectId();
        signals.push(signal);
      }

      return signal;
    }),
  } as never;

  return { service, signals };
}

describe('AgentRelationshipSignalService', () => {
  it('stores concern as a user relationship signal without asserting illness', async () => {
    const { service, signals } = createService();
    const result = await service.upsertFromUserMessage({
      message: createMessage(
        '665000000000000000000101',
        '那你呢？现在身上还疼吗？'
      ),
      intent: createPainIntent(),
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: 'concern.agent_physical_suffering',
        signalType: AgentRelationshipSignalType.concern,
        topic: AgentRelationshipSignalTopic.agentPhysicalSuffering,
        subject: AgentRelationshipSignalSubject.agent,
        status: AgentRelationshipSignalStatus.active,
        assertionPolicy:
          AgentRelationshipSignalAssertionPolicy.userStateOnly,
        supportCount: 1,
      }),
    ]);
    expect(signals).toHaveLength(1);
    expect(JSON.stringify(signals[0])).not.toMatch(/疾病|生病|伤口|病因|治疗/);
  });

  it('is idempotent per source message and counts repeated concern', async () => {
    const { service } = createService();
    const firstMessage = createMessage(
      '665000000000000000000101',
      '那你呢？现在身上还疼吗？'
    );

    await service.upsertFromUserMessage({
      message: firstMessage,
      intent: createPainIntent(),
    });
    const duplicate = await service.upsertFromUserMessage({
      message: firstMessage,
      intent: createPainIntent(),
    });
    const repeated = await service.upsertFromUserMessage({
      message: createMessage(
        '665000000000000000000102',
        '你现在还难受吗？'
      ),
      intent: createPainIntent(),
    });

    expect(duplicate[0].supportCount).toBe(1);
    expect(repeated[0].supportCount).toBe(2);
  });

  it('does not create or inject the signal for unrelated subjects', async () => {
    const { service } = createService();
    const familyIntent: StructuredReplyIntent = {
      intents: [
        {
          target: 'family',
          timeScope: 'current',
          intent: 'share_family_update',
          subIntent: 'family_care',
          confidence: 0.96,
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      confidence: 0.96,
      source: 'semantic_model',
    };

    await expect(
      service.upsertFromUserMessage({
        message: createMessage(
          '665000000000000000000103',
          '妈妈最近血压有点高'
        ),
        intent: familyIntent,
      })
    ).resolves.toEqual([]);

    const stored = await service.upsertFromUserMessage({
      message: createMessage(
        '665000000000000000000104',
        '那你呢？现在身上还疼吗？'
      ),
      intent: createPainIntent(),
    });

    expect(service.selectRelevantSignals(stored, familyIntent)).toEqual([]);
    expect(
      service.selectRelevantSignals(stored, createPainIntent())
    ).toHaveLength(1);
  });
});
