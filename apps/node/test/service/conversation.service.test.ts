import {
  AgentEntity,
  AgentSex,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  UserEntity,
  UserMembershipEntity,
  UserMembershipStatus,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';

const USER_ID = '665000000000000000000001';
const AGENT_ID = '665000000000000000000010';
const OTHER_AGENT_ID = '665000000000000000000011';
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

function createConversation(
  overrides: Partial<ConversationEntity> = {}
): ConversationEntity {
  const conversation = new ConversationEntity();

  Object.assign(conversation, {
    id: new MongoObjectId(CONVERSATION_ID),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return conversation;
}

function createUser(overrides: Partial<UserEntity> = {}): UserEntity {
  const user = new UserEntity();

  Object.assign(user, {
    id: new MongoObjectId(USER_ID),
    name: '小宝',
    avatar: '',
    phone: '',
    phoneVerified: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return user;
}

function createMembership(
  overrides: Partial<UserMembershipEntity> = {}
): UserMembershipEntity {
  const membership = new UserMembershipEntity();

  Object.assign(membership, {
    id: new MongoObjectId('665000000000000000000040'),
    userId: new MongoObjectId(USER_ID),
    vipPlanId: new MongoObjectId('665000000000000000000041'),
    vipPlanCode: 'vip_month',
    sourceOrderId: new MongoObjectId('665000000000000000000042'),
    status: UserMembershipStatus.active,
    startedAt: NOW,
    expiredAt: new Date('2026-06-03T08:00:00.000Z'),
    lifetime: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return membership;
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
    speechSpeed: 1.12,
    speechVolume: 1.1,
    speechPitch: -1,
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
  chatContent?: string;
  user?: UserEntity | null;
  memberships?: UserMembershipEntity[];
  existingUserMessageCount?: number;
}) {
  const service = new ConversationService();
  const conversation = createConversation();
  const user = options.user === undefined ? createUser() : options.user;
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
    count: jest.fn().mockResolvedValue(options.existingUserMessageCount ?? 0),
    save: jest.fn(async message => {
      if (!message.id) {
        message.id = new MongoObjectId();
      }

      savedMessages.push(message);
      return message;
    }),
  } as any;
  service.userModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return user && sameObjectId(id, user.id) ? user : null;
    }),
  } as any;
  service.userMembershipModel = {
    find: jest.fn().mockResolvedValue(options.memberships ?? []),
  } as any;
  service.openAIService = {
    createTranscription: jest.fn().mockResolvedValue('我想你了'),
    createChatCompletion: jest.fn().mockResolvedValue({
      model: 'MiniMax-M2.5',
      choices: [
        {
          message: {
            content: options.chatContent || '我也想你，今天过得怎么样？',
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
      voice: message.mediaObjectKey || message.mediaUrl
        ? {
            objectKey: message.mediaObjectKey || undefined,
            url: message.mediaUrl,
            mimeType: message.mediaMimeType,
            transcript: message.mediaTranscript,
          }
        : undefined,
    })),
  } as any;
  service.postImageService = {
    resolveForResponse: jest.fn(value => value),
    normalizeForStorage: jest.fn(value => value),
  } as any;
  service.ossService = {
    isEnabled: jest.fn(() => false),
  } as any;
  service.tencentCosService = {
    isEnabled: jest.fn(() => true),
    getPublicUrl: jest.fn(value => value),
    putBuffer: jest.fn().mockResolvedValue({
      objectKey: 'conversation-voice-replies/reply.mp3',
      url: 'https://cdn.example.com/conversation-voice-replies/reply.mp3',
    }),
  } as any;
  service.milvusService = {
    indexConversationMessage: jest.fn().mockResolvedValue(undefined),
  } as any;

  return { service, savedMessages };
}

describe('ConversationService assistant voice reply timbre binding', () => {
  it('blocks non-vip users after the first 3-day per-agent quota is used', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      }),
      existingUserMessageCount: 30,
    });

    await expect(
      service.sendMessage(AUTH, CONVERSATION_ID, {
        type: 'text',
        content: '我想你了',
      })
    ).rejects.toMatchObject({
      code: 'NON_VIP_CHAT_LIMIT_EXCEEDED',
      status: 429,
    });

    expect(savedMessages).toHaveLength(0);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
    expect(service.messageModel.count).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: new MongoObjectId(USER_ID),
        agentId: new MongoObjectId(AGENT_ID),
        role: MessageRole.user,
        status: MessageStatus.sent,
      })
    );
  });

  it('blocks non-vip users after the daily per-agent quota is used outside the trial period', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 3,
    });

    await expect(
      service.sendMessage(AUTH, CONVERSATION_ID, {
        type: 'text',
        content: '今天也想聊聊',
      })
    ).rejects.toMatchObject({
      code: 'NON_VIP_CHAT_LIMIT_EXCEEDED',
      status: 429,
    });

    expect(savedMessages).toHaveLength(0);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
    expect(service.messageModel.count).toHaveBeenCalledWith(
      expect.objectContaining({
        createdAt: expect.objectContaining({
          $gte: expect.any(Date),
          $lt: expect.any(Date),
        }),
      })
    );
  });

  it('returns remaining non-vip chat quota after a successful user message', async () => {
    const { service } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '再说一句',
    });

    expect(result.chatQuota).toEqual(
      expect.objectContaining({
        isVip: false,
        policy: 'daily',
        limit: 3,
        usedCount: 2,
        remainingCount: 1,
      })
    );
  });

  it('returns current exhausted quota without saving a message', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 3,
    });

    const result = await service.getChatQuota(AUTH, CONVERSATION_ID);

    expect(result).toEqual(
      expect.objectContaining({
        isVip: false,
        policy: 'daily',
        limit: 3,
        usedCount: 3,
        remainingCount: 0,
      })
    );
    expect(savedMessages).toHaveLength(0);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('does not apply non-vip chat limits to active vip users', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      memberships: [
        createMembership({
          expiredAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        }),
      ],
      existingUserMessageCount: 99,
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '会员继续聊天',
    });

    expect(savedMessages.some(message => message.role === MessageRole.user)).toBe(true);
    expect(result.chatQuota).toEqual({ isVip: true });
    expect(service.messageModel.count).not.toHaveBeenCalled();
    expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
  });

  it('does not generate an assistant reply when the user explicitly asks not to reply', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '你不要回复了',
    });
    const assistantMessage = savedMessages.find(
      message => message.role === MessageRole.assistant
    );

    expect(result.assistantMessage).toBeUndefined();
    expect(assistantMessage).toBeUndefined();
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
    expect(service.agentContextService.buildConversationContext).not.toHaveBeenCalled();
    expect(result.userMessage.content).toBe('你不要回复了');
  });

  it('does not reply when the stop-reply request includes filler words and role names', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '嗯 你别回我了 妈妈',
    });

    expect(result.assistantMessage).toBeUndefined();
    expect(
      savedMessages.some(message => message.role === MessageRole.assistant)
    ).toBe(false);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('falls back to text when a voice message agent has no voice timbre', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    const result = await service.sendMessage(
      AUTH,
      CONVERSATION_ID,
      {
        type: 'voice',
        objectKey: 'conversation-voice/input.m4a',
        mimeType: 'audio/mp4',
      }
    );
    const assistantMessage = savedMessages.find(
      message => message.role === MessageRole.assistant
    );
    const userMessage = savedMessages.find(
      message => message.role === MessageRole.user
    );

    expect(userMessage).toEqual(
      expect.objectContaining({
        userId: new MongoObjectId(USER_ID),
        agentId: new MongoObjectId(AGENT_ID),
      })
    );
    expect(assistantMessage).toEqual(
      expect.objectContaining({
        userId: new MongoObjectId(USER_ID),
        agentId: new MongoObjectId(AGENT_ID),
        type: MessageType.text,
        content: '我也想你</fenge>今天过得怎么样？',
        status: MessageStatus.sent,
      })
    );
    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(service.openAIService.createTextToSpeech).not.toHaveBeenCalled();
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.2,
        topP: 0.8,
      })
    );
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
        objectKey: 'conversation-voice/input.m4a',
        mimeType: 'audio/mp4',
      }
    );
    const assistantMessage = savedMessages.find(
      message => message.role === MessageRole.assistant
    );

    expect(service.minimaxVoiceSpeechService.synthesize).toHaveBeenCalledWith({
      text: '我也想你。今天过得怎么样？',
      voiceId: 'TzlVoice_001',
      model: 'speech-2.8-turbo',
      languageBoost: 'Chinese',
      speed: 1.12,
      volume: 1.1,
      pitch: -1,
    });
    expect(assistantMessage).toEqual(
      expect.objectContaining({
        type: MessageType.voice,
        content: '我也想你</fenge>今天过得怎么样？',
        mediaObjectKey: 'conversation-voice-replies/reply.mp3',
        mediaUrl: '',
        mediaMimeType: 'audio/mpeg',
        mediaTranscript: '我也想你。今天过得怎么样？',
      })
    );
    expect(service.tencentCosService.putBuffer).toHaveBeenCalledWith(
      Buffer.from([0xff, 0xfb, 0x90, 0x64]),
      {
        folder: 'conversation-voice-replies',
        fileName: expect.stringMatching(/^assistant_reply_\d+\.mp3$/),
        contentType: 'audio/mpeg',
      }
    );
    expect(service.openAIService.createTextToSpeech).not.toHaveBeenCalled();
    expect(result.assistantMessage?.type).toBe(MessageType.voice);
  });

  it('strips malformed assistant markup tags before saving replies', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: [
          '啊 小米 真好听的名字🐱</fense>有小猫陪着你',
          '我都记着呢</emoji>',
        ],
      }),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '你还记得我的猫叫啥吗',
    });

    const assistantMessage = savedMessages.find(
      message => message.role === MessageRole.assistant
    );

    expect(assistantMessage?.content).toBe(
      '啊 小米 真好听的名字🐱 有小猫陪着你</fenge>我都记着呢'
    );
  });

  it('filters legacy media url segments before saving assistant replies', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: [
          '早安媳妇儿',
          'https://zk.yaoxuankeji.club:8199/images/aiDeceased/b9a71d6a9e144fbca8d99ba89a6ec036.mp3 1',
          '新的一天',
          'images/aiDeceased/9ec41cd4123f45079066c5e6576796ef.mp3 1',
        ],
      }),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '老公，早安！',
    });

    const assistantMessage = savedMessages.find(
      message => message.role === MessageRole.assistant
    );

    expect(assistantMessage?.content).toBe('早安媳妇儿</fenge>新的一天');
    expect(assistantMessage?.content).not.toContain('http');
    expect(assistantMessage?.content).not.toContain('aiDeceased');
    expect(assistantMessage?.content).not.toContain('.mp3');
  });
});

