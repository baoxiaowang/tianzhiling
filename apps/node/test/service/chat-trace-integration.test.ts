import {
  ChatSpanEntity,
  ChatTraceStage,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { ConversationReplyProcessor } from '../../src/processor/conversation-reply.processor';
import { OpenAIService } from '../../src/service/agents/openai';
import { ChatTraceService } from '../../src/service/chat-trace.service';
import { ConversationService } from '../../src/service/conversation.service';

function createTraceService() {
  const service = new ChatTraceService();
  const spans: ChatSpanEntity[] = [];
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any;
  service.spanModel = {
    save: jest.fn(async (batch: ChatSpanEntity[]) => {
      spans.push(...batch);
      return batch;
    }),
  } as any;
  service.traceModel = {
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  } as any;
  return { service, spans };
}

describe('chat trace integration', () => {
  it('removes trace metadata before provider calls and records exact usage', async () => {
    const { service: traceService, spans } = createTraceService();
    const providerCreate = jest.fn().mockResolvedValue({
      model: 'chat-model-v1',
      choices: [{ finish_reason: 'stop', message: { content: '我也想你' } }],
      usage: {
        prompt_tokens: 31,
        completion_tokens: 5,
        total_tokens: 36,
      },
    });
    const openAIService = new OpenAIService();
    openAIService.logger = traceService.logger;
    openAIService.openAIConfig = { enabled: true, model: 'chat-model-v1' };
    openAIService.chatTraceService = traceService;
    (openAIService as any).client = {
      chat: { completions: { create: providerCreate } },
    };

    await traceService.runWithTrace(traceService.createTraceId(), () =>
      openAIService.createChatCompletion({
        messages: [{ role: 'user', content: '想你了' }],
        trace: {
          stage: ChatTraceStage.generate,
          operation: 'generate.primary',
        },
      })
    );

    expect(providerCreate.mock.calls[0][0].trace).toBeUndefined();
    expect(spans).toEqual([
      expect.objectContaining({
        stage: ChatTraceStage.generate,
        operation: 'generate.primary',
        model: 'chat-model-v1',
        promptTokens: 31,
        completionTokens: 5,
        totalTokens: 36,
      }),
    ]);
  });

  it('automatically links persisted assistant messages to the active trace', async () => {
    const { service: traceService } = createTraceService();
    const conversationService = new ConversationService();
    const savedMessages: any[] = [];
    conversationService.chatTraceService = traceService;
    conversationService.messageModel = {
      save: jest.fn(async message => {
        message.id = message.id || new MongoObjectId();
        savedMessages.push(message);
        return message;
      }),
    } as any;
    const traceId = traceService.createTraceId();
    const now = new Date();

    await traceService.runWithTrace(traceId, () =>
      (conversationService as any).saveMessage({
        conversationId: new MongoObjectId(),
        userId: new MongoObjectId(),
        agentId: new MongoObjectId(),
        role: MessageRole.assistant,
        type: MessageType.text,
        content: '我也想你',
        status: MessageStatus.sent,
        createdAt: now,
        updatedAt: now,
      })
    );

    expect(savedMessages[0].traceId).toBe(traceId);
  });

  it('propagates queue job identity and retry attempt into the worker', async () => {
    const processor = new ConversationReplyProcessor();
    const processJob = jest.fn().mockResolvedValue(undefined);
    processor.conversationService = {
      processConversationReplyJob: processJob,
    } as any;
    const data = {
      conversationId: new MongoObjectId().toHexString(),
      userId: new MongoObjectId().toHexString(),
      traceId: 'a'.repeat(32),
    };

    await processor.execute(data, {
      id: 'conversation-reply:test',
      attemptsMade: 1,
      opts: { attempts: 3 },
    } as any);

    expect(processJob).toHaveBeenCalledWith(data, {
      isFinalAttempt: false,
      attempt: 2,
      queueJobId: 'conversation-reply:test',
    });
  });
});
