import {
  AgentMemoryFactEntity,
  AgentMemoryFactPolarity,
  AgentMemoryFactType,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentMemoryFactService } from '../../src/service/agents/agent-memory-fact.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');
const MESSAGE_ID = new MongoObjectId('665000000000000000000020');

function createUserMessage(content: string): MessageEntity {
  const message = new MessageEntity();

  Object.assign(message, {
    id: MESSAGE_ID,
    userId: USER_ID,
    agentId: AGENT_ID,
    conversationId: new MongoObjectId('665000000000000000000030'),
    role: MessageRole.user,
    type: MessageType.text,
    content,
    status: MessageStatus.sent,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
  });

  return message;
}

describe('AgentMemoryFactService', () => {
  it('extracts high-priority profile, family, preference, and correction facts', async () => {
    const service = new AgentMemoryFactService();
    const savedFacts: AgentMemoryFactEntity[] = [];

    service.factModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async fact => {
        savedFacts.push(fact);
        return fact;
      }),
    } as never;

    const facts = await service.extractAndUpsertFromUserMessage({
      message: createUserMessage(
        '你不记得我是男生女生了吗？我是女生呀。咱们还有一个儿子呢，你不记得了吗？不了解的别瞎编哈，我啥时候也没爱吃辣子。谁告诉你他养过茉莉了？'
      ),
      searchableText:
        '你不记得我是男生女生了吗？我是女生呀。咱们还有一个儿子呢，你不记得了吗？不了解的别瞎编哈，我啥时候也没爱吃辣子。谁告诉你他养过茉莉了？',
    });

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: AgentMemoryFactType.profile,
          key: 'user.gender',
          value: '用户是女生',
          priority: 3,
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.family,
          key: 'family.son',
          value: '用户和当前角色有儿子',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.preference,
          key: 'user.preference.spicy',
          polarity: AgentMemoryFactPolarity.negative,
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.correction,
          key: 'correction.never_had.茉莉',
        }),
        expect.objectContaining({
          type: AgentMemoryFactType.correction,
          key: 'correction.no_fabrication',
        }),
      ])
    );
    expect(savedFacts).toHaveLength(facts.length);
  });

  it('formats stored facts for prompt injection by priority and recency', async () => {
    const service = new AgentMemoryFactService();
    const fact = new AgentMemoryFactEntity();

    Object.assign(fact, {
      userId: USER_ID,
      agentId: AGENT_ID,
      type: AgentMemoryFactType.profile,
      key: 'user.gender',
      value: '用户是女生',
      polarity: AgentMemoryFactPolarity.positive,
      priority: 3,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    service.factModel = {
      find: jest.fn().mockResolvedValue([fact]),
    } as never;

    await expect(
      service.listFactsForPrompt({
        userId: USER_ID,
        agentId: AGENT_ID,
      })
    ).resolves.toEqual([
      {
        type: AgentMemoryFactType.profile,
        key: 'user.gender',
        value: '用户是女生',
        polarity: AgentMemoryFactPolarity.positive,
        priority: 3,
      },
    ]);
  });
});
