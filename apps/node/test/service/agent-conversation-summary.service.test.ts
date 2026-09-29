import {
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentConversationSummaryService } from '../../src/service/agents/agent-conversation-summary.service';

const CONVERSATION_ID = new MongoObjectId('665000000000000000000020');
const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');

function createMessage(index: number, forceRole?: MessageRole): MessageEntity {
  const role = forceRole ?? (index % 2 === 1 ? MessageRole.user : MessageRole.assistant);
  const message = new MessageEntity();
  Object.assign(message, {
    id: new MongoObjectId(
      `665000000000000000000${String(index).padStart(3, '0')}`
    ),
    conversationId: CONVERSATION_ID,
    userId: USER_ID,
    agentId: AGENT_ID,
    role,
    type: MessageType.text,
    content: role === MessageRole.user ? `用户消息${index}` : `助手回复${index}`,
    status: MessageStatus.sent,
    createdAt: new Date(1_700_000_000_000 + index * 1000),
    updatedAt: new Date(1_700_000_000_000 + index * 1000),
  });

  return message;
}

describe('AgentConversationSummaryService', () => {
  it('refreshes a context-only summary in the background after enough messages', async () => {
    const service = new AgentConversationSummaryService();
    const conversation = new ConversationEntity();
    Object.assign(conversation, {
      id: CONVERSATION_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
    });
    const messages = Array.from({ length: 40 }, (_, index) =>
      createMessage(index + 1)
    );
    service.messageModel = {
      find: jest.fn().mockResolvedValue(messages),
    } as never;
    service.conversationModel = {
      save: jest.fn(async value => value),
    } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          topic: '家里的近况',
          userState: '担心家人，也纠正了一处旧记忆',
          responded: '已回应用户的担心',
          unresolved: '家人的后续情况',
        }),
      }),
    } as never;

    await service.refresh(conversation);

    expect(service.messageModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 96,
        order: {
          createdAt: 'DESC',
        },
      })
    );
    expect(service.openAIService.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        systemPrompt: expect.stringContaining('不能成为用户经历'),
      })
    );
    expect(conversation).toEqual(
      expect.objectContaining({
        continuitySummary:
          '当前话题：家里的近况\n用户状态：担心家人，也纠正了一处旧记忆\n已经回应：已回应用户的担心\n未解决：家人的后续情况',
        continuitySummaryVersion: 'continuity_summary_v2',
      })
    );
    // 20 个完整轮次：摘要只覆盖最近 8 轮之前的部分（前 24 条），
    // 其中用户消息 12 条；最近 8 轮留给原始历史。
    expect(conversation.continuitySummaryEvidenceMessageIds?.length).toBe(12);
    const generatedPrompt = (
      service.openAIService.generateText as jest.Mock
    ).mock.calls[0][0].prompt as string;
    expect(generatedPrompt).not.toContain('用户消息39');
    expect(generatedPrompt).not.toContain('助手回复40');
    expect(service.conversationModel.save).toHaveBeenCalledWith(conversation);
  });

  it('shares one in-flight refresh for the same conversation', async () => {
    const service = new AgentConversationSummaryService();
    const conversation = new ConversationEntity();
    Object.assign(conversation, {
      id: CONVERSATION_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
    });
    const messages = Array.from({ length: 20 }, (_, index) =>
      createMessage(index + 1)
    );
    let completeGeneration: (value: { content: string }) => void;
    const generation = new Promise<{ content: string }>(resolve => {
      completeGeneration = resolve;
    });
    service.messageModel = {
      find: jest.fn().mockResolvedValue(messages),
    } as never;
    service.conversationModel = {
      save: jest.fn(async value => value),
    } as never;
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateText: jest.fn(() => generation),
    } as never;

    const first = service.refresh(conversation);
    const second = service.refresh(conversation);

    expect(second).toBe(first);
    expect(service.messageModel.find).toHaveBeenCalledTimes(1);

    completeGeneration!({
      content: JSON.stringify({ topic: '近况' }),
    });
    await Promise.all([first, second]);

    await service.refresh(conversation);
    expect(service.messageModel.find).toHaveBeenCalledTimes(2);
  });
});
