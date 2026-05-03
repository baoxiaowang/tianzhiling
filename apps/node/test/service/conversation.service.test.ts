import {
  AgentEntity,
  AgentSex,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';

const USER_ID = '665000000000000000000001';
const AGENT_ID = '665000000000000000000010';
const CONVERSATION_ID = '665000000000000000000020';
const TIMBRE_ID = '665000000000000000000030';
const NOW = new Date('2026-05-03T08:00:00.000Z');
const AUTH = {
  sub: USER_ID,
  accountId: 'account-1',
  account: 'user',
  iat: 1777795200,
  exp: 1777824000,
  nonce: 'nonce',
};

function createAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(AGENT_ID),
    createdUserId: new MongoObjectId(USER_ID),
    name: '奶奶',
    avatar: '',
    sex: AgentSex.woman,
    iCallAgent: '奶奶',
    agentCallMe: '小宝',
    description: '',
    status: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return agent;
}

function createConversation(): ConversationEntity {
  const conversation = new ConversationEntity();

  Object.assign(conversation, {
    id: new MongoObjectId(CONVERSATION_ID),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    createdAt: NOW,
    updatedAt: NOW,
  });

  return conversation;
}

function createVoiceTimbre(): VoiceTimbreEntity {
  const timbre = new VoiceTimbreEntity();

  Object.assign(timbre, {
    id: new MongoObjectId(TIMBRE_ID),
    name: '温柔音色',
    provider: VoiceTimbreProvider.minimax,
    providerVoiceId: 'TzlVoice_001',
    audioObjectKey: 'voice-timbres/demo.wav',
    cloneLanguage: 'Chinese',
    previewModel: 'speech-2.8-turbo',
    status: VoiceTimbreStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  });

  return timbre;
}

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function createService(options: {
  agent: AgentEntity;
  voiceTimbre?: VoiceTimbreEntity | null;
}) {
  const service = new ConversationService();
  const conversation = createConversation();
  const savedMessages: MessageEntity[] = [];

  service.logger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as any;
  service.conversationModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;
      const userId = where?.userId;

      return sameObjectId(id, conversation.id) &&
        sameObjectId(userId, conversation.userId)
        ? conversation
        : null;
    }),
    save: jest.fn(async entity => entity),
  } as any;
  service.agentModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return sameObjectId(id, options.agent.id) ? options.agent : null;
    }),
  } as any;
  service.voiceTimbreModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const timbre = options.voiceTimbre;
      const id = where?.id ?? where?._id;

      if (!timbre) {
        return null;
      }

      return sameObjectId(id, timbre.id) && where?.status === timbre.status
        ? timbre
        : null;
    }),
  } as any;
  service.messageModel = {
    save: jest.fn(async message => {
      if (!message.id) {
        message.id = new MongoObjectId();
      }

      savedMessages.push(message);
      return message;
    }),
  } as any;
  service.openAIService = {
    createTranscription: jest.fn().mockResolvedValue('我想你了'),
    createChatCompletion: jest.fn().mockResolvedValue({
      model: 'MiniMax-M2.5',
      choices: [
        {
          message: {
            content: '我也想你，今天过得怎么样？',
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 12,
        total_tokens: 22,
      },
    }),
    createTextToSpeech: jest.fn(),
  } as any;
  service.minimaxVoiceSpeechService = {
    synthesize: jest.fn().mockResolvedValue({
      audioUrl: 'https://cdn.example.com/reply.mp3',
      audioBuffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]),
      mimeType: 'audio/mpeg',
    }),
  } as any;
  service.agentContextService = {
    buildConversationContext: jest.fn().mockResolvedValue({
      messages: [{ role: 'user', content: '我想你了' }],
    }),
  } as any;
  service.messageService = {
    buildConversationMessageItem: jest.fn(message => ({
      id: message.id?.toHexString?.() ?? '',
      type: message.type,
      content: message.content,
      voice: message.mediaUrl
        ? {
            url: message.mediaUrl,
            mimeType: message.mediaMimeType,
            transcript: message.mediaTranscript,
          }
        : undefined,
    })),
  } as any;
  service.postImageService = {
    resolveForResponse: jest.fn(value => value),
  } as any;
  service.ossService = {
    isEnabled: jest.fn(() => false),
  } as any;
  service.tencentCosService = {
    isEnabled: jest.fn(() => false),
    getPublicUrl: jest.fn(value => value),
  } as any;
  service.milvusService = {
    indexConversationMessage: jest.fn().mockResolvedValue(undefined),
  } as any;

  return { service, savedMessages };
}

describe('ConversationService assistant voice reply timbre binding', () => {
  it('falls back to text when a voice message agent has no voice timbre', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    const result = await service.sendMessage(
      AUTH,
      CONVERSATION_ID,
      {
        type: 'voice',
        mediaUrl: 'https://cdn.example.com/input.m4a',
        mimeType: 'audio/mp4',
      }
    );
    const assistantMessage = savedMessages.find(
      message => message.role === MessageRole.assistant
    );

    expect(assistantMessage).toEqual(
      expect.objectContaining({
        type: MessageType.text,
        content: '我也想你，今天过得怎么样？',
        status: MessageStatus.sent,
      })
    );
    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(service.openAIService.createTextToSpeech).not.toHaveBeenCalled();
    expect(result.assistantMessage?.type).toBe(MessageType.text);
  });

  it('uses the bound active MiniMax voice timbre for assistant voice replies', async () => {
    const voiceTimbre = createVoiceTimbre();
    const { service, savedMessages } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
    });

    const result = await service.sendMessage(
      AUTH,
      CONVERSATION_ID,
      {
        type: 'voice',
        mediaUrl: 'https://cdn.example.com/input.m4a',
        mimeType: 'audio/mp4',
      }
    );
    const assistantMessage = savedMessages.find(
      message => message.role === MessageRole.assistant
    );

    expect(service.minimaxVoiceSpeechService.synthesize).toHaveBeenCalledWith({
      text: '我也想你，今天过得怎么样？',
      voiceId: 'TzlVoice_001',
      model: 'speech-2.8-turbo',
      languageBoost: 'Chinese',
    });
    expect(assistantMessage).toEqual(
      expect.objectContaining({
        type: MessageType.voice,
        content: '我也想你，今天过得怎么样？',
        mediaUrl: 'https://cdn.example.com/reply.mp3',
        mediaMimeType: 'audio/mpeg',
        mediaTranscript: '我也想你，今天过得怎么样？',
      })
    );
    expect(service.openAIService.createTextToSpeech).not.toHaveBeenCalled();
    expect(result.assistantMessage?.type).toBe(MessageType.voice);
  });
});
