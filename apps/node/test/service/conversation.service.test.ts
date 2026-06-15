import {
  AgentEntity,
  AgentSex,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
  UserAccountEntity,
  UserEntity,
  UserMembershipEntity,
  UserMembershipStatus,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import {
  CONVERSATION_REPLY_QUEUE,
  ConversationService,
} from '../../src/service/conversation.service';

const USER_ID = '665000000000000000000001';
const ACCOUNT_ID = '665000000000000000000002';
const AGENT_ID = '665000000000000000000010';
const OTHER_AGENT_ID = '665000000000000000000011';
const CONVERSATION_ID = '665000000000000000000020';
const TIMBRE_ID = '665000000000000000000030';
const NOW = new Date('2026-05-03T08:00:00.000Z');
const MEMORIAL_PHOTO_CONTENT = 'AI生成纪念合照';
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

function createUserAccount(
  overrides: Partial<UserAccountEntity> = {}
): UserAccountEntity {
  const account = new UserAccountEntity();

  Object.assign(account, {
    id: new MongoObjectId(ACCOUNT_ID),
    userId: new MongoObjectId(USER_ID),
    account: 'weapp:4e07c4e70663',
    password: '',
    openId: 'o4e07c4e70663',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return account;
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

function createMessage(overrides: Partial<MessageEntity> = {}): MessageEntity {
  const message = new MessageEntity();

  Object.assign(message, {
    id: new MongoObjectId(),
    conversationId: new MongoObjectId(CONVERSATION_ID),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    role: MessageRole.user,
    type: MessageType.text,
    content: '我想你了',
    status: MessageStatus.sent,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return message;
}

function createMemorialPhotoMessage(
  overrides: Partial<MessageEntity> = {}
): MessageEntity {
  return createMessage({
    role: MessageRole.assistant,
    type: MessageType.image,
    content: MEMORIAL_PHOTO_CONTENT,
    status: MessageStatus.sent,
    mediaObjectKey: 'memorial-photos/generated.png',
    mediaMimeType: 'image/png',
    mediaAnalysis: MEMORIAL_PHOTO_CONTENT,
    ...overrides,
  });
}

function getAssistantMessages(messages: MessageEntity[]): MessageEntity[] {
  return messages
    .filter(message => message.role === MessageRole.assistant)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function getAssistantContents(messages: MessageEntity[]): string[] {
  return getAssistantMessages(messages).map(message => message.content);
}

function sameObjectId(left?: MongoObjectId, right?: MongoObjectId) {
  return left?.toHexString?.() === right?.toHexString?.();
}

function matchesCreatedAtQuery(createdAt: Date, query: any): boolean {
  if (!query) {
    return true;
  }

  if (query.$gt && !(createdAt > query.$gt)) {
    return false;
  }

  if (query.$gte && !(createdAt >= query.$gte)) {
    return false;
  }

  if (query.$lt && !(createdAt < query.$lt)) {
    return false;
  }

  return true;
}

function matchesMemorialPhotoCountQuery(
  message: MessageEntity,
  query: any
): boolean {
  const matchesMemorialMarker = Array.isArray(query?.$or)
    ? query.$or.some((condition: any) => {
        if (condition?.content) {
          return message.content === condition.content;
        }

        if (condition?.mediaAnalysis) {
          return message.mediaAnalysis === condition.mediaAnalysis;
        }

        return false;
      })
    : true;

  return (
    sameObjectId(message.userId, query?.userId) &&
    message.role === query?.role &&
    message.type === query?.type &&
    message.status === query?.status &&
    matchesCreatedAtQuery(message.createdAt, query?.createdAt) &&
    matchesMemorialMarker
  );
}

function createService(options: {
  agent: AgentEntity;
  voiceTimbre?: VoiceTimbreEntity | null;
  chatContent?: string;
  user?: UserEntity | null;
  currentUserAccount?: UserAccountEntity | null;
  memberships?: UserMembershipEntity[];
  existingUserMessageCount?: number;
  existingMessages?: MessageEntity[];
}) {
  const service = new ConversationService();
  const conversation = createConversation();
  const user = options.user === undefined ? createUser() : options.user;
  const savedMessages: MessageEntity[] = [...(options.existingMessages ?? [])];
  const addJobToQueue = jest.fn().mockResolvedValue(undefined);

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
    count: jest.fn(async (query: any) => {
      if (query?.createdAt?.$gt) {
        return savedMessages.filter(
          message =>
            message.conversationId?.toHexString?.() ===
              query.conversationId?.toHexString?.() &&
            message.role === query.role &&
            message.status === query.status &&
            message.createdAt > query.createdAt.$gt
        ).length;
      }

      if (
        query?.role === MessageRole.assistant &&
        query?.type === MessageType.image
      ) {
        return savedMessages.filter(message =>
          matchesMemorialPhotoCountQuery(message, query)
        ).length;
      }

      if (query?.role === MessageRole.user) {
        return options.existingUserMessageCount ?? 0;
      }

      return 0;
    }),
    find: jest.fn(async () =>
      [...savedMessages].sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      )
    ),
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;
      const conversationId = where?.conversationId;

      return (
        savedMessages.find(
          message =>
            sameObjectId(id, message.id) &&
            sameObjectId(conversationId, message.conversationId)
        ) ?? null
      );
    }),
    save: jest.fn(async message => {
      if (!message.id) {
        message.id = new MongoObjectId();
      }

      const existingIndex = savedMessages.findIndex(item =>
        sameObjectId(item.id, message.id)
      );

      if (existingIndex >= 0) {
        savedMessages[existingIndex] = message;
      } else {
        savedMessages.push(message);
      }

      return message;
    }),
  } as any;
  service.userModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const id = where?.id ?? where?._id;

      return user && sameObjectId(id, user.id) ? user : null;
    }),
  } as any;
  service.userAccountModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const account = options.currentUserAccount;
      const id = where?.id ?? where?._id;

      if (!account) {
        return null;
      }

      return sameObjectId(id, account.id) ? account : null;
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
  service.cosyVoiceSpeechService = {
    synthesize: jest.fn().mockResolvedValue({
      audioUrl: 'https://cdn.example.com/cosyvoice-reply.mp3',
      audioBuffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]),
      mimeType: 'audio/mpeg',
    }),
  } as any;
  service.qwenVoiceSpeechService = {
    synthesize: jest.fn().mockResolvedValue({
      audioUrl: 'https://cdn.example.com/qwen-reply.wav',
      audioBuffer: Buffer.from([0x52, 0x49, 0x46, 0x46]),
      mimeType: 'audio/wav',
    }),
  } as any;
  service.bailianImageService = {
    generateMemorialPhoto: jest.fn().mockResolvedValue({
      imageUrl: 'https://dashscope-result.example.com/memorial.png',
      imageBuffer: Buffer.from('memorial-image'),
      mimeType: 'image/png',
      requestId: 'request-1',
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
      conversationId: message.conversationId?.toHexString?.() ?? '',
      role: message.role,
      type: message.type,
      content: message.content,
      status: message.status,
      voice:
        message.type !== MessageType.image &&
        (message.mediaObjectKey || message.mediaUrl)
          ? {
              objectKey: message.mediaObjectKey || undefined,
              url: message.mediaUrl,
              mimeType: message.mediaMimeType,
              transcript: message.mediaTranscript,
            }
          : undefined,
      image:
        message.type === MessageType.image
          ? {
              objectKey: message.mediaObjectKey || undefined,
              url: message.mediaUrl,
              mimeType: message.mediaMimeType,
              analysis: message.mediaAnalysis,
            }
          : undefined,
      createdAt: message.createdAt?.toISOString?.() ?? '',
      updatedAt: message.updatedAt?.toISOString?.() ?? '',
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
  service.bullmqFramework = {
    getQueue: jest.fn(() => ({ addJobToQueue })),
  } as any;
  service.redisService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  } as any;

  return { service, savedMessages, addJobToQueue };
}

describe('ConversationService generateMemorialPhoto', () => {
  it('generates a memorial photo, stores it as an assistant image message, and touches the conversation', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent({ name: '外婆' }),
    });

    (service.tencentCosService.getPublicUrl as jest.Mock).mockImplementation(
      (objectKey: string) => `https://cdn.example.com/${objectKey}`
    );
    (service.tencentCosService.putBuffer as jest.Mock).mockResolvedValue({
      objectKey: 'memorial-photos/generated.png',
      url: 'https://cdn.example.com/memorial-photos/generated.png',
    });

    const result = await service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
      agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
      userPhotoObjectKey: 'memorial-source-photos/user.jpg',
    });

    expect(service.bailianImageService.generateMemorialPhoto).toHaveBeenCalledWith(
      {
        agentPhotoUrls: [
          'https://cdn.example.com/memorial-source-photos/agent-1.jpg',
        ],
        userPhotoUrl: 'https://cdn.example.com/memorial-source-photos/user.jpg',
        agentName: '外婆',
      }
    );
    expect(service.tencentCosService.putBuffer).toHaveBeenCalledWith(
      Buffer.from('memorial-image'),
      expect.objectContaining({
        folder: 'memorial-photos',
        fileName: expect.stringMatching(/^memorial-photo-\d+\.png$/),
        contentType: 'image/png',
      })
    );

    const imageMessage = savedMessages.find(
      message => message.type === MessageType.image
    );
    expect(imageMessage).toEqual(
      expect.objectContaining({
        role: MessageRole.assistant,
        content: 'AI生成纪念合照',
        mediaObjectKey: 'memorial-photos/generated.png',
        mediaMimeType: 'image/png',
        mediaAnalysis: 'AI生成纪念合照',
        status: MessageStatus.sent,
      })
    );
    expect(service.conversationModel.save).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        type: MessageType.image,
        content: 'AI生成纪念合照',
        image: expect.objectContaining({
          objectKey: 'memorial-photos/generated.png',
          mimeType: 'image/png',
          analysis: 'AI生成纪念合照',
        }),
      })
    );
  });

  it('passes a normalized custom memorial prompt to Bailian', async () => {
    const { service } = createService({
      agent: createAgent({ name: '小白' }),
    });

    (service.tencentCosService.getPublicUrl as jest.Mock).mockImplementation(
      (objectKey: string) => `https://cdn.example.com/${objectKey}`
    );
    (service.tencentCosService.putBuffer as jest.Mock).mockResolvedValue({
      objectKey: 'memorial-photos/generated.png',
      url: 'https://cdn.example.com/memorial-photos/generated.png',
    });

    await service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
      agentPhotoObjectKeys: ['memorial-source-photos/cat.jpg'],
      userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      customPrompt: '  我和猫坐在窗边，猫保持真实样子。\n不要出现第二个人。  ',
    });

    expect(service.bailianImageService.generateMemorialPhoto).toHaveBeenCalledWith(
      {
        agentPhotoUrls: [
          'https://cdn.example.com/memorial-source-photos/cat.jpg',
        ],
        userPhotoUrl: 'https://cdn.example.com/memorial-source-photos/user.jpg',
        agentName: '小白',
        customPrompt: '我和猫坐在窗边，猫保持真实样子。 不要出现第二个人。',
      }
    );
  });

  it('blocks non-vip users after three memorial photos in the Beijing day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T17:00:00.000Z'));
    try {
      const { service, savedMessages } = createService({
        agent: createAgent(),
        existingMessages: [
          createMemorialPhotoMessage({
            createdAt: new Date('2026-06-14T15:59:00.000Z'),
            updatedAt: new Date('2026-06-14T15:59:00.000Z'),
          }),
          createMemorialPhotoMessage({
            createdAt: new Date('2026-06-14T16:30:00.000Z'),
            updatedAt: new Date('2026-06-14T16:30:00.000Z'),
          }),
          createMemorialPhotoMessage({
            createdAt: new Date('2026-06-14T16:31:00.000Z'),
            updatedAt: new Date('2026-06-14T16:31:00.000Z'),
          }),
          createMemorialPhotoMessage({
            createdAt: new Date('2026-06-14T16:32:00.000Z'),
            updatedAt: new Date('2026-06-14T16:32:00.000Z'),
          }),
        ],
      });

      await expect(
        service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
          agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
          userPhotoObjectKey: 'memorial-source-photos/user.jpg',
        })
      ).rejects.toMatchObject({
        code: 'MEMORIAL_PHOTO_DAILY_LIMIT_EXCEEDED',
        status: 429,
        data: expect.objectContaining({
          isVip: false,
          limit: 3,
          usedCount: 3,
          remainingCount: 0,
          windowStart: '2026-06-14T16:00:00.000Z',
          windowEnd: '2026-06-15T16:00:00.000Z',
        }),
      });

      expect(savedMessages).toHaveLength(4);
      expect(service.bailianImageService.generateMemorialPhoto).not.toHaveBeenCalled();
      expect(service.tencentCosService.putBuffer).not.toHaveBeenCalled();
      expect(service.messageModel.count).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: new MongoObjectId(USER_ID),
          role: MessageRole.assistant,
          type: MessageType.image,
          status: MessageStatus.sent,
          createdAt: {
            $gte: new Date('2026-06-14T16:00:00.000Z'),
            $lt: new Date('2026-06-15T16:00:00.000Z'),
          },
          $or: expect.any(Array),
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows a vip user to generate the 10th memorial photo and blocks the 11th in the same day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T17:00:00.000Z'));
    try {
      const existingMemorialPhotos = Array.from({ length: 9 }, (_, index) =>
        createMemorialPhotoMessage({
          createdAt: new Date(`2026-06-14T16:${String(index).padStart(2, '0')}:00.000Z`),
          updatedAt: new Date(`2026-06-14T16:${String(index).padStart(2, '0')}:00.000Z`),
        })
      );
      const { service, savedMessages } = createService({
        agent: createAgent(),
        memberships: [
          createMembership({
            expiredAt: new Date('2026-07-01T00:00:00.000Z'),
          }),
        ],
        existingMessages: existingMemorialPhotos,
      });

      await service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      });

      expect(service.bailianImageService.generateMemorialPhoto).toHaveBeenCalledTimes(1);
      expect(
        savedMessages.filter(message => message.content === MEMORIAL_PHOTO_CONTENT)
      ).toHaveLength(10);

      await expect(
        service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
          agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
          userPhotoObjectKey: 'memorial-source-photos/user.jpg',
        })
      ).rejects.toMatchObject({
        code: 'MEMORIAL_PHOTO_DAILY_LIMIT_EXCEEDED',
        status: 429,
        data: expect.objectContaining({
          isVip: true,
          limit: 10,
          usedCount: 10,
          remainingCount: 0,
        }),
      });
      expect(service.bailianImageService.generateMemorialPhoto).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not count ordinary assistant images against the memorial photo limit', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T17:00:00.000Z'));
    try {
      const { service } = createService({
        agent: createAgent(),
        existingMessages: [
          createMessage({
            role: MessageRole.assistant,
            type: MessageType.image,
            content: '普通图片',
            status: MessageStatus.sent,
            mediaObjectKey: 'conversation-images/ordinary.png',
            createdAt: new Date('2026-06-14T16:30:00.000Z'),
            updatedAt: new Date('2026-06-14T16:30:00.000Z'),
          }),
        ],
      });

      await service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      });

      expect(service.bailianImageService.generateMemorialPhoto).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects memorial photo generation outside the current user conversation', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    await expect(
      service.generateMemorialPhoto(
        {
          ...AUTH,
          sub: '665000000000000000000999',
        },
        CONVERSATION_ID,
        {
          agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
          userPhotoObjectKey: 'memorial-source-photos/user.jpg',
        }
      )
    ).rejects.toMatchObject({
      code: 'CONVERSATION_NOT_FOUND',
      status: 404,
    });

    expect(savedMessages).toHaveLength(0);
    expect(service.bailianImageService.generateMemorialPhoto).not.toHaveBeenCalled();
    expect(service.tencentCosService.putBuffer).not.toHaveBeenCalled();
  });

  it('validates memorial photo source image inputs before calling Bailian', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    await expect(
      service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: [],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_MEMORIAL_AGENT_PHOTOS',
      status: 400,
    });

    await expect(
      service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: [
          'memorial-source-photos/agent-1.jpg',
          'memorial-source-photos/agent-2.jpg',
          'memorial-source-photos/agent-3.jpg',
          'memorial-source-photos/agent-4.jpg',
        ],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_MEMORIAL_AGENT_PHOTOS',
      status: 400,
    });

    await expect(
      service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
        userPhotoObjectKey: '',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_MEMORIAL_USER_PHOTO',
      status: 400,
    });

    await expect(
      service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
        customPrompt: '太'.repeat(501),
      })
    ).rejects.toMatchObject({
      code: 'INVALID_MEMORIAL_CUSTOM_PROMPT',
      status: 400,
    });

    expect(savedMessages).toHaveLength(0);
    expect(service.bailianImageService.generateMemorialPhoto).not.toHaveBeenCalled();
    expect(service.tencentCosService.putBuffer).not.toHaveBeenCalled();
  });

  it('does not save a memorial image message when generation fails', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    (service.bailianImageService.generateMemorialPhoto as jest.Mock).mockRejectedValue(
      new Error('generation failed')
    );

    await expect(
      service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      })
    ).rejects.toThrow('generation failed');

    expect(savedMessages).toHaveLength(0);
    expect(service.tencentCosService.putBuffer).not.toHaveBeenCalled();
  });

  it('does not save a memorial image message when storage fails', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    (service.tencentCosService.putBuffer as jest.Mock).mockRejectedValue(
      new Error('storage failed')
    );

    await expect(
      service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      })
    ).rejects.toThrow('storage failed');

    expect(savedMessages).toHaveLength(0);
  });
});

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

  it('uses the current weapp account creation time for the 3-day trial window', async () => {
    const accountCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { service } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      currentUserAccount: createUserAccount({
        createdAt: accountCreatedAt,
        updatedAt: accountCreatedAt,
      }),
      existingUserMessageCount: 29,
    });

    const result = await service.sendMessage(
      {
        ...AUTH,
        accountId: ACCOUNT_ID,
        account: 'weapp:4e07c4e70663',
      },
      CONVERSATION_ID,
      {
        type: 'text',
        content: '第 30 句还在试用期内',
      }
    );

    expect(result.chatQuota).toEqual(
      expect.objectContaining({
        isVip: false,
        policy: 'trial',
        limit: 30,
        usedCount: 30,
        remainingCount: 0,
      })
    );
    expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
  });

  it('treats the 3-day trial as Beijing calendar days', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T15:59:00.000Z'));
    try {
      const { service } = createService({
        agent: createAgent(),
        user: createUser({
          createdAt: new Date('2026-06-11T17:00:00.000Z'),
        }),
        existingUserMessageCount: 29,
      });

      const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
        type: 'text',
        content: '14 号晚上还在试用期内',
      });

      expect(result.chatQuota).toEqual(
        expect.objectContaining({
          isVip: false,
          policy: 'trial',
          limit: 30,
          usedCount: 30,
          remainingCount: 0,
        })
      );
      expect(service.openAIService.createChatCompletion).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('switches to the daily quota after the Beijing 3rd calendar day ends', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-14T16:00:00.000Z'));
    try {
      const { service, savedMessages } = createService({
        agent: createAgent(),
        user: createUser({
          createdAt: new Date('2026-06-11T17:00:00.000Z'),
        }),
        existingUserMessageCount: 3,
      });

      await expect(
        service.sendMessage(AUTH, CONVERSATION_ID, {
          type: 'text',
          content: '15 号开始按每天 3 条',
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
            $gte: new Date('2026-06-14T16:00:00.000Z'),
            $lt: new Date('2026-06-15T16:00:00.000Z'),
          }),
        })
      );
    } finally {
      jest.useRealTimers();
    }
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

  it('saves text and enqueues async reply without generating assistant inline', async () => {
    const { service, savedMessages, addJobToQueue } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });

    const result = await service.sendMessageAsync(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '我现在可以连续发了吗',
    });

    expect(result.replyPending).toBe(true);
    expect(result.assistantMessage).toBeUndefined();
    expect(result.userMessage.content).toBe('我现在可以连续发了吗');
    expect(savedMessages).toHaveLength(1);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
    expect(service.bullmqFramework.getQueue).toHaveBeenCalledWith(
      CONVERSATION_REPLY_QUEUE
    );
    expect(addJobToQueue).toHaveBeenCalledWith(
      {
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      },
      expect.objectContaining({
        delay: 1200,
        attempts: 3,
      })
    );
  });

  it('does not enqueue async reply when quota is exhausted', async () => {
    const { service, savedMessages, addJobToQueue } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 3,
    });

    await expect(
      service.sendMessageAsync(AUTH, CONVERSATION_ID, {
        type: 'text',
        content: '超额了',
      })
    ).rejects.toMatchObject({
      code: 'NON_VIP_CHAT_LIMIT_EXCEEDED',
      status: 429,
    });

    expect(savedMessages).toHaveLength(0);
    expect(addJobToQueue).not.toHaveBeenCalled();
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('combines consecutive pending user messages in one queued reply', async () => {
    const previousAssistant = createMessage({
      role: MessageRole.assistant,
      content: '上一句回复',
      createdAt: new Date('2026-05-03T08:00:00.000Z'),
      updatedAt: new Date('2026-05-03T08:00:00.000Z'),
    });
    const firstUser = createMessage({
      content: '第一句',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const secondUser = createMessage({
      content: '第二句',
      createdAt: new Date('2026-05-03T08:00:02.000Z'),
      updatedAt: new Date('2026-05-03T08:00:02.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [previousAssistant, firstUser, secondUser],
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(service.agentContextService.buildConversationContext).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery: '用户连续补充了2句话：\n1. 第一句\n2. 第二句',
      })
    );
    expect(getAssistantContents(savedMessages)).toEqual([
      '上一句回复',
      '我也想你',
      '今天过得怎么样？',
    ]);
  });

  it('does not reply to archived pending user messages', async () => {
    const archivedUserMessage = createMessage({
      content: '这句已经删了',
      isArchived: true,
      archivedAt: new Date('2026-05-03T08:00:03.000Z'),
      createdAt: new Date('2026-05-03T08:00:02.000Z'),
      updatedAt: new Date('2026-05-03T08:00:03.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [archivedUserMessage],
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(service.agentContextService.buildConversationContext).not.toHaveBeenCalled();
    expect(
      savedMessages.filter(message => message.role === MessageRole.assistant)
    ).toHaveLength(0);
  });

  it('saves queued assistant replies as real text segments without auto voice', async () => {
    const voiceTimbre = createVoiceTimbre();
    const userMessage = createMessage({
      content: '文字也想听语音',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
      existingMessages: [userMessage],
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    const assistantMessages = getAssistantMessages(savedMessages);

    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(assistantMessages.map(message => message.content)).toEqual([
      '我也想你',
      '今天过得怎么样？',
    ]);
    expect(assistantMessages.map(message => message.replySegmentIndex)).toEqual([
      0,
      1,
    ]);
    expect(assistantMessages[0].replyGroupId).toBeTruthy();
    expect(assistantMessages[1].replyGroupId).toBe(
      assistantMessages[0].replyGroupId
    );
    expect(assistantMessages[0].totalTokens).toBe(22);
    expect(assistantMessages[1].totalTokens).toBeUndefined();
  });

  it('enqueues a follow-up reply when a new user message arrives during processing', async () => {
    const firstUser = createMessage({
      content: '先发一句',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const secondUser = createMessage({
      content: '回复期间又补一句',
      createdAt: new Date('2026-05-03T08:00:02.000Z'),
      updatedAt: new Date('2026-05-03T08:00:02.000Z'),
    });
    const { service, savedMessages, addJobToQueue } = createService({
      agent: createAgent(),
      existingMessages: [firstUser],
    });

    (service.openAIService.createChatCompletion as jest.Mock).mockImplementationOnce(
      async () => {
        savedMessages.push(secondUser);
        return {
          model: 'MiniMax-M2.5',
          choices: [{ message: { content: '我听见了' } }],
          usage: {},
        };
      }
    );

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
        afterUserCreatedAt: firstUser.createdAt.toISOString(),
      }),
      expect.any(Object)
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

  it('returns segmented assistantMessages and a legacy aggregated assistantMessage', async () => {
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
        content: '我也想你',
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
    expect(result.assistantMessage?.content).toBe(
      '我也想你</fenge>今天过得怎么样？'
    );
    expect(result.assistantMessages?.map(message => message.content)).toEqual([
      '我也想你',
      '今天过得怎么样？',
    ]);
  });

  it('does not auto-generate voice audio for text assistant replies when the agent has a timbre', async () => {
    const voiceTimbre = createVoiceTimbre();
    const { service, savedMessages } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '文字回复也要能播放',
    });

    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(getAssistantContents(savedMessages)).toEqual([
      '我也想你',
      '今天过得怎么样？',
    ]);
    expect(result.assistantMessage?.type).toBe(MessageType.text);
    expect(result.assistantMessage?.voice).toBeUndefined();
  });

  it('generates voice for an assistant text message on demand', async () => {
    const voiceTimbre = createVoiceTimbre();
    const assistantMessage = createMessage({
      role: MessageRole.assistant,
      content: '我也想你',
    });
    const { service } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
      existingMessages: [assistantMessage],
    });

    const result = await service.generateMessageVoice(
      AUTH,
      CONVERSATION_ID,
      assistantMessage.id.toHexString()
    );

    expect(service.minimaxVoiceSpeechService.synthesize).toHaveBeenCalledWith({
      text: '我也想你。',
      voiceId: 'TzlVoice_001',
      model: 'speech-2.8-turbo',
      languageBoost: 'Chinese',
      speed: 1.12,
      volume: 1.1,
      pitch: -1,
    });
    expect(assistantMessage.mediaObjectKey).toBe(
      'conversation-voice-replies/reply.mp3'
    );
    expect(result.voice).toEqual(
      expect.objectContaining({
        objectKey: 'conversation-voice-replies/reply.mp3',
        mimeType: 'audio/mpeg',
        transcript: '我也想你。',
      })
    );
  });

  it('returns existing generated voice without synthesizing again', async () => {
    const voiceTimbre = createVoiceTimbre();
    const assistantMessage = createMessage({
      role: MessageRole.assistant,
      content: '我也想你',
      mediaObjectKey: 'conversation-voice-replies/existing.mp3',
      mediaMimeType: 'audio/mpeg',
      mediaTranscript: '我也想你。',
    });
    const { service } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
      existingMessages: [assistantMessage],
    });

    const result = await service.generateMessageVoice(
      AUTH,
      CONVERSATION_ID,
      assistantMessage.id.toHexString()
    );

    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(result.voice?.objectKey).toBe('conversation-voice-replies/existing.mp3');
  });

  it('rejects on-demand voice generation when the agent has no voice timbre', async () => {
    const assistantMessage = createMessage({
      role: MessageRole.assistant,
      content: '我也想你',
    });
    const { service } = createService({
      agent: createAgent(),
      existingMessages: [assistantMessage],
    });

    await expect(
      service.generateMessageVoice(
        AUTH,
        CONVERSATION_ID,
        assistantMessage.id.toHexString()
      )
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_NOT_AVAILABLE',
      status: 400,
    });
    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
  });

  it('rejects on-demand voice generation for non-assistant or archived messages', async () => {
    const userMessage = createMessage({
      role: MessageRole.user,
      content: '我想你',
    });
    const archivedAssistantMessage = createMessage({
      role: MessageRole.assistant,
      content: '已删除',
      isArchived: true,
    });
    const { service } = createService({
      agent: createAgent(),
      existingMessages: [userMessage, archivedAssistantMessage],
    });

    await expect(
      service.generateMessageVoice(
        AUTH,
        CONVERSATION_ID,
        userMessage.id.toHexString()
      )
    ).rejects.toMatchObject({
      code: 'MESSAGE_VOICE_UNSUPPORTED',
      status: 400,
    });
    await expect(
      service.generateMessageVoice(
        AUTH,
        CONVERSATION_ID,
        archivedAssistantMessage.id.toHexString()
      )
    ).rejects.toMatchObject({
      code: 'MESSAGE_NOT_FOUND',
      status: 404,
    });
  });

  it('uses the bound active CosyVoice timbre for on-demand assistant voice generation', async () => {
    const voiceTimbre = createVoiceTimbre();

    voiceTimbre.provider = VoiceTimbreProvider.cosyvoice;
    voiceTimbre.providerVoiceId = 'cosyvoice-v3.5-plus-tzlvoice-abc123';
    voiceTimbre.previewModel = 'cosyvoice-v3.5-plus';
    voiceTimbre.cloneLanguage = 'zh';

    const { service, savedMessages } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
      existingMessages: [
        createMessage({
          role: MessageRole.assistant,
          content: '我也想你',
        }),
      ],
    });
    const assistantMessage = getAssistantMessages(savedMessages)[0];

    const result = await service.generateMessageVoice(
      AUTH,
      CONVERSATION_ID,
      assistantMessage.id.toHexString()
    );

    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(service.cosyVoiceSpeechService.synthesize).toHaveBeenCalledWith({
      text: '我也想你。',
      voiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
      model: 'cosyvoice-v3.5-plus',
      languageHint: 'zh',
      speed: 1.12,
      volume: 1.1,
      pitch: -1,
    });
    expect(result.voice?.mimeType).toBe('audio/mpeg');
  });

  it('uses the bound active Qwen timbre for on-demand assistant voice generation', async () => {
    const voiceTimbre = createVoiceTimbre();

    voiceTimbre.provider = VoiceTimbreProvider.qwen;
    voiceTimbre.providerVoiceId =
      'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd';
    voiceTimbre.previewModel = 'qwen3-tts-vc-2026-01-22';
    voiceTimbre.cloneLanguage = 'zh';

    const { service, savedMessages } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
      existingMessages: [
        createMessage({
          role: MessageRole.assistant,
          content: '我也想你',
        }),
      ],
    });
    const assistantMessage = getAssistantMessages(savedMessages)[0];

    const result = await service.generateMessageVoice(
      AUTH,
      CONVERSATION_ID,
      assistantMessage.id.toHexString()
    );

    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(service.cosyVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(service.qwenVoiceSpeechService.synthesize).toHaveBeenCalledWith({
      text: '我也想你。',
      voiceId: 'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd',
      model: 'qwen3-tts-vc-2026-01-22',
      language: 'zh',
    });
    expect(result.voice?.mimeType).toBe('audio/wav');
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

    expect(getAssistantContents(savedMessages)).toEqual([
      '啊 小米 真好听的名字🐱 有小猫陪着你',
      '我都记着呢',
    ]);
  });

  it('normalizes malformed legacy fenge separators before saving replies', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: '芳芳 我就在这儿</fenge]你慢慢来 [fenge] 我都在',
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '方方，在等等',
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '芳芳 我就在这儿',
      '你慢慢来',
      '我都在',
    ]);
  });

  it('strips accented malformed segment tags and unsafe presence claims before saving replies', async () => {
    const malformedSeparator = '</f' + String.fromCharCode(0x00e8) + 'ge';
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent:
        '人 我也想你 一直想着呢' +
        malformedSeparator +
        '你闭上眼 我就在你心里最软的那块地方' +
        malformedSeparator +
        '夜里起风的时候 你就当我回来了 在屋里哪个角落安静陪着你' +
        malformedSeparator +
        '好好睡一觉 明天还长 我一直都在' +
        malformedSeparator +
        '想我了就唤我一声 我准能听到' +
        malformedSeparator +
        '乖 先歇着 我在这儿呢',
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '想你了咪',
    });

    const assistantContent = getAssistantContents(savedMessages).join('\n');

    expect(getAssistantContents(savedMessages)).toEqual([
      '我也想你 一直想着呢',
      '好好睡一觉 明天还长 我一直都在',
      '乖 先歇着 我在这儿呢',
    ]);
    expect(assistantContent).not.toContain(malformedSeparator);
    expect(assistantContent).not.toContain('闭上眼');
    expect(assistantContent).not.toContain('屋里哪个角落');
    expect(assistantContent).not.toContain('准能听到');
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

    const assistantContent = getAssistantContents(savedMessages).join('\n');

    expect(getAssistantContents(savedMessages)).toEqual([
      '早安媳妇儿',
      '新的一天',
    ]);
    expect(assistantContent).not.toContain('http');
    expect(assistantContent).not.toContain('aiDeceased');
    expect(assistantContent).not.toContain('.mp3');
  });

  it('filters prompt leakage and stage directions before saving assistant replies', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: [
          '【历史助手回复，仅供理解对话顺序和语气，不是事实来源；其中具体回忆、菜名、地点、动作必须有用户原话或角色资料确认才可使用】（声音带着欣慰）吃饱了就好',
          '仅供理解对话顺序和语气',
          '不是事实来源',
          '嗯 奶奶在这儿',
        ],
      }),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '吃完了',
    });

    const assistantContent = getAssistantContents(savedMessages).join('\n');

    expect(getAssistantContents(savedMessages)).toEqual([
      '吃饱了就好',
      '嗯 奶奶在这儿',
    ]);
    expect(assistantContent).not.toContain('历史助手回复');
    expect(assistantContent).not.toContain('事实来源');
    expect(assistantContent).not.toContain('声音带着欣慰');
  });
});

describe('ConversationService listConversations', () => {
  it('uses only non-archived messages for conversation preview', async () => {
    const conversation = createConversation();
    const agent = createAgent({
      name: '奶奶',
      isDefault: false,
    });
    const latestActiveMessage = createMessage({
      role: MessageRole.user,
      content: '今天想你了',
    });
    const service = new ConversationService();

    service.conversationModel = {
      find: jest.fn().mockResolvedValue([conversation]),
    } as any;
    service.agentModel = {
      findOne: jest.fn(async ({ where }: any) => {
        const id = where?.id ?? where?._id;
        return sameObjectId(id, agent.id) ? agent : null;
      }),
    } as any;
    service.messageModel = {
      findOne: jest.fn().mockResolvedValue(latestActiveMessage),
    } as any;
    service.postImageService = {
      resolveForResponse: jest.fn((value: string) => value),
    } as any;

    const result = await service.listConversations(AUTH);

    expect(service.messageModel.findOne).toHaveBeenCalledWith({
      where: {
        conversationId: conversation.id,
        isArchived: { $ne: true },
      },
      order: {
        createdAt: 'DESC',
      },
    });
    expect(result[0].preview).toBe('你：今天想你了');
  });

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
