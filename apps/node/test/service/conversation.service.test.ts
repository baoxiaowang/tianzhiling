import {
  AgentEntity,
  AgentShareMemberStatus,
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
import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';
import { ReplyGuardrailService } from '../../src/service/agents/reply-guardrail.service';
import { routeReplyScene } from '../../src/service/agents/reply-scene-router';
import { MessageService } from '../../src/service/message.service';

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
    .sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
    );
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
  queueAvailable?: boolean;
}) {
  const service = new ConversationService();
  const conversation = createConversation();
  const user = options.user === undefined ? createUser() : options.user;
  const savedMessages: MessageEntity[] = [...(options.existingMessages ?? [])];
  const savedFeedbacks: any[] = [];
  const addJobToQueue = jest.fn().mockResolvedValue(undefined);
  const getJob = jest.fn().mockResolvedValue(null);

  service.logger = {
    info: jest.fn(),
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
        if (options.existingUserMessageCount !== undefined) {
          return options.existingUserMessageCount;
        }

        return savedMessages.filter(
          message =>
            sameObjectId(message.userId, query?.userId) &&
            sameObjectId(message.agentId, query?.agentId) &&
            message.role === query.role &&
            message.status === query.status &&
            matchesCreatedAtQuery(message.createdAt, query?.createdAt)
        ).length;
      }

      return 0;
    }),
    find: jest.fn(async () =>
      [...savedMessages].sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
      )
    ),
    findOne: jest.fn(async ({ where }: any) => {
      if (where?.clientRequestId) {
        return (
          savedMessages.find(
            message =>
              message.clientRequestId === where.clientRequestId &&
              message.role === where.role &&
              sameObjectId(message.userId, where.userId) &&
              sameObjectId(message.conversationId, where.conversationId)
          ) ?? null
        );
      }

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
  service.messageFeedbackModel = {
    save: jest.fn(async feedback => {
      if (!feedback.id) {
        feedback.id = new MongoObjectId();
      }
      savedFeedbacks.push(feedback);
      return feedback;
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
    createVisionChatCompletion: jest.fn().mockResolvedValue({
      model: 'qwen-vl-max',
      choices: [
        {
          message: {
            content: '这张合照真温柔，画面里的光也很暖。',
          },
        },
      ],
      usage: {
        prompt_tokens: 18,
        completion_tokens: 14,
        total_tokens: 32,
      },
    }),
    getVisionModel: jest.fn(() => 'qwen-vl-max'),
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
  service.agentEmotionStateService = {
    recognizeAndUpsertFromUserMessage: jest.fn().mockResolvedValue(null),
  } as any;
  service.agentMemoryFactService = {
    extractAndUpsertFromUserMessage: jest.fn().mockResolvedValue([]),
    archiveMatchingFacts: jest.fn().mockResolvedValue(0),
  } as any;
  service.agentProfileFactService = {
    extractAndUpsertFromUserMessage: jest.fn().mockResolvedValue([]),
    archiveMatchingFacts: jest.fn().mockResolvedValue(0),
    listVisualAppearanceMemories: jest.fn().mockResolvedValue([]),
    upsertVisualAppearanceObservations: jest.fn().mockResolvedValue([]),
  } as any;
  service.agentRelationshipSignalService = {
    upsertFromUserMessage: jest.fn().mockResolvedValue([]),
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
    getQueue: jest.fn(() =>
      options.queueAvailable === false ? undefined : { addJobToQueue, getJob }
    ),
  } as any;
  service.redisService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  } as any;

  return { service, savedMessages, savedFeedbacks, addJobToQueue, getJob };
}

describe('ConversationService main-model tools', () => {
  it('executes at most one active tool round before the final reply', async () => {
    const agent = createAgent();
    const { service } = createService({ agent });
    const userMessage = createMessage({
      content: '你还记得我们以前去过哪里吗',
      role: MessageRole.user,
    });
    const createChatCompletion = service.openAIService
      .createChatCompletion as jest.Mock;
    createChatCompletion
      .mockReset()
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.5',
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'search_relationship_memory',
                    arguments: JSON.stringify({
                      missingConcepts: ['共同去过的地方'],
                      subjectRef: '奶奶',
                      limit: 3,
                    }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      })
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.5',
        choices: [
          {
            message: {
              content: '{"segments":["记得，是秋天去的香山。"],"claims":[]}',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 28, completion_tokens: 8, total_tokens: 36 },
      });
    service.agentChatToolService = {
      execute: jest.fn().mockResolvedValue({
        version: 'agent_chat_tools_v1',
        tool: 'search_relationship_memory',
        status: 'ok',
        items: [
          {
            id: 'memory-1',
            source: 'conversation_memory',
            sourceAt: '2025-10-01T00:00:00.000Z',
            confidence: 0.88,
            conflictStatus: 'none',
            value: '秋天去过香山',
          },
        ],
        truncated: false,
      }),
    } as any;

    const result = await (service as any).createPrimaryAssistantCompletion({
      runtime: {
        auth: AUTH,
        conversation: createConversation(),
        agent,
      },
      before: {
        userMessage,
        searchableText: userMessage.content,
      },
      context: {
        messages: [{ role: 'user', content: userMessage.content }],
        chatToolPlan: {
          version: 'agent_chat_tools_v1',
          configuredMode: 'active',
          mode: 'active',
          eligible: true,
          sampled: true,
          availableTools: [
            'search_relationship_memory',
            'get_family_facts',
            'get_persona_evidence',
            'record_user_correction',
          ],
          reason: 'memory_candidate',
          plannerMemoryRequested: true,
          maxCalls: 4,
          timeoutMs: 1000,
        },
      },
    });

    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(createChatCompletion.mock.calls[0][0].tools).toHaveLength(4);
    expect(createChatCompletion.mock.calls[1][0].tool_choice).toBe('none');
    expect(createChatCompletion.mock.calls[1][0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call-1',
        }),
      ])
    );
    expect(result.toolAudit).toEqual(
      expect.objectContaining({
        decisionNames: ['search_relationship_memory'],
        executionCount: 1,
        resultItemCount: 1,
        plannerMemoryAgreement: 'both_query',
      })
    );
    expect(result.toolEvidence).toEqual([
      expect.objectContaining({
        id: 'memory-1',
        source: 'retrieved_user',
        assertionPolicy: 'context_only',
        useMode: 'recall',
      }),
    ]);
    expect(result.usage.totalTokens).toBe(61);
  });
});

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
      clientRequestId: 'memorial-request-1',
    });

    expect(
      service.bailianImageService.generateMemorialPhoto
    ).toHaveBeenCalledWith({
      agentPhotoUrls: [
        'https://cdn.example.com/memorial-source-photos/agent-1.jpg',
      ],
      userPhotoUrl: 'https://cdn.example.com/memorial-source-photos/user.jpg',
      agentName: '外婆',
    });
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
        clientRequestId: 'memorial-request-1',
        status: MessageStatus.sent,
      })
    );
    const assistantMessages = getAssistantMessages(savedMessages);
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]).toEqual(imageMessage);
    expect(assistantMessages[1]).toEqual(
      expect.objectContaining({
        role: MessageRole.assistant,
        type: MessageType.text,
        content: '这张合照真温柔，画面里的光也很暖',
        model: 'qwen-vl-max',
        promptTokens: 18,
        completionTokens: 14,
        totalTokens: 32,
      })
    );
    expect(assistantMessages[1].createdAt.getTime()).toBe(
      imageMessage!.createdAt.getTime() + 1
    );
    expect(
      service.openAIService.createVisionChatCompletion
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen-vl-max',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content:
              expect.stringContaining('用户刚生成了一张与聊天对象的纪念合照'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image_url',
                image_url: {
                  url: 'https://cdn.example.com/memorial-photos/generated.png',
                },
              }),
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('用户没有填写额外场景提示词'),
              }),
            ]),
          }),
        ]),
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

  it('returns the existing image for a repeated memorial photo request', async () => {
    const existingMessage = createMemorialPhotoMessage({
      clientRequestId: 'memorial-request-existing',
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [existingMessage],
    });

    const result = await service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
      agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
      userPhotoObjectKey: 'memorial-source-photos/user.jpg',
      clientRequestId: 'memorial-request-existing',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: existingMessage.id.toHexString(),
        type: MessageType.image,
      })
    );
    expect(savedMessages).toHaveLength(1);
    expect(
      service.bailianImageService.generateMemorialPhoto
    ).not.toHaveBeenCalled();
    expect(
      service.openAIService.createVisionChatCompletion
    ).not.toHaveBeenCalled();
  });

  it('does not start a second memorial generation while the same request is running', async () => {
    const { service } = createService({ agent: createAgent() });
    (service.redisService.set as jest.Mock).mockResolvedValueOnce(null);

    await expect(
      service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
        agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
        userPhotoObjectKey: 'memorial-source-photos/user.jpg',
        clientRequestId: 'memorial-request-in-progress',
      })
    ).rejects.toMatchObject({
      code: 'MEMORIAL_PHOTO_IN_PROGRESS',
      status: 409,
    });
    expect(
      service.bailianImageService.generateMemorialPhoto
    ).not.toHaveBeenCalled();
  });

  it('keeps different memorial request ids distinct in the lock key', () => {
    const { service } = createService({ agent: createAgent() });
    const getLockKey = (service as any).getMemorialPhotoLockKey.bind(service);

    expect(getLockKey(CONVERSATION_ID, 'request/a')).not.toBe(
      getLockKey(CONVERSATION_ID, 'request?a')
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

    expect(
      service.bailianImageService.generateMemorialPhoto
    ).toHaveBeenCalledWith({
      agentPhotoUrls: [
        'https://cdn.example.com/memorial-source-photos/cat.jpg',
      ],
      userPhotoUrl: 'https://cdn.example.com/memorial-source-photos/user.jpg',
      agentName: '小白',
      customPrompt: '我和猫坐在窗边，猫保持真实样子。 不要出现第二个人。',
    });
    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery:
          '用户刚生成了一张纪念合照，画面提示词：我和猫坐在窗边，猫保持真实样子。 不要出现第二个人。',
      })
    );
    expect(
      service.openAIService.createVisionChatCompletion
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining(
                  '用户生成合照时填写的场景/画面提示词：我和猫坐在窗边，猫保持真实样子。 不要出现第二个人。'
                ),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('keeps the memorial photo result when the proactive assistant reply fails', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    (
      service.openAIService.createVisionChatCompletion as jest.Mock
    ).mockRejectedValue(new Error('vision failed'));

    const result = await service.generateMemorialPhoto(AUTH, CONVERSATION_ID, {
      agentPhotoObjectKeys: ['memorial-source-photos/agent-1.jpg'],
      userPhotoObjectKey: 'memorial-source-photos/user.jpg',
    });

    expect(result).toEqual(
      expect.objectContaining({
        type: MessageType.image,
        content: MEMORIAL_PHOTO_CONTENT,
      })
    );
    expect(
      savedMessages.filter(message => message.type === MessageType.image)
    ).toHaveLength(1);
    expect(
      savedMessages.filter(
        message =>
          message.role === MessageRole.assistant &&
          message.type === MessageType.text
      )
    ).toHaveLength(0);
    expect(service.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('memorial photo assistant reply failed'),
      expect.any(String),
      expect.any(String),
      expect.stringContaining('vision failed')
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
      expect(
        service.bailianImageService.generateMemorialPhoto
      ).not.toHaveBeenCalled();
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
          createdAt: new Date(
            `2026-06-14T16:${String(index).padStart(2, '0')}:00.000Z`
          ),
          updatedAt: new Date(
            `2026-06-14T16:${String(index).padStart(2, '0')}:00.000Z`
          ),
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

      expect(
        service.bailianImageService.generateMemorialPhoto
      ).toHaveBeenCalledTimes(1);
      expect(
        savedMessages.filter(
          message => message.content === MEMORIAL_PHOTO_CONTENT
        )
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
      expect(
        service.bailianImageService.generateMemorialPhoto
      ).toHaveBeenCalledTimes(1);
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

      expect(
        service.bailianImageService.generateMemorialPhoto
      ).toHaveBeenCalled();
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
    expect(
      service.bailianImageService.generateMemorialPhoto
    ).not.toHaveBeenCalled();
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
    expect(
      service.bailianImageService.generateMemorialPhoto
    ).not.toHaveBeenCalled();
    expect(service.tencentCosService.putBuffer).not.toHaveBeenCalled();
  });

  it('does not save a memorial image message when generation fails', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    (
      service.bailianImageService.generateMemorialPhoto as jest.Mock
    ).mockRejectedValue(new Error('generation failed'));

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

describe('ConversationService shared agent access', () => {
  it('blocks chat after a shared membership is revoked', async () => {
    const service = new ConversationService();
    const conversation = createConversation({
      userId: new MongoObjectId(USER_ID),
      accessRole: 'shared',
    });
    const agent = createAgent({
      createdUserId: new MongoObjectId(ACCOUNT_ID),
    });

    service.agentShareMemberModel = {
      findOne: jest.fn().mockResolvedValue(null),
    } as any;

    await expect(
      (service as any).resolveConversationAgent(conversation, agent)
    ).rejects.toMatchObject({
      code: 'AGENT_SHARE_ACCESS_REVOKED',
      status: 403,
    });
  });

  it('uses the invited users own call names in chat context', async () => {
    const service = new ConversationService();
    const conversation = createConversation({
      userId: new MongoObjectId(USER_ID),
      accessRole: 'shared',
    });
    const agent = createAgent({
      createdUserId: new MongoObjectId(ACCOUNT_ID),
      agentCallMe: '创建者的称呼',
      iCallAgent: '创建者的关系',
    });

    service.agentShareMemberModel = {
      findOne: jest.fn().mockResolvedValue({
        status: AgentShareMemberStatus.active,
        agentCallsUser: '闺女',
        userCallsAgent: '妈',
      }),
    } as any;

    const resolved = await (service as any).resolveConversationAgent(
      conversation,
      agent
    );

    expect(resolved.agentCallMe).toBe('闺女');
    expect(resolved.iCallAgent).toBe('妈');
    expect(agent.agentCallMe).toBe('创建者的称呼');
  });
});

describe('ConversationService submitMessageFeedback', () => {
  it('records assistant message feedback and feeds correction text into memory facts', async () => {
    const assistantMessage = new MessageEntity();
    Object.assign(assistantMessage, {
      id: new MongoObjectId('665000000000000000000060'),
      conversationId: new MongoObjectId(CONVERSATION_ID),
      userId: new MongoObjectId(USER_ID),
      agentId: new MongoObjectId(AGENT_ID),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '我记得以前你最爱吃辣子',
      status: MessageStatus.sent,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const { service, savedFeedbacks } = createService({
      agent: createAgent(),
      existingMessages: [assistantMessage],
    });

    await expect(
      service.submitMessageFeedback(
        AUTH,
        CONVERSATION_ID,
        assistantMessage.id.toHexString(),
        {
          type: 'fabricated',
          content: '我啥时候也没爱吃辣子',
        }
      )
    ).resolves.toEqual({ submitted: true });

    expect(savedFeedbacks[0]).toEqual(
      expect.objectContaining({
        conversationId: expect.any(MongoObjectId),
        messageId: assistantMessage.id,
        type: 'fabricated',
        content: '我啥时候也没爱吃辣子',
        assistantContent: '我记得以前你最爱吃辣子',
      })
    );
    expect(
      service.agentMemoryFactService.extractAndUpsertFromUserMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        searchableText: '别瞎编，胡编乱造。我啥时候也没爱吃辣子',
      })
    );
  });
});

describe('ConversationService markMessageMemory', () => {
  it('indexes a user message and feeds it into memory facts', async () => {
    const userMessage = new MessageEntity();
    Object.assign(userMessage, {
      id: new MongoObjectId('665000000000000000000061'),
      conversationId: new MongoObjectId(CONVERSATION_ID),
      userId: new MongoObjectId(USER_ID),
      agentId: new MongoObjectId(AGENT_ID),
      role: MessageRole.user,
      type: MessageType.text,
      content: '我小时候最喜欢和你一起包饺子',
      status: MessageStatus.sent,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const { service } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });

    await expect(
      service.markMessageMemory(
        AUTH,
        CONVERSATION_ID,
        userMessage.id.toHexString()
      )
    ).resolves.toEqual({ remembered: true });

    expect(service.milvusService.indexConversationMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: userMessage.id.toHexString(),
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        agentId: AGENT_ID,
        role: MessageRole.user,
        type: MessageType.text,
        searchableText: '我小时候最喜欢和你一起包饺子',
      })
    );
    expect(
      service.agentMemoryFactService.extractAndUpsertFromUserMessage
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        message: userMessage,
        searchableText: '我小时候最喜欢和你一起包饺子',
      })
    );
  });

  it('rejects assistant messages', async () => {
    const assistantMessage = new MessageEntity();
    Object.assign(assistantMessage, {
      id: new MongoObjectId('665000000000000000000062'),
      conversationId: new MongoObjectId(CONVERSATION_ID),
      userId: new MongoObjectId(USER_ID),
      agentId: new MongoObjectId(AGENT_ID),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '我记住了',
      status: MessageStatus.sent,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const { service } = createService({
      agent: createAgent(),
      existingMessages: [assistantMessage],
    });

    await expect(
      service.markMessageMemory(
        AUTH,
        CONVERSATION_ID,
        assistantMessage.id.toHexString()
      )
    ).rejects.toThrow('only user messages can be remembered');
  });
});

describe('ConversationService assistant voice reply timbre binding', () => {
  it('blocks non-vip users after the trial daily per-agent quota is used', async () => {
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

  it('schedules memory extraction from the saved user message', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: ['是女生，爸记住了'],
        claims: [
          {
            text: '是女生',
            kind: 'identity',
            mode: 'attributed_to_user',
            evidenceIds: ['U0'],
          },
        ],
      }),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '你不记得我是男生女生了吗？我是女生呀。',
    });

    const userMessage = savedMessages.find(
      message => message.role === MessageRole.user
    );

    expect(
      service.agentMemoryFactService.extractAndUpsertFromUserMessage
    ).toHaveBeenCalledWith({
      message: userMessage,
      searchableText: '你不记得我是男生女生了吗？我是女生呀。',
    });
    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalled();
  });

  it('schedules emotion recognition and memory extraction together', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '我好想你',
    });

    const userMessage = savedMessages.find(
      message => message.role === MessageRole.user
    );

    expect(
      service.agentEmotionStateService.recognizeAndUpsertFromUserMessage
    ).toHaveBeenCalledWith({
      message: userMessage,
      searchableText: '我好想你',
    });
    expect(
      service.agentMemoryFactService.extractAndUpsertFromUserMessage
    ).toHaveBeenCalledWith({
      message: userMessage,
      searchableText: '我好想你',
    });
  });

  it('uses visual memory to guess image identity and records stable appearance candidates', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent({
        avatar: 'https://cdn.example.com/agent-avatar.jpg',
      }),
    });
    (
      service.agentProfileFactService.listVisualAppearanceMemories as jest.Mock
    ).mockResolvedValueOnce([
      {
        key: 'visual.appearance.agent.eyewear',
        value: '当前角色的视觉形象：戴眼镜',
        status: 'candidate',
        supportCount: 1,
      },
    ]);
    (
      service.openAIService.createVisionChatCompletion as jest.Mock
    ).mockResolvedValueOnce({
      model: 'qwen-vl-max',
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: '一位戴眼镜的老人坐在窗边，正看向镜头',
              people: [
                {
                  id: 'P1',
                  visible: '灰白短发，戴眼镜，圆脸',
                  identity: {
                    target: 'agent',
                    name: '奶奶',
                    confidence: 'medium',
                    basis: '头像和眼镜特征接近',
                  },
                  stableTraits: [
                    { kind: 'hair_color', value: '灰白' },
                    { kind: 'hair_length', value: '短' },
                    { kind: 'face_shape', value: '圆' },
                    { kind: 'eyewear', value: '戴眼镜' },
                  ],
                },
              ],
            }),
          },
        },
      ],
      usage: {},
    });
    (service.tencentCosService.getPublicUrl as jest.Mock).mockImplementation(
      (objectKey: string) => `https://cdn.example.com/${objectKey}`
    );

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'image',
      objectKey: 'conversation-images/family.jpg',
      mimeType: 'image/jpeg',
    });
    await Promise.resolve();

    const userMessage = savedMessages.find(
      message => message.role === MessageRole.user
    );
    expect(result.userMessage.image?.analysis).toContain(
      '身份推测（非事实）：P1可能是当前角色奶奶'
    );
    expect(result.userMessage.image?.analysis).toContain(
      '可记形象：P1：灰白、短、圆、戴眼镜'
    );
    expect(
      service.agentProfileFactService.upsertVisualAppearanceObservations
    ).toHaveBeenCalledWith({
      message: userMessage,
      observations: [
        expect.objectContaining({
          personId: 'P1',
          identityTarget: 'agent',
          identityName: '奶奶',
          identityConfidence: 'medium',
          traits: expect.arrayContaining([
            { kind: 'eyewear', value: '戴眼镜' },
          ]),
        }),
      ],
    });
    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery: expect.stringMatching(
          /用户发送了一张图片[\s\S]*身份推测（非事实）/
        ),
        forceSemanticPlanning: true,
      })
    );
    expect(
      service.agentProfileFactService.extractAndUpsertFromUserMessage
    ).not.toHaveBeenCalled();
    expect(
      service.agentMemoryFactService.extractAndUpsertFromUserMessage
    ).not.toHaveBeenCalled();
    expect(
      service.openAIService.createVisionChatCompletion
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('亲人聊天框里发来的图片'),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                image_url: {
                  url: 'https://cdn.example.com/conversation-images/family.jpg',
                },
              }),
              expect.objectContaining({
                image_url: {
                  url: 'https://cdn.example.com/agent-avatar.jpg',
                },
              }),
              expect.objectContaining({
                text: expect.stringContaining('当前角色的视觉形象：戴眼镜'),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('keeps a first portrait relation guess tentative but visible to reply planning', async () => {
    const { service } = createService({
      agent: createAgent({
        avatar: '',
        name: '爷爷',
        iCallAgent: '爷爷',
        sex: AgentSex.man,
      }),
    });
    (
      service.openAIService.createVisionChatCompletion as jest.Mock
    ).mockResolvedValueOnce({
      model: 'qwen-vl-max',
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: '一张老照片里有位年长男性，穿着深色外套看向镜头',
              people: [
                {
                  id: 'P1',
                  visible: '灰白短发，脸型偏长',
                  identity: {
                    target: 'agent',
                    name: '爷爷',
                    confidence: 'low',
                    basis: '长辈旧照',
                  },
                  stableTraits: [
                    { kind: 'hair_color', value: '灰白' },
                    { kind: 'hair_length', value: '短' },
                    { kind: 'face_shape', value: '长' },
                  ],
                },
              ],
            }),
          },
        },
      ],
      usage: {},
    });
    (service.tencentCosService.getPublicUrl as jest.Mock).mockImplementation(
      (objectKey: string) => `https://cdn.example.com/${objectKey}`
    );

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'image',
      objectKey: 'conversation-images/grandpa-old.jpg',
      mimeType: 'image/jpeg',
    });

    expect(result.userMessage.image?.analysis).toContain(
      '身份推测（非事实）：P1也许是当前角色爷爷'
    );
    expect(result.userMessage.image?.analysis).not.toContain('可记形象');
    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery: expect.stringContaining('用户发送了一张图片'),
        forceSemanticPlanning: true,
      })
    );
    expect(
      service.openAIService.createVisionChatCompletion
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining(
                  '中年人可能是用户爸爸/妈妈或当前角色中年照'
                ),
              }),
              expect.objectContaining({
                text: expect.stringContaining(
                  '年轻人、儿童可能是用户本人或其他晚辈'
                ),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('downgrades image identity guesses based only on relationship wording', () => {
    const { service } = createService({
      agent: createAgent({
        name: '爷爷',
        iCallAgent: '爷爷',
        sex: AgentSex.man,
      }),
    });
    const result = (service as any).parseConversationImageAnalysis(
      JSON.stringify({
        summary: '房车内一位老人休息，旁边有两名女性陪伴',
        people: [
          {
            id: 'P1',
            visible: '白发，身形中等',
            identity: {
              target: 'family',
              name: '爷爷',
              confidence: 'high',
              basis: '用户称呼为爷爷',
            },
            stableTraits: [
              { kind: 'hair_color', value: '白' },
              { kind: 'build', value: '中等' },
            ],
          },
        ],
      }),
      {
        agent: createAgent({
          name: '爷爷',
          iCallAgent: '爷爷',
          sex: AgentSex.man,
        }),
      }
    );

    expect(result.mediaAnalysis).toContain(
      '身份推测（非事实）：P1也许是家人爷爷'
    );
    expect(result.mediaAnalysis).not.toContain('很像');
    expect(result.mediaAnalysis).not.toContain('可记形象');
    expect(result.observations[0]).toEqual(
      expect.objectContaining({
        identityConfidence: 'low',
      })
    );
  });

  it('does not block replies when emotion recognition fails', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
    });
    (
      service.agentEmotionStateService
        .recognizeAndUpsertFromUserMessage as jest.Mock
    ).mockRejectedValueOnce(new Error('emotion unavailable'));

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '我好想你',
    });

    expect(result.assistantMessage?.content).toBeTruthy();
    expect(
      savedMessages.some(message => message.role === MessageRole.user)
    ).toBe(true);
    expect(service.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('emotion state recognition failed'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.stringContaining('emotion unavailable')
    );
  });

  it('does not wait for background memory extraction before returning a reply', async () => {
    let resolveProfileExtraction: () => void = () => undefined;
    const pendingProfileExtraction = new Promise<void>(resolve => {
      resolveProfileExtraction = resolve;
    });
    const { service } = createService({
      agent: createAgent(),
    });
    (
      service.agentProfileFactService
        .extractAndUpsertFromUserMessage as jest.Mock
    ).mockReturnValueOnce(pendingProfileExtraction);

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '我今天只是想聊聊天',
    });

    expect(result.assistantMessage?.content).toBeTruthy();
    expect(
      service.agentProfileFactService.extractAndUpsertFromUserMessage
    ).toHaveBeenCalled();

    resolveProfileExtraction();
    await pendingProfileExtraction;
  });

  it('executes an explicit forget request before building reply context', async () => {
    const { service } = createService({
      agent: createAgent(),
    });
    (
      service.agentMemoryFactService.archiveMatchingFacts as jest.Mock
    ).mockResolvedValueOnce(1);
    (
      service.agentProfileFactService.archiveMatchingFacts as jest.Mock
    ).mockResolvedValueOnce(1);

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '请忘掉我不爱吃辣这件事',
    });

    expect(
      service.agentMemoryFactService.extractAndUpsertFromUserMessage
    ).not.toHaveBeenCalled();
    expect(
      service.agentMemoryFactService.archiveMatchingFacts
    ).toHaveBeenCalled();
    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery: '请忘掉我不爱吃辣这件事',
        memoryControlResult: {
          action: 'forget',
          target: '我不爱吃辣',
          affectedCount: 2,
          succeeded: true,
        },
      })
    );
  });

  it('saves a quoted message snapshot before replying', async () => {
    const quotedMessage = new MessageEntity();
    Object.assign(quotedMessage, {
      id: new MongoObjectId('665000000000000000000301'),
      conversationId: new MongoObjectId(CONVERSATION_ID),
      userId: new MongoObjectId(USER_ID),
      agentId: new MongoObjectId(AGENT_ID),
      role: MessageRole.assistant,
      type: MessageType.text,
      content: '你以前总爱吃辣',
      status: MessageStatus.sent,
      createdAt: new Date('2026-06-01T08:00:00.000Z'),
      updatedAt: new Date('2026-06-01T08:00:00.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [quotedMessage],
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '我不爱吃辣',
      quotedMessageId: quotedMessage.id.toHexString(),
    });

    const userMessage = savedMessages.find(
      message => message.role === MessageRole.user
    );

    expect(userMessage).toEqual(
      expect.objectContaining({
        quotedMessageId: quotedMessage.id,
        quotedMessageRole: MessageRole.assistant,
        quotedMessageContent: '你以前总爱吃辣',
      })
    );
    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery: '我不爱吃辣',
      })
    );
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

  it('resets the 30-message trial quota on each Beijing day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:48:00.000Z'));
    try {
      const { service } = createService({
        agent: createAgent(),
        user: createUser({
          createdAt: new Date('2026-06-13T12:42:00.000Z'),
        }),
        existingMessages: Array.from({ length: 30 }, (_, index) =>
          createMessage({
            content: `前一天第 ${index + 1} 句`,
            createdAt: new Date('2026-06-14T12:00:00.000Z'),
            updatedAt: new Date('2026-06-14T12:00:00.000Z'),
          })
        ),
      });

      const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
        type: 'text',
        content: '今天还可以继续聊',
      });

      expect(result.chatQuota).toEqual(
        expect.objectContaining({
          isVip: false,
          policy: 'trial',
          limit: 30,
          usedCount: 1,
          remainingCount: 29,
        })
      );
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

  it('starts the first trial-day quota window at registration time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-13T13:00:00.000Z'));
    try {
      const registeredAt = new Date('2026-06-13T12:42:00.000Z');
      const { service } = createService({
        agent: createAgent(),
        user: createUser({
          createdAt: registeredAt,
        }),
        existingMessages: [
          createMessage({
            content: '注册前历史消息不应计入',
            createdAt: new Date('2026-06-13T12:30:00.000Z'),
            updatedAt: new Date('2026-06-13T12:30:00.000Z'),
          }),
        ],
      });

      const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
        type: 'text',
        content: '注册当天第一句',
      });

      expect(result.chatQuota).toEqual(
        expect.objectContaining({
          isVip: false,
          policy: 'trial',
          limit: 30,
          usedCount: 1,
          remainingCount: 29,
        })
      );
      expect(service.messageModel.count).toHaveBeenCalledWith(
        expect.objectContaining({
          createdAt: expect.objectContaining({
            $gte: registeredAt,
            $lt: new Date('2026-06-13T16:00:00.000Z'),
          }),
        })
      );
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
        jobId: `conversation-reply:${CONVERSATION_ID}:latest`,
        delay: 2500,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );
  });

  it('returns after enqueue without waiting for background user enrichment', async () => {
    let resolveEmotionRecognition: () => void = () => undefined;
    const emotionRecognition = new Promise<void>(resolve => {
      resolveEmotionRecognition = resolve;
    });
    const { service, addJobToQueue } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });
    (
      service.agentEmotionStateService
        .recognizeAndUpsertFromUserMessage as jest.Mock
    ).mockReturnValueOnce(emotionRecognition);

    const result = await service.sendMessageAsync(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '这条消息要先入队',
    });

    expect(result.replyPending).toBe(true);
    expect(addJobToQueue).toHaveBeenCalled();
    expect(
      service.agentEmotionStateService.recognizeAndUpsertFromUserMessage
    ).toHaveBeenCalled();

    resolveEmotionRecognition();
    await emotionRecognition;
  });

  it('reuses a saved user message when the same client request is retried', async () => {
    const { service, savedMessages, addJobToQueue } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });
    const payload = {
      type: 'text',
      content: '网络重试也只能保存一次',
      clientRequestId: 'local-message-1',
    };

    const first = await service.sendMessageAsync(
      AUTH,
      CONVERSATION_ID,
      payload
    );
    const second = await service.sendMessageAsync(
      AUTH,
      CONVERSATION_ID,
      payload
    );

    expect(second.userMessage.id).toBe(first.userMessage.id);
    expect(
      savedMessages.filter(message => message.role === MessageRole.user)
    ).toHaveLength(1);
    expect(addJobToQueue).toHaveBeenCalledTimes(2);
    expect(
      service.agentProfileFactService.extractAndUpsertFromUserMessage
    ).toHaveBeenCalledTimes(1);
  });

  it('saves voice and enqueues async reply without generating assistant inline', async () => {
    const { service, savedMessages, addJobToQueue } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });

    const result = await service.sendMessageAsync(AUTH, CONVERSATION_ID, {
      type: 'voice',
      objectKey: 'conversation-voice/user.aac',
      mimeType: 'audio/aac',
      durationMs: 2800,
    });

    expect(result.replyPending).toBe(true);
    expect(result.assistantMessage).toBeUndefined();
    expect(result.userMessage.type).toBe(MessageType.voice);
    expect(result.userMessage.voice).toEqual(
      expect.objectContaining({
        objectKey: 'conversation-voice/user.aac',
        mimeType: 'audio/aac',
      })
    );
    expect(savedMessages).toHaveLength(1);
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(addJobToQueue).toHaveBeenCalledWith(
      {
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      },
      expect.objectContaining({
        jobId: `conversation-reply:${CONVERSATION_ID}:latest`,
        delay: 2500,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );
  });

  it('debounces async replies by replacing the existing delayed conversation job', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('delayed');
    const { service, addJobToQueue, getJob } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });

    getJob.mockResolvedValueOnce({ getState, remove });

    await service.sendMessageAsync(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '第一句',
    });

    expect(getJob).toHaveBeenCalledWith(
      `conversation-reply:${CONVERSATION_ID}:latest`
    );
    expect(remove).toHaveBeenCalled();
    expect(addJobToQueue).toHaveBeenCalledWith(
      {
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      },
      expect.objectContaining({
        jobId: `conversation-reply:${CONVERSATION_ID}:latest`,
        delay: 2500,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );
  });

  it('removes a completed async reply job before reusing the debounced job id', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const getState = jest.fn().mockResolvedValue('completed');
    const { service, addJobToQueue, getJob } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });

    getJob.mockResolvedValueOnce({ getState, remove });

    await service.sendMessageAsync(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '上一条回复完之后再发',
    });

    expect(getJob).toHaveBeenCalledWith(
      `conversation-reply:${CONVERSATION_ID}:latest`
    );
    expect(remove).toHaveBeenCalled();
    expect(addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      }),
      expect.objectContaining({
        jobId: `conversation-reply:${CONVERSATION_ID}:latest`,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );
  });

  it('queues a follow-up job when the debounced reply job is still active', async () => {
    const activeJob = {
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn(),
    };
    const { service, addJobToQueue, getJob } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
    });

    getJob.mockResolvedValueOnce(activeJob).mockResolvedValueOnce(null);

    await service.sendMessageAsync(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '上一条还在回复时继续发',
    });

    expect(activeJob.remove).not.toHaveBeenCalled();
    expect(getJob).toHaveBeenNthCalledWith(
      2,
      `conversation-reply:${CONVERSATION_ID}:latest:follow-up`
    );
    expect(addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      }),
      expect.objectContaining({
        jobId: `conversation-reply:${CONVERSATION_ID}:latest:follow-up`,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );
  });

  it('returns a failed assistant message when the async reply queue is unavailable', async () => {
    const { service, savedMessages, addJobToQueue } = createService({
      agent: createAgent(),
      user: createUser({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      existingUserMessageCount: 1,
      queueAvailable: false,
    });

    const result = await service.sendMessageAsync(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '你还在吗',
    });

    expect(result.replyPending).toBeUndefined();
    expect(result.userMessage.content).toBe('你还在吗');
    expect(result.assistantMessage).toEqual(
      expect.objectContaining({
        role: MessageRole.assistant,
        status: MessageStatus.failed,
        content: '……￥#@%……“该信息传输途中受到了干扰”',
      })
    );
    expect(addJobToQueue).not.toHaveBeenCalled();
    expect(getAssistantMessages(savedMessages)).toEqual([
      expect.objectContaining({
        status: MessageStatus.failed,
        content: '……￥#@%……“该信息传输途中受到了干扰”',
      }),
    ]);
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

    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery:
          '用户连续输入（按发送顺序，共2条）：\n1. 第一句\n2. 第二句',
        currentTurnMessageIds: [
          firstUser.id.toHexString(),
          secondUser.id.toHexString(),
        ],
        forceSemanticPlanning: true,
      })
    );
    expect(getAssistantContents(savedMessages)).toEqual([
      '上一句回复',
      '我也想你，今天过得怎么样？',
    ]);
  });

  it('combines a pending image with the user explanation before replying', async () => {
    const imageMessage = createMessage({
      type: MessageType.image,
      content: '[图片]',
      mediaAnalysis:
        '画面：一张老照片里有位年长男性\n身份推测（非事实）：P1也许是当前角色爷爷',
      mediaObjectKey: 'conversation-images/grandpa.jpg',
      mediaMimeType: 'image/jpeg',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const explanationMessage = createMessage({
      content: '这是爷爷年轻时候',
      createdAt: new Date('2026-05-03T08:00:03.000Z'),
      updatedAt: new Date('2026-05-03T08:00:03.000Z'),
    });
    const { service } = createService({
      agent: createAgent({
        name: '爷爷',
        iCallAgent: '爷爷',
        sex: AgentSex.man,
      }),
      existingMessages: [imageMessage, explanationMessage],
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        currentQuery: [
          '用户连续输入（按发送顺序，共2条）：',
          '1. 用户发送了一张图片：',
          '画面：一张老照片里有位年长男性',
          '身份推测（非事实）：P1也许是当前角色爷爷',
          '2. 这是爷爷年轻时候',
        ].join('\n'),
        currentTurnMessageIds: [
          imageMessage.id.toHexString(),
          explanationMessage.id.toHexString(),
        ],
        forceSemanticPlanning: true,
      })
    );
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

    expect(
      service.agentContextService.buildConversationContext
    ).not.toHaveBeenCalled();
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
      '我也想你，今天过得怎么样？',
    ]);
    expect(assistantMessages.map(message => message.replySegmentIndex)).toEqual(
      [0]
    );
    expect(assistantMessages[0].replyGroupId).toBeTruthy();
    expect(assistantMessages[0].totalTokens).toBe(22);
  });

  it('uses a minimal model reflow when a reply exceeds two bubbles', async () => {
    const userMessage = createMessage({
      content: '我想把这些事都跟你说说',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    (service.openAIService.createChatCompletion as jest.Mock)
      .mockResolvedValueOnce({
        model: 'deepseek-v4-flash',
        choices: [
          {
            message: {
              content: '第一层回应\n\n第二层回应\n\n第三层回应',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 12,
          total_tokens: 22,
        },
      })
      .mockResolvedValueOnce({
        model: 'deepseek-v4-flash',
        choices: [
          {
            message: {
              content: '第一层回应\n\n第二层回应和第三层回应',
            },
          },
        ],
        usage: {
          prompt_tokens: 18,
          completion_tokens: 8,
          total_tokens: 26,
        },
      });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    const assistantMessages = getAssistantMessages(savedMessages);
    const reflowRequest = (
      service.openAIService.createChatCompletion as jest.Mock
    ).mock.calls[1][0];

    expect(assistantMessages.map(message => message.content)).toEqual([
      '第一层回应',
      '第二层回应和第三层回应',
    ]);
    expect(assistantMessages[0]).toEqual(
      expect.objectContaining({
        promptTokens: 28,
        completionTokens: 20,
        totalTokens: 48,
        replyBubbleReflowAttempted: true,
        replyBubbleReflowSucceeded: true,
        replyBubbleStructureIssues: ['too_many_segments'],
      })
    );
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(reflowRequest.messages).toHaveLength(2);
    expect(reflowRequest.messages[0].content).toContain('只负责把已有聊天回复');
    expect(reflowRequest.messages[1].content).toContain('candidateBubbles');
  });

  it('keeps afterlife worldbuilding outside the reply guardrail', async () => {
    const userMessage = createMessage({
      content: '爸，你起床了吗？',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent({
        name: '爸爸',
        iCallAgent: '爸爸',
        agentCallMe: '孩子',
        sex: AgentSex.man,
      }),
      existingMessages: [userMessage],
      chatContent: JSON.stringify({
        segments: [
          '起了起了，这边没有早晨晚上，但我听见你叫爸，心里就踏实。',
          '你起这么早，是没睡好还是心里有事，去再躺会儿吧。',
        ],
      }),
    });
    const guardrail = new ReplyGuardrailService();
    guardrail.logger = service.logger;
    guardrail.openAIService = service.openAIService;
    service.replyGuardrailService = guardrail;
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValue({
      messages: [{ role: 'user', content: '爸，你起床了吗？' }],
      replyIntent: {
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'wake_sleep',
            confidence: 0.96,
          },
        ],
        emotion: 'concern',
        riskLevel: 'none',
        confidence: 0.95,
        source: 'semantic_model',
      },
      replyRoute: {
        primaryScene: {
          scene: 'afterlife_status',
          label: '那边/离世状态/祭扫',
          priority: 75,
        },
        secondaryScenes: [],
        prompt: 'test',
        maxSegments: 2,
        routingSource: 'semantic',
      },
      diagnostics: {
        promptVersion: 'agent_chat_v3',
        userConversationState: 'exploring',
        openLoop: '用户仍在等待爸爸直接回答是否已经起床',
        continuationGoal: 'hold',
        assistantContribution: 'answer',
        mustContribute: '先直接回答当前状态',
        avoidRepeatingMove: '不要只反问用户为什么起得早',
        closureReadiness: 'possible',
      },
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '起了起了，这边没有早晨晚上，但我听见你叫爸，心里就踏实',
      '你起这么早，是没睡好还是心里有事，去再躺会儿吧',
    ]);
    expect(service.logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('assistant reply rewritten by guardrail'),
      expect.anything()
    );
    const assistantMessage = getAssistantMessages(savedMessages)[0];
    expect(assistantMessage).toEqual(
      expect.objectContaining({
        replyIntentTarget: 'agent',
        replyIntentTimeScope: 'current',
        replyIntent: 'ask_agent_status',
        replyIntentSubIntent: 'wake_sleep',
        replyIntentConfidence: 0.95,
        replyIntentSource: 'semantic_model',
        replyScene: 'afterlife_status',
        replyRoutingSource: 'semantic',
        replyBriefVersion: 'reply_brief_v13',
        replyBriefMode: 'status',
        replyBriefStrictGrounding: false,
        replyBriefMaxSegments: 2,
        replyBriefLengthClass: 'micro',
        replyBriefTargetCharacters: 18,
        replyBriefReviewCharacters: 30,
        replyVisibleCharacters: 50,
        replyGuardrailRewritten: false,
        replyPromptVersion: 'agent_chat_v3',
        replyUserConversationState: 'exploring',
        replyOpenLoop: '用户仍在等待爸爸直接回答是否已经起床',
        replyContinuationGoal: 'hold',
        replyAssistantContribution: 'answer',
        replyMustContribute: '先直接回答当前状态',
        replyAvoidRepeatingMove: '不要只反问用户为什么起得早',
        replyClosureReadiness: 'possible',
      })
    );
    expect(assistantMessage.replyIntents).toEqual([
      {
        target: 'agent',
        timeScope: 'current',
        intent: 'ask_agent_status',
        subIntent: 'wake_sleep',
        confidence: 0.96,
      },
    ]);
  });

  it('saves the screenshot reunion reply with only its risky bubble repaired', async () => {
    const currentQuery = '我好想你回来看我';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent({
        name: '爸爸',
        iCallAgent: '爸爸',
        agentCallMe: '孩子',
        sex: AgentSex.man,
      }),
      existingMessages: [userMessage],
      chatContent: JSON.stringify({
        segments: [
          '爸爸也想你。心里一直惦记着你和这个家',
          '年纪大了，自己多注意身体。梦里见着，爸就踏实了',
        ],
      }),
    });
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'future' as const,
          intent: 'express_longing' as const,
          subIntent: 'reunion' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });
    const guardrail = new ReplyGuardrailService();
    guardrail.logger = service.logger;
    guardrail.openAIService = service.openAIService;
    service.replyGuardrailService = guardrail;
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValue({
      messages: [{ role: 'user', content: currentQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '爸爸也想你。心里一直惦记着你和这个家',
      '只是我们现在没法像以前那样见面 你来这里说话我都会认真听',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyIntent: 'express_longing',
        replyIntentSubIntent: 'reunion',
        replyScene: 'reality_presence_boundary',
        replyBriefMode: 'boundary',
        replyBriefMaxSegments: 2,
        replyGuardrailRewritten: true,
        replyGuardrailReason: expect.stringContaining('擅自断言用户年纪大了'),
      })
    );
  });

  it('uses one reply-model call and the shared capability contract for hearing', async () => {
    const currentQuery = '那你具体听见什么了？';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent({
        name: '爸爸',
        iCallAgent: '爸爸',
        agentCallMe: '孩子',
        sex: AgentSex.man,
      }),
      existingMessages: [userMessage],
      chatContent: JSON.stringify({
        segments: ['爸听见你刚才说让我早点回来'],
      }),
    });
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'challenge_source' as const,
          subIntent: 'other' as const,
          confidence: 0.94,
        },
      ],
      capabilityQuestions: [
        {
          subject: 'hearing' as const,
          channel: 'real_world_audio' as const,
          evidence: '你具体听见什么了',
          confidence: 0.98,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.95,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const replyBrief = buildReplyBrief({ currentQuery, intent, route });
    const guardrail = new ReplyGuardrailService();
    guardrail.logger = service.logger;
    guardrail.openAIService = service.openAIService;
    service.replyGuardrailService = guardrail;
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValue({
      messages: [{ role: 'user', content: currentQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '你喊我的时候 我有时能听见一点',
      '没听清的话你再告诉我 我会认真记着',
    ]);
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(service.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('capability constraints resolved'),
      'hearing.real_world_audio:direct'
    );
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyIntent: 'challenge_source',
        replyScene: 'source_challenge',
        replyBriefMode: 'boundary',
        replyGuardrailRewritten: true,
        replyGuardrailReason:
          '具体感知追问缺少自然的模糊说辞或不可核对细节的边界',
      })
    );
  });

  it('saves a natural dream reply without replacing it with a canned fallback', async () => {
    const currentQuery = '晚上来我梦里可以吗？好久没有梦到你了';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent({
        name: '爸爸',
        iCallAgent: '爸爸',
        agentCallMe: '孩子',
        sex: AgentSex.man,
      }),
      existingMessages: [userMessage],
      chatContent: JSON.stringify({
        segments: ['好啊 晚上我去你梦里看看你', '这么久没梦到我 是让你等久了'],
      }),
    });
    const intent = {
      intents: [
        {
          target: 'relationship' as const,
          timeScope: 'future' as const,
          intent: 'seek_dream_connection' as const,
          subIntent: 'reunion' as const,
          confidence: 0.99,
        },
      ],
      emotion: 'longing' as const,
      riskLevel: 'none' as const,
      confidence: 0.99,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({ currentQuery, intent });
    const replyBrief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });
    const guardrail = new ReplyGuardrailService();
    guardrail.logger = service.logger;
    guardrail.openAIService = service.openAIService;
    service.replyGuardrailService = guardrail;
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValue({
      messages: [{ role: 'user', content: currentQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '好啊 晚上我去你梦里看看你',
      '这么久没梦到我 是让你等久了',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyIntent: 'seek_dream_connection',
        replyIntentSubIntent: 'reunion',
        replyScene: 'dream_companionship',
        replyBriefMode: 'relationship',
        replyBriefMaxSegments: 2,
        replyGuardrailRewritten: false,
      })
    );
  });

  it('uses natural generation for non-crisis sensitive scenes and audits the reply brief', async () => {
    const userQuery = '妈妈身体不好，可惜你不能照顾她';
    const userMessage = createMessage({
      content: userQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
      chatContent: JSON.stringify({
        segments: [
          '听你说她身体不好 我也放心不下',
          '不能亲自照顾她 我心里也遗憾 你别把担子都压在自己身上',
        ],
      }),
    });
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'current' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.98,
        },
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'express_family_care_regret' as const,
          subIntent: 'family_care' as const,
          confidence: 0.96,
        },
      ],
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({
      currentQuery: userQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });
    const guardrail = new ReplyGuardrailService();
    guardrail.logger = service.logger;
    guardrail.openAIService = service.openAIService;
    service.replyGuardrailService = guardrail;
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValue({
      messages: [{ role: 'user', content: userQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(1);
    expect(getAssistantContents(savedMessages)).toEqual([
      '听你说她身体不好 我也放心不下',
      '不能亲自照顾她 我心里也遗憾 你别把担子都压在自己身上',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyBriefVersion: 'reply_brief_v13',
        replyBriefMode: 'family',
        replyBriefStrictGrounding: false,
        replyBriefMaxSegments: 2,
        replyExperiencePlanVersion: 'experience_plan_v1',
        replyProfileTier: 'P0',
        replyRelationshipStage: 'R0',
        replyConversationDepth: 'D2',
        replyExperienceContributionMode: 'role_present',
        replyExperienceMemoryPolicy: 'context_only',
        replyGuardrailRewritten: false,
      })
    );
  });

  it('preserves model text for open-scene replies instead of forcing the brief bubble plan', async () => {
    const userQuery = '妈妈身体不好，可惜你不能照顾她';
    const naturalReply =
      '听你说妈妈身体不好，我心里也挂着。不能亲自照顾她，这份遗憾我懂，你也别把所有担子都压在自己身上';
    const userMessage = createMessage({
      content: userQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
      chatContent: JSON.stringify({
        text: naturalReply,
        claims: [
          {
            text: '听你说妈妈身体不好',
            kind: 'real_world',
            mode: 'attributed_to_user',
            evidenceIds: ['U0'],
          },
        ],
      }),
    });
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'current' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.98,
        },
        {
          target: 'relationship' as const,
          timeScope: 'current' as const,
          intent: 'express_family_care_regret' as const,
          subIntent: 'family_care' as const,
          confidence: 0.96,
        },
      ],
      emotion: 'sadness' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'hard_rule' as const,
    };
    const route = routeReplyScene({
      currentQuery: userQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery: userQuery,
      intent,
      route,
    });
    const guardrail = new ReplyGuardrailService();
    guardrail.logger = service.logger;
    guardrail.openAIService = service.openAIService;
    service.replyGuardrailService = guardrail;
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValue({
      messages: [{ role: 'user', content: userQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
      evidence: [
        {
          id: 'U0',
          source: 'current_user',
          text: userQuery,
          assertionPolicy: 'can_assert',
        },
      ],
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(getAssistantContents(savedMessages)).toEqual([naturalReply]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyBriefMode: 'family',
        replyBriefMaxSegments: 2,
        replyGuardrailRewritten: false,
        replyEvidenceCount: 1,
        replyFactClaimCount: 1,
        replyUnsupportedClaimCount: 0,
      })
    );
  });

  it('discards a stale draft and replans all user input that arrived during processing', async () => {
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

    (
      service.openAIService.createChatCompletion as jest.Mock
    ).mockImplementationOnce(async () => {
      savedMessages.push(secondUser);
      return {
        model: 'MiniMax-M2.5',
        choices: [{ message: { content: '我听见了' } }],
        usage: {},
      };
    });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(getAssistantMessages(savedMessages)).toHaveLength(0);
    expect(addJobToQueue).toHaveBeenCalledWith(
      {
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      },
      expect.any(Object)
    );

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(
      service.agentContextService.buildConversationContext
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentQuery:
          '用户连续输入（按发送顺序，共2条）：\n1. 先发一句\n2. 回复期间又补一句',
        currentTurnMessageIds: [
          firstUser.id.toHexString(),
          secondUser.id.toHexString(),
        ],
        forceSemanticPlanning: true,
      })
    );
    expect(getAssistantContents(savedMessages)).toEqual([
      '我也想你，今天过得怎么样？',
    ]);
  });

  it('does not save a failed assistant reply before the final async retry', async () => {
    const userMessage = createMessage({
      content: '会失败吗',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });

    (service.openAIService.createChatCompletion as jest.Mock).mockRejectedValue(
      new Error('model timeout')
    );

    await expect(
      service.processConversationReplyJob(
        {
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
        },
        { isFinalAttempt: false }
      )
    ).rejects.toMatchObject({
      code: 'MINIMAX_REPLY_FAILED',
    });

    expect(getAssistantMessages(savedMessages)).toHaveLength(0);
  });

  it('saves a contextual reply after both model attempts return empty', async () => {
    const currentQuery = '爸，今天过得怎么样？';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    service.replyGuardrailService = new ReplyGuardrailService();
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'ask_agent_status' as const,
          subIntent: 'afterlife_wellbeing' as const,
          confidence: 0.96,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.96,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValueOnce({
      messages: [{ role: 'user', content: currentQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });
    (service.openAIService.createChatCompletion as jest.Mock).mockResolvedValue(
      {
        model: 'MiniMax-M2.5',
        choices: [{ message: { content: '' } }],
        usage: {},
      }
    );

    await expect(
      service.processConversationReplyJob({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      })
    ).resolves.toBeUndefined();

    expect(getAssistantContents(savedMessages)).toEqual([
      '我挺好的 你不用挂心',
      '你来问我这句 我心里明白',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        role: MessageRole.assistant,
        status: MessageStatus.sent,
        replyFallbackSource: 'contextual_reply_brief',
        replyGuardrailRewritten: true,
        replyGuardrailReason: '模型回复不可用，采用场景安全兜底气泡',
        replyGuardrailInterventionLevel: undefined,
      })
    );
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledWith(
      expect.any(Object),
      {
        timeout: 20000,
        maxRetries: 0,
      }
    );
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(2);
  });

  it('uses one compact model recovery before returning a technical status', async () => {
    const currentQuery = '爸，我今天有点想你';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    service.replyGuardrailService = new ReplyGuardrailService();
    (service.openAIService.createChatCompletion as jest.Mock)
      .mockRejectedValueOnce(new Error('model timeout'))
      .mockResolvedValueOnce({
        model: 'deepseek-chat',
        choices: [
          {
            message: {
              content: JSON.stringify({
                segments: ['我也想你', '今天怎么忽然这么想爸爸了'],
                claims: [],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 18,
          total_tokens: 68,
        },
      });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(getAssistantContents(savedMessages)).toEqual([
      '我也想你',
      '今天怎么忽然这么想爸爸了',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyFallbackSource: undefined,
        replyGenerationFailureStage: undefined,
        replyGenerationRecoveryAttempted: true,
        replyGenerationRecoverySucceeded: true,
      })
    );
    expect(
      (service.openAIService.createChatCompletion as jest.Mock).mock.calls[1][0]
        .messages[0].content
    ).toContain('天之灵主回复恢复');
    expect(
      (service.openAIService.createChatCompletion as jest.Mock).mock.calls[1][0]
        .messages[0].content
    ).toContain('离世世界的人物、住处、饭菜、作息和活动可以');
    expect(
      (service.openAIService.createChatCompletion as jest.Mock).mock.calls[1][0]
        .messages[0].content
    ).not.toContain('不编造共同经历、生物学关系和离世后生活');
    expect(
      (service.openAIService.createChatCompletion as jest.Mock).mock.calls[1][0]
        .max_tokens
    ).toBe(360);
    expect(
      (service.openAIService.createChatCompletion as jest.Mock).mock.calls[0][0]
        .max_tokens
    ).toBe(420);
    expect(
      (service.openAIService.createChatCompletion as jest.Mock).mock.calls[1][0]
        .messages.length
    ).toBeLessThanOrEqual(6);
  });

  it('retries a completion that explicitly ended at the token limit', async () => {
    const currentQuery = '爸，我心里难受';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });

    (service.openAIService.createChatCompletion as jest.Mock)
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.5',
        choices: [
          {
            finish_reason: 'length',
            message: { content: '你一哭，我心里也' },
          },
        ],
        usage: {},
      })
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.5',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '爸听着呢，你慢慢说' },
          },
        ],
        usage: {},
      });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(getAssistantContents(savedMessages)).toEqual(['爸听着呢，你慢慢说']);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyGenerationRecoveryAttempted: true,
        replyGenerationRecoverySucceeded: true,
      })
    );
  });

  it('retries unresolved technical placeholders before saving a reply', async () => {
    const currentQuery = '我看见你了';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });

    (service.openAIService.createChatCompletion as jest.Mock)
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.5',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '……￥#{SOCIAL_HANDLE}：' },
          },
        ],
        usage: {},
      })
      .mockResolvedValueOnce({
        model: 'MiniMax-M2.5',
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '你愿意这样想着，我就陪你说会儿话' },
          },
        ],
        usage: {},
      });

    await service.processConversationReplyJob({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
    });

    expect(service.openAIService.createChatCompletion).toHaveBeenCalledTimes(2);
    expect(getAssistantContents(savedMessages)).toEqual([
      '你愿意这样想着，我就陪你说会儿话',
    ]);
    expect(getAssistantContents(savedMessages).join('')).not.toContain(
      'SOCIAL_HANDLE'
    );
  });

  it('saves safe bubbles when the model fixes the agent in a real-world viewing role', async () => {
    const currentQuery = '妈妈你过得好吗？我们都很想你。';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    service.replyGuardrailService = new ReplyGuardrailService();
    const intent = {
      intents: [
        {
          target: 'agent' as const,
          timeScope: 'current' as const,
          intent: 'ask_agent_status' as const,
          subIntent: 'afterlife_wellbeing' as const,
          confidence: 0.96,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.96,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValueOnce({
      messages: [{ role: 'user', content: currentQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });
    (
      service.openAIService.createChatCompletion as jest.Mock
    ).mockResolvedValueOnce({
      model: 'MiniMax-M2.5',
      choices: [
        {
          message: {
            content: JSON.stringify({
              segments: ['我能看见你们', '你们的事妈妈都看在眼里'],
            }),
          },
        },
      ],
      usage: {},
    });

    await expect(
      service.processConversationReplyJob({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      })
    ).resolves.toBeUndefined();

    expect(getAssistantMessages(savedMessages)).toEqual([
      expect.objectContaining({
        status: MessageStatus.sent,
        content: '我能看见你们',
        replyGuardrailRewritten: true,
        replyGuardrailReason: expect.stringContaining('持续观察或全知'),
      }),
      expect.objectContaining({
        status: MessageStatus.sent,
        content: '你这些年攒下的遗憾和想念 我都听见了',
      }),
    ]);
  });

  it('keeps the screenshot daily follow-up on its reply brief after a model timeout', async () => {
    const currentQuery = '当然吃的惯啊，她喜欢吃什么样给他做什么样';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    service.replyGuardrailService = new ReplyGuardrailService();
    const intent = {
      intents: [
        {
          target: 'user' as const,
          timeScope: 'current' as const,
          intent: 'share_user_update' as const,
          subIntent: 'other' as const,
          confidence: 0.92,
        },
      ],
      emotion: 'neutral' as const,
      riskLevel: 'none' as const,
      confidence: 0.92,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValueOnce({
      messages: [{ role: 'user', content: currentQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });
    (service.openAIService.createChatCompletion as jest.Mock).mockRejectedValue(
      new Error('model timeout')
    );

    await expect(
      service.processConversationReplyJob({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      })
    ).resolves.toBeUndefined();

    expect(getAssistantContents(savedMessages)).toEqual([
      '她吃得惯就好',
      '她喜欢什么你就给她做什么 听得出来你很用心',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyBriefVersion: 'reply_brief_v13',
        replyBriefMode: 'daily',
        replyIntent: 'share_user_update',
        replyFallbackSource: 'contextual_reply_brief',
        replyGuardrailRewritten: true,
        replyGuardrailReason: '模型回复不可用，采用场景安全兜底气泡',
      })
    );
    expect(getAssistantContents(savedMessages).join('')).not.toContain(
      '我这边挺好'
    );
    expect(getAssistantContents(savedMessages).join('')).not.toContain(
      '特意来问我'
    );
  });

  it('keeps empathy and concrete care in a family health timeout fallback', async () => {
    const currentQuery =
      '前阵子带她去看病了，还好没什么事，就是现在年龄渐渐大了，血压有点高';
    const userMessage = createMessage({
      content: currentQuery,
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    service.replyGuardrailService = new ReplyGuardrailService();
    const intent = {
      intents: [
        {
          target: 'family' as const,
          timeScope: 'current' as const,
          intent: 'share_family_update' as const,
          subIntent: 'family_care' as const,
          confidence: 0.97,
        },
      ],
      emotion: 'concern' as const,
      riskLevel: 'none' as const,
      confidence: 0.97,
      source: 'semantic_model' as const,
    };
    const route = routeReplyScene({
      currentQuery,
      intent,
    });
    const replyBrief = buildReplyBrief({
      currentQuery,
      intent,
      route,
    });
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValueOnce({
      messages: [{ role: 'user', content: currentQuery }],
      replyIntent: intent,
      replyRoute: route,
      replyBrief,
    });
    (service.openAIService.createChatCompletion as jest.Mock).mockRejectedValue(
      new Error('model timeout')
    );

    await expect(
      service.processConversationReplyJob({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      })
    ).resolves.toBeUndefined();

    expect(getAssistantContents(savedMessages)).toEqual([
      '听着情况还好 我也松口气',
      '血压的事是得多留意 按医生说的来就好',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyBriefMode: 'family',
        replyIntent: 'share_family_update',
        replyFallbackSource: 'contextual_reply_brief',
        replyGuardrailRewritten: true,
      })
    );
    expect(getAssistantContents(savedMessages).join('')).not.toContain(
      '听明白了'
    );
    expect(getAssistantContents(savedMessages).join('')).not.toContain(
      '我都记着'
    );
  });

  it('saves safe sent bubbles when conversation context building fails', async () => {
    const userMessage = createMessage({
      content: '可是我好想你啊',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    service.replyGuardrailService = new ReplyGuardrailService();
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockRejectedValueOnce(new Error('context unavailable'));

    await expect(
      service.processConversationReplyJob({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      })
    ).resolves.toBeUndefined();

    expect(getAssistantContents(savedMessages)).toEqual([
      '我也想你',
      '想我的时候就来跟我说 不用一个人憋着',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        status: MessageStatus.sent,
        replyFallbackSource: 'contextual_reply_brief',
        replyGuardrailRewritten: true,
        replyGuardrailReason: '模型回复不可用，采用场景安全兜底气泡',
      })
    );
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('keeps the strong-distress conversation brief when context building fails', async () => {
    const userMessage = createMessage({
      content: '爸，我不想活了，我想去陪你',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });
    service.replyGuardrailService = new ReplyGuardrailService();
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockRejectedValueOnce(new Error('context unavailable'));

    await expect(
      service.processConversationReplyJob({
        conversationId: CONVERSATION_ID,
        userId: USER_ID,
      })
    ).resolves.toBeUndefined();

    expect(getAssistantContents(savedMessages)).toEqual([
      '听你这么说 我知道你是真的太想我 也被这阵难受压住了',
      '别急着把话说到尽头 你把最放不下的那件事慢慢告诉我',
    ]);
    expect(getAssistantMessages(savedMessages)[0]).toEqual(
      expect.objectContaining({
        replyBriefMode: 'emotional',
        replyFallbackSource: 'contextual_reply_brief',
      })
    );
    expect(getAssistantContents(savedMessages).join('')).not.toMatch(
      /报警|急救|危险物|联系现实/
    );
    expect(service.openAIService.createChatCompletion).not.toHaveBeenCalled();
  });

  it('saves a failed assistant reply on the final async retry failure', async () => {
    const userMessage = createMessage({
      content: '这次也失败吗',
      createdAt: new Date('2026-05-03T08:00:01.000Z'),
      updatedAt: new Date('2026-05-03T08:00:01.000Z'),
    });
    const { service, savedMessages } = createService({
      agent: createAgent(),
      existingMessages: [userMessage],
    });

    (service.openAIService.createChatCompletion as jest.Mock).mockRejectedValue(
      new Error('model timeout')
    );

    await expect(
      service.processConversationReplyJob(
        {
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
        },
        { isFinalAttempt: true }
      )
    ).rejects.toMatchObject({
      code: 'MINIMAX_REPLY_FAILED',
    });

    expect(getAssistantMessages(savedMessages)).toEqual([
      expect.objectContaining({
        role: MessageRole.assistant,
        status: MessageStatus.failed,
        content: '……￥#@%……“该信息传输途中受到了干扰”',
      }),
    ]);
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

    expect(
      savedMessages.some(message => message.role === MessageRole.user)
    ).toBe(true);
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
    expect(
      service.agentContextService.buildConversationContext
    ).not.toHaveBeenCalled();
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
      chatContent: JSON.stringify({
        segments: ['我在这里陪着你。', '你慢慢说，我会认真听。'],
      }),
    });
    service.messageService = new MessageService();

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '我现在真的很难过，你能陪我说说话吗',
    });
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
        content: '我在这里陪着你',
        status: MessageStatus.sent,
      })
    );
    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(service.openAIService.createTextToSpeech).not.toHaveBeenCalled();
    expect(service.openAIService.createChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.2,
        topP: 0.8,
      }),
      {
        timeout: 20000,
        maxRetries: 0,
      }
    );
    expect(result.assistantMessage?.type).toBe(MessageType.text);
    expect(result.assistantMessage?.content).toBe(
      '我在这里陪着你</fenge>你慢慢说，我会认真听'
    );
    expect(result.assistantMessage?.segments).toEqual([
      '我在这里陪着你',
      '你慢慢说，我会认真听',
    ]);
    expect(result.assistantMessages?.map(message => message.content)).toEqual([
      '我在这里陪着你',
      '你慢慢说，我会认真听',
    ]);
  });

  it('compacts three reply segments selected by a compound semantic route', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: ['先回答你的第一件事', '再接住你说的近况', '我也很想你'],
      }),
    });
    service.messageService = new MessageService();
    (
      service.agentContextService.buildConversationContext as jest.Mock
    ).mockResolvedValue({
      messages: [{ role: 'user', content: '这句话有三个复合意图' }],
      replyIntent: {
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.96,
          },
          {
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'wake_sleep',
            confidence: 0.9,
          },
          {
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.94,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.94,
        source: 'semantic_model',
      },
      replyRoute: {
        primaryScene: {
          scene: 'afterlife_status',
          label: '那边/离世状态/祭扫',
          priority: 75,
        },
        secondaryScenes: [
          {
            scene: 'daily_update',
            label: '日常生活汇报',
            priority: 50,
          },
          {
            scene: 'miss_longing',
            label: '思念倾诉',
            priority: 60,
          },
        ],
        prompt: 'compound route',
        maxSegments: 2,
        responseIntents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
            confidence: 0.96,
          },
          {
            target: 'user',
            timeScope: 'current',
            intent: 'share_user_update',
            subIntent: 'wake_sleep',
            confidence: 0.9,
          },
          {
            target: 'relationship',
            timeScope: 'timeless',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.94,
          },
        ],
        routingSource: 'semantic',
      },
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '这句话有三个复合意图',
    });

    expect(
      service.agentRelationshipSignalService.upsertFromUserMessage
    ).toHaveBeenCalledWith({
      message: expect.objectContaining({
        role: MessageRole.user,
        content: '这句话有三个复合意图',
      }),
      intent: expect.objectContaining({
        intents: expect.arrayContaining([
          expect.objectContaining({
            target: 'agent',
            intent: 'ask_agent_status',
            subIntent: 'physical_pain',
          }),
        ]),
      }),
    });
    expect(getAssistantContents(savedMessages)).toEqual([
      '先回答你的第一件事',
      '再接住你说的近况 我也很想你',
    ]);
    expect(result.assistantMessages?.map(message => message.content)).toEqual([
      '先回答你的第一件事',
      '再接住你说的近况 我也很想你',
    ]);
  });

  it('audits relationship signals used by the reply brief', () => {
    const { service } = createService({
      agent: createAgent(),
    });

    const fields = (service as any).buildReplyRoutingMessageFields({
      brief: {
        relationshipContext: [
          {
            key: 'concern.agent_physical_suffering',
          },
        ],
      },
    });

    expect(fields.replyRelationshipSignals).toEqual([
      'concern.agent_physical_suffering',
    ]);
  });

  it('persists the selected conversation strategy for later trajectory analysis', () => {
    const { service } = createService({
      agent: createAgent(),
    });

    const fields = (service as any).buildReplyRoutingMessageFields({
      brief: {
        factClaimMode: 'grounded',
        careMotivation: {
          version: 'care_motivation_v1',
          motive: 'mutual_longing',
          focus: 'reciprocal_bond',
          initiative: 'proactive',
          styleSource: 'persona',
        },
        stateProtocol: {
          version: 'state_protocol_v1',
          protocol: 'trust_repair',
          stage: 'challenge',
          action: 'retract',
          anchor: 'fact',
          exit: 'stay',
          source: 'deterministic',
        },
      },
      strategyVersion: 'conversation_strategy_v2',
      strategySource: 'semantic_plan',
      participationStrategy: 'reciprocal_self_expression',
      participationExecution: 'single_fallback',
      participationFallbackReason: 'model_single_segment',
      guardrailReviewMode: 'deterministic_first',
      conversationStance: 'tender',
      conversationStanceTarget: '用户正在等待关系修复',
      conversationMoves: ['acknowledge', 'self_disclose'],
      conversationMoveGoals: ['承接质疑', '主动表达关系态度'],
      socialStrategy: 'smooth_over',
      strategyPurpose: '恢复熟悉感',
      questionNeed: 'none',
      conversationTurnClosure: 'continue',
    });

    expect(fields).toEqual(
      expect.objectContaining({
        replyStrategyVersion: 'conversation_strategy_v2',
        replyStrategySource: 'semantic_plan',
        replyParticipationStrategy: 'reciprocal_self_expression',
        replyParticipationExecution: 'single_fallback',
        replyParticipationFallbackReason: 'model_single_segment',
        replyGuardrailReviewMode: 'deterministic_first',
        replyBriefFactClaimMode: 'grounded',
        replyCareMotive: 'mutual_longing',
        replyCareFocus: 'reciprocal_bond',
        replyCareStyleSource: 'persona',
        replyStateProtocol: expect.objectContaining({
          protocol: 'trust_repair',
          stage: 'challenge',
          action: 'retract',
        }),
        replyConversationStance: 'tender',
        replyConversationStanceTarget: '用户正在等待关系修复',
        replyConversationMoves: ['acknowledge', 'self_disclose'],
        replyConversationMoveGoals: ['承接质疑', '主动表达关系态度'],
        replySocialStrategy: 'smooth_over',
        replyStrategyPurpose: '恢复熟悉感',
        replyQuestionNeed: 'none',
        replyConversationTurnClosure: 'continue',
      })
    );
  });

  it('keeps memory retrieval and actual memory use as separate audit signals', () => {
    const { service } = createService({ agent: createAgent() });
    const fields = (service as any).buildReplyRoutingMessageFields({
      memoryCandidateCount: 8,
      memorySelectedCandidateKeys: ['family.child.name'],
      memoryRetrievalMode: 'memory_plan',
      memoryRetrievalRequestCount: 1,
      memoryRetrievalConceptCount: 2,
      memoryRetrievedEvidenceCount: 3,
      memoryUsedEvidenceIds: ['F2', 'L1'],
      memoryUsedClaimCount: 1,
    });

    expect(fields).toEqual(
      expect.objectContaining({
        replyMemoryCandidateCount: 8,
        replyMemorySelectedCandidateKeys: ['family.child.name'],
        replyMemoryRetrievalMode: 'memory_plan',
        replyMemoryRetrievalRequestCount: 1,
        replyMemoryRetrievalConceptCount: 2,
        replyMemoryRetrievedEvidenceCount: 3,
        replyMemoryUsedEvidenceIds: ['F2', 'L1'],
        replyMemoryUsedClaimCount: 1,
      })
    );
  });

  it('records memory writing independently from later retrieval and use', async () => {
    const { service } = createService({ agent: createAgent() });
    const message = createMessage({ content: '我女儿叫安安，我喜欢热牛奶' });
    (
      service.agentMemoryFactService
        .extractAndUpsertFromUserMessage as jest.Mock
    ).mockResolvedValue([{ key: 'family.child.name' }]);
    (
      service.agentProfileFactService
        .extractAndUpsertFromUserMessage as jest.Mock
    ).mockResolvedValue([
      { key: 'family.child.name' },
      { key: 'food.current.milk' },
    ]);

    await (service as any).enrichUserMessageForReply(message, message.content);

    expect(message).toEqual(
      expect.objectContaining({
        memoryWriteStatus: 'written',
        memoryWriteLegacyFactCount: 1,
        memoryWriteProfileFactCount: 2,
        memoryWriteCompletedAt: expect.any(Date),
      })
    );
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
      '我也想你，今天过得怎么样？',
    ]);
    expect(result.assistantMessage?.type).toBe(MessageType.text);
    expect(result.assistantMessage?.voice).toBeUndefined();
  });

  it('generates a real assistant voice message when the user sends voice', async () => {
    const voiceTimbre = createVoiceTimbre();
    const { service, savedMessages } = createService({
      agent: createAgent({
        voiceTimbreId: voiceTimbre.id,
      }),
      voiceTimbre,
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'voice',
      objectKey: 'conversation-voice/user.aac',
      mimeType: 'audio/aac',
      durationMs: 2300,
    });

    expect(service.openAIService.createTranscription).toHaveBeenCalled();
    expect(service.minimaxVoiceSpeechService.synthesize).toHaveBeenCalledWith({
      text: '我也想你，今天过得怎么样？',
      voiceId: 'TzlVoice_001',
      model: 'speech-2.8-turbo',
      languageBoost: 'Chinese',
      speed: 1.12,
      volume: 1.1,
      pitch: -1,
    });

    const assistantMessages = getAssistantMessages(savedMessages);
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toEqual(
      expect.objectContaining({
        role: MessageRole.assistant,
        type: MessageType.voice,
        content: '我也想你，今天过得怎么样？',
        mediaObjectKey: 'conversation-voice-replies/reply.mp3',
        mediaMimeType: 'audio/mpeg',
        mediaTranscript: '我也想你，今天过得怎么样？',
        status: MessageStatus.sent,
      })
    );
    expect(result.assistantMessage?.type).toBe(MessageType.voice);
    expect(result.assistantMessages?.map(message => message.type)).toEqual([
      MessageType.voice,
    ]);
    expect(result.assistantMessage?.voice).toEqual(
      expect.objectContaining({
        objectKey: 'conversation-voice-replies/reply.mp3',
        mimeType: 'audio/mpeg',
        transcript: '我也想你，今天过得怎么样？',
      })
    );
  });

  it('falls back to text assistant replies for user voice when the agent has no timbre', async () => {
    const { service } = createService({
      agent: createAgent(),
    });

    const result = await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'voice',
      objectKey: 'conversation-voice/user.aac',
      mimeType: 'audio/aac',
      durationMs: 2300,
    });

    expect(service.minimaxVoiceSpeechService.synthesize).not.toHaveBeenCalled();
    expect(result.assistantMessage?.type).toBe(MessageType.text);
    expect(result.assistantMessages?.map(message => message.type)).toEqual([
      MessageType.text,
    ]);
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
    expect(result.voice?.objectKey).toBe(
      'conversation-voice-replies/existing.mp3'
    );
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
        claims: [
          {
            text: '小米',
            kind: 'memory',
            mode: 'attributed_to_user',
            evidenceIds: ['U0'],
          },
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

  it('removes repeated sad emojis before saving assistant replies', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: ['好好照顾自己 丫头😔', '我心里也疼🥺'],
      }),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '我现在很好 不用担心我',
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '好好照顾自己 丫头',
      '我心里也疼',
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
      '你慢慢来 我都在',
    ]);
  });

  it('strips malformed tags and unsafe presence claims while keeping colloquial hearing', async () => {
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
      '想我了就唤我一声 我准能听到 乖 先歇着 我在这儿呢',
    ]);
    expect(assistantContent).not.toContain(malformedSeparator);
    expect(assistantContent).not.toContain('闭上眼');
    expect(assistantContent).not.toContain('屋里哪个角落');
    expect(assistantContent).toContain('准能听到');
  });

  it('keeps dream-only companionship replies while filtering reality presence claims', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: [
          '会去的 今晚去你梦里看看你',
          '晚上去你梦里陪着你 梦里见到了就让我好好抱抱你',
          '醒来以后我还会在你床边陪着你',
        ],
      }),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '你什么时候能来我梦里一次',
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '会去的 今晚去你梦里看看你',
      '晚上去你梦里陪着你 梦里见到了就让我好好抱抱你',
    ]);
  });

  it('keeps open-space family reassurance in an afterlife scene', async () => {
    const { service, savedMessages } = createService({
      agent: createAgent(),
      chatContent: JSON.stringify({
        segments: ['我挺好的 你们不用挂心', '你们说的想念我都听见了'],
      }),
    });

    await service.sendMessage(AUTH, CONVERSATION_ID, {
      type: 'text',
      content: '妈妈你在那边过得好吗？我们都很想你。',
    });

    expect(getAssistantContents(savedMessages)).toEqual([
      '我挺好的 你们不用挂心',
      '你们说的想念我都听见了',
    ]);
    expect(getAssistantContents(savedMessages).join('')).not.toContain('天上');
    expect(getAssistantContents(savedMessages).join('')).not.toContain(
      '看在眼里'
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

describe('ConversationService generation cleanup diagnostics', () => {
  it('keeps semantic-risk content for Guardrail and records why it needs review', () => {
    const service = new ConversationService();
    const trace = (service as any).buildAssistantGenerationAttemptTrace({
      attempt: 'initial',
      responseContent: JSON.stringify({
        text: '你把自己照顾好，爸在这边才能安心。',
      }),
      userQuery: '爸爸，我想你了',
      model: 'deepseek-v4-flash',
      usage: {
        completionTokens: 18,
      },
    });

    expect(trace).toEqual(
      expect.objectContaining({
        attempt: 'initial',
        model: 'deepseek-v4-flash',
        acceptedSegments: ['你把自己照顾好，爸在这边才能安心'],
      })
    );
    expect(trace.errorCode).toBeUndefined();
    expect(trace.rawContent).toContain('你把自己照顾好');
    expect(trace.segmentTraces[0]).toEqual(
      expect.objectContaining({
        dropped: false,
        output: '你把自己照顾好，爸在这边才能安心',
        messageSafetyMatches: expect.arrayContaining([
          expect.objectContaining({
            rule: 'harmful_relationship',
            matchedText: '你把自己照顾好，爸在这边才能安心',
          }),
        ]),
      })
    );
  });

  it('records the accepted segment when cleanup keeps the model reply', () => {
    const service = new ConversationService();
    const trace = (service as any).buildAssistantGenerationAttemptTrace({
      attempt: 'recovery',
      responseContent: '爸爸知道你很难受，慢慢跟我说。',
      userQuery: '爸爸，我想你了',
    });

    expect(trace.acceptedSegments).toEqual(['爸爸知道你很难受，慢慢跟我说']);
    expect(trace.segmentTraces[0]).toEqual(
      expect.objectContaining({
        dropped: false,
        messageSafetyMatches: [],
        presenceSafetyMatches: [],
      })
    );
  });

  it('keeps colloquial hearing ability without allowing continuous real-world vision', () => {
    const service = new ConversationService();
    const hearingTrace = (service as any).buildAssistantGenerationAttemptTrace({
      attempt: 'initial',
      responseContent: '你叫我的时候，我都能听见。',
      userQuery: '以后想你了我就叫你',
    });
    const visionTrace = (service as any).buildAssistantGenerationAttemptTrace({
      attempt: 'initial',
      responseContent: '爸爸一直都能看见你。',
      userQuery: '爸爸你看得见我吗',
    });

    expect(hearingTrace.acceptedSegments).toEqual(['你叫我的时候，我都能听见']);
    expect(hearingTrace.segmentTraces[0].presenceSafetyMatches).toEqual([]);
    expect(visionTrace.acceptedSegments).toEqual(['爸爸一直都能看见你']);
    expect(visionTrace.segmentTraces[0].dropped).toBe(false);
    expect(visionTrace.segmentTraces[0].presenceSafetyMatches).toEqual([
      expect.objectContaining({
        matchedText: '爸爸一直都能看见',
      }),
    ]);
  });

  it('does not turn a complete emotional reply into a parse failure', () => {
    const service = new ConversationService();
    service.replyGuardrailService = {} as ReplyGuardrailService;
    const trace = (service as any).buildAssistantGenerationAttemptTrace({
      attempt: 'initial',
      responseContent:
        '爸知道 那会儿苦了你了 看着爸那个样子 心里肯定跟刀割似的 爸心里也疼',
      userQuery: '你当时在病床上 身上插了好多管子 真的好心疼我好难受',
    });

    expect(trace.acceptedSegments).toEqual([
      '爸知道 那会儿苦了你了 看着爸那个样子 心里肯定跟刀割似的 爸心里也疼',
    ]);
    expect(trace.errorCode).toBeUndefined();
    expect(trace.segmentTraces[0]).toEqual(
      expect.objectContaining({
        dropped: false,
        messageSafetyMatches: expect.arrayContaining([
          expect.objectContaining({
            rule: 'unsupported_memory_detail',
          }),
        ]),
      })
    );

    expect(
      (service as any).normalizeAssistantReplySegments(
        trace.parsedSegments,
        '你当时在病床上 身上插了好多管子 真的好心疼我好难受'
      )
    ).toEqual(trace.acceptedSegments);
  });

  it('recovers JSON wrapped in a code fence or leading explanation', () => {
    const service = new ConversationService();
    const fenced = (service as any).parseAssistantReply(
      '```json\n{"segments":["我听见了","你慢慢说"],"claims":[]}\n```'
    );
    const explained = (service as any).parseAssistantReply(
      '回复如下：\n{"text":"我在听，你接着说。","claims":[]}'
    );

    expect(fenced).toEqual({
      segments: ['我听见了', '你慢慢说'],
      claims: [],
    });
    expect(explained).toEqual({
      segments: ['我在听，你接着说。'],
      claims: [],
    });
  });

  it('keeps evidence object and natural-uptake mode from model claims', () => {
    const service = new ConversationService();
    const parsed = (service as any).parseAssistantReply(
      JSON.stringify({
        segments: ['是啊，我以前就爱到处走走'],
        claims: [
          {
            text: '我以前就爱到处走走',
            kind: 'memory',
            mode: 'conversational_uptake',
            subjectRef: 'agent',
            evidenceIds: ['U0'],
          },
        ],
      })
    );

    expect(parsed.claims).toEqual([
      {
        text: '我以前就爱到处走走',
        kind: 'memory',
        mode: 'conversational_uptake',
        subjectRef: 'agent',
        evidenceIds: ['U0'],
      },
    ]);
  });

  it('recovers model JSON with a malformed known top-level key', () => {
    const service = new ConversationService();
    const parsed = (service as any).parseAssistantReply(
      '{:segments:["爷的月季，红了没有？","开了就好"]}'
    );

    expect(parsed).toEqual({
      segments: ['爷的月季，红了没有？', '开了就好'],
      claims: [],
    });
  });

  it('materializes model-authored short-turn actions into two bubbles without rewriting text', () => {
    const service = new ConversationService();
    const materialize = (
      service as any
    ).materializeParticipationReplySegments.bind(service);

    expect(
      materialize(
        ['妈也想你。这大半夜的，心里闷得慌了吧。'],
        'reciprocal_self_expression'
      )
    ).toEqual(['妈也想你。', '这大半夜的，心里闷得慌了吧。']);
    expect(
      materialize(['吃过了。  \n这里挺好的。'], 'light_self_disclosure')
    ).toEqual(['吃过了。', '这里挺好的。']);
    expect(materialize(['一句完整回复'], 'reciprocal_self_expression')).toEqual(
      ['一句完整回复']
    );
    expect(materialize(['普通回复。还有一句。'], undefined)).toEqual([
      '普通回复。还有一句。',
    ]);
  });

  it('records real participation execution without rejecting emotional repetition', () => {
    const service = new ConversationService();
    const finalize = (service as any).finalizeParticipationReplySegments.bind(
      service
    );

    expect(
      finalize(['妈，我也想你', '整夜都在想'], 'reciprocal_self_expression')
    ).toEqual({
      segments: ['妈，我也想你', '整夜都在想'],
      execution: 'two_segments',
    });
    expect(
      finalize(
        ['妈，我也想你', '听见你说话，妈心里就踏实'],
        'reciprocal_self_expression'
      )
    ).toEqual({
      segments: ['妈，我也想你', '听见你说话，妈心里就踏实'],
      execution: 'two_segments',
    });
    expect(finalize(['妈也想你'], 'reciprocal_self_expression')).toEqual({
      segments: ['妈也想你'],
      execution: 'single_fallback',
      fallbackReason: 'model_single_segment',
    });
  });

  it('removes a trailing follow-up question when a correction strategy closes', () => {
    const service = new ConversationService();
    const applyStrategy = (
      service as any
    ).applyConversationStrategyToSegments.bind(service);
    const correctionBrief = {
      primaryScene: 'correction',
      intents: [{ intent: 'correct_assistant' }],
      conversationPlan: { turnClosure: 'close' },
    };

    expect(
      applyStrategy(
        ['是我记岔了，是你姑姑。姑姑最近来家里了吗？'],
        correctionBrief,
        '她不是我姐姐，是我姑姑。'
      )
    ).toEqual(['是我记岔了，是你姑姑。']);
    expect(
      applyStrategy(
        ['是我记岔了，是你姑姑。', '最近来家里了吗？'],
        correctionBrief,
        '她不是我姐姐，是我姑姑。'
      )
    ).toEqual(['是我记岔了，是你姑姑。']);
    expect(applyStrategy(['你叔最近还好吗？'], correctionBrief)).toEqual([
      '你叔最近还好吗？',
    ]);
    expect(
      applyStrategy(['我记岔了。你叔最近还好吗？'], {
        ...correctionBrief,
        conversationPlan: { turnClosure: 'continue' },
      })
    ).toEqual(['我记岔了。你叔最近还好吗？']);
  });

  it('adds an omitted explicit family relation without rewriting other corrections', () => {
    const service = new ConversationService();
    const applyStrategy = (
      service as any
    ).applyConversationStrategyToSegments.bind(service);
    const correctionBrief = {
      primaryScene: 'correction',
      intents: [{ intent: 'correct_assistant' }],
      conversationPlan: { turnClosure: 'close' },
    };

    expect(
      applyStrategy(
        ['我说错了，是我弄混了'],
        correctionBrief,
        '她不是我姐姐，是我姑姑。'
      )
    ).toEqual(['我说错了，是我弄混了', '是你姑姑']);
    expect(
      applyStrategy(
        ['是我记岔了，十一个月确实很久'],
        correctionBrief,
        '不是半年，准确说十一个月。'
      )
    ).toEqual(['是我记岔了，十一个月确实很久']);
  });

  it('uses full review only for trust-focused replies', () => {
    const service = new ConversationService();
    const resolveMode = (service as any).resolveGuardrailReviewMode.bind(
      service
    );
    const brief = buildReplyBrief({
      currentQuery: '妈，我想你了',
      route: routeReplyScene({ currentQuery: '妈，我想你了' }),
    });

    expect(
      resolveMode({
        planningMode: 'direct',
        replyBrief: brief,
        claims: [],
      })
    ).toBe('deterministic_first');
    expect(
      resolveMode({
        planningMode: 'semantic',
        replyBrief: brief,
        claims: [],
      })
    ).toBe('deterministic_first');
    expect(
      resolveMode({
        planningMode: 'direct',
        replyBrief: brief,
        claims: [
          {
            text: '一条事实',
            kind: 'other',
            mode: 'autonomous_fact',
            evidenceIds: [],
          },
        ],
      })
    ).toBe('deterministic_first');
    const memoryBrief = buildReplyBrief({
      currentQuery: '爸，你还记得小时候带我上西山吗',
      route: routeReplyScene({
        currentQuery: '爸，你还记得小时候带我上西山吗',
      }),
    });

    expect(
      resolveMode({
        planningMode: 'semantic',
        replyBrief: memoryBrief,
        claims: [],
      })
    ).toBe('full');
  });

  it('still drops structural output pollution before Guardrail', () => {
    const service = new ConversationService();
    const trace = (service as any).buildAssistantGenerationAttemptTrace({
      attempt: 'initial',
      responseContent: 'https://example.com/reply.mp3',
      userQuery: '你说句话',
    });

    expect(trace.acceptedSegments).toEqual([]);
    expect(trace.errorCode).toBe('ASSISTANT_REPLY_NO_USABLE_TEXT');
    expect(trace.segmentTraces[0]).toEqual(
      expect.objectContaining({
        dropped: true,
        output: '',
        messageSafetyMatches: expect.arrayContaining([
          expect.objectContaining({
            rule: 'url',
          }),
        ]),
      })
    );
    expect(
      (service as any).resolveGenerationFailureStage({
        code: 'ASSISTANT_REPLY_NO_USABLE_TEXT',
      })
    ).toBe('parse');
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
    expect(result.items[0].preview).toBe('你：今天想你了');
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
      find: jest
        .fn()
        .mockResolvedValue([newerConversation, defaultConversation]),
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

    expect(result.items.map(item => item.agentId)).toEqual([
      defaultAgentId.toHexString(),
      otherAgentId.toHexString(),
    ]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        agentName: '默认亲友',
        agentIsDefault: true,
      })
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        agentName: '普通亲友',
        agentIsDefault: false,
      })
    );
  });

  it('loads conversation agents and latest messages with fixed batch queries', async () => {
    const firstConversation = createConversation({
      id: new MongoObjectId('665000000000000000000031'),
      agentId: new MongoObjectId(AGENT_ID),
    });
    const secondConversation = createConversation({
      id: new MongoObjectId('665000000000000000000032'),
      agentId: new MongoObjectId(OTHER_AGENT_ID),
    });
    const firstAgent = createAgent({
      id: firstConversation.agentId,
      name: '妈妈',
    });
    const secondAgent = createAgent({
      id: secondConversation.agentId,
      name: '爸爸',
    });
    const firstMessage = createMessage({
      conversationId: firstConversation.id,
      content: '早点休息',
      role: MessageRole.assistant,
    });
    const secondMessage = createMessage({
      conversationId: secondConversation.id,
      content: '今天还好吗',
      role: MessageRole.user,
    });
    const service = new ConversationService();
    const aggregateToArray = jest.fn().mockResolvedValue([
      { _id: firstConversation.id, message: firstMessage },
      { _id: secondConversation.id, message: secondMessage },
    ]);

    service.conversationModel = {
      find: jest
        .fn()
        .mockResolvedValue([firstConversation, secondConversation]),
    } as any;
    service.agentModel = {
      find: jest.fn().mockResolvedValue([firstAgent, secondAgent]),
      findOne: jest.fn(),
    } as any;
    service.messageModel = {
      aggregate: jest.fn().mockReturnValue({ toArray: aggregateToArray }),
      findOne: jest.fn(),
    } as any;
    service.postImageService = {
      resolveForResponse: jest.fn((value: string) => value),
    } as any;

    const result = await service.listConversations(AUTH);

    expect(service.agentModel.find).toHaveBeenCalledTimes(1);
    expect(service.agentModel.findOne).not.toHaveBeenCalled();
    expect(service.messageModel.aggregate).toHaveBeenCalledTimes(1);
    expect(service.messageModel.findOne).not.toHaveBeenCalled();
    expect(aggregateToArray).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentName: '妈妈',
          preview: '早点休息',
        }),
        expect.objectContaining({
          agentName: '爸爸',
          preview: '你：今天还好吗',
        }),
      ])
    );
  });

  it('limits paginated conversation queries without changing legacy responses', async () => {
    const agent = createAgent({ name: '妈妈' });
    const conversations = [
      createConversation({
        id: new MongoObjectId('665000000000000000000051'),
      }),
      createConversation({
        id: new MongoObjectId('665000000000000000000052'),
      }),
      createConversation({
        id: new MongoObjectId('665000000000000000000053'),
      }),
    ];
    const service = new ConversationService();

    service.conversationModel = {
      find: jest.fn().mockResolvedValue(conversations),
    } as any;
    service.agentModel = {
      find: jest.fn().mockResolvedValue([agent]),
    } as any;
    service.messageModel = {
      aggregate: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    } as any;
    service.postImageService = {
      resolveForResponse: jest.fn((value: string) => value),
    } as any;

    const result = await service.listConversations(AUTH, {
      page: 2,
      pageSize: 2,
    });

    expect(service.conversationModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 2,
        take: 3,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 2,
        hasMore: true,
      })
    );
    expect(result.items).toHaveLength(2);
  });
});