describe('ConversationService listConversations', () => {
  it('pins the default agent conversation before newer conversations', async () => {
    const defaultAgentId = new MongoObjectId(AGENT_ID);
    const otherAgentId = new MongoObjectId(OTHER_AGENT_ID);
    const defaultConversation = createConversation({
      id: new MongoObjectId('665000000000000000000021'),
      agentId: defaultAgentId,
      updatedAt: new Date('2026-05-03T08:00:00.000Z'),
    });
    const newerConversation = createConversation({
      id: new MongoObjectId('665000000000000000000022'),
      agentId: otherAgentId,
      updatedAt: new Date('2026-05-04T08:00:00.000Z'),
    });
    const defaultAgent = createAgent({
      id: defaultAgentId,
      name: '默认亲友',
      isDefault: true,
    });
    const otherAgent = createAgent({
      id: otherAgentId,
      name: '普通亲友',
      isDefault: false,
    });
    const service = new ConversationService();

    service.conversationModel = {
      find: jest.fn().mockResolvedValue([newerConversation, defaultConversation]),
    } as any;
    service.agentModel = {
      findOne: jest.fn(async ({ where }: any) => {
        const id = where?.id ?? where?._id;

        if (sameObjectId(id, defaultAgent.id)) {
          return defaultAgent;
        }

        if (sameObjectId(id, otherAgent.id)) {
          return otherAgent;
        }

        return null;
      }),
    } as any;
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(null),
    } as any;
    service.postImageService = {
      resolveForResponse: jest.fn((value: string) => value),
    } as any;

    const result = await service.listConversations(AUTH);

    expect(result.map(item => item.agentId)).toEqual([
      defaultAgentId.toHexString(),
      otherAgentId.toHexString(),
    ]);
    expect(result[0]).toEqual(
      expect.objectContaining({
        agentName: '默认亲友',
        agentIsDefault: true,
      })
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        agentName: '普通亲友',
        agentIsDefault: false,
      })
    );
  });
});
