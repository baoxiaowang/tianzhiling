import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessengerCallStatus,
  MongoObjectId,
} from '@tzl/entities';
import {
  MESSENGER_DEFAULT_AVATAR_KEY,
  MESSENGER_REVEAL_USER_TURN_THRESHOLD,
  MessengerService,
} from '../../src/service/agents/messenger.service';

function createService() {
  const service = new MessengerService();
  const agentModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };
  const conversationModel = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const messageModel = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    save: jest.fn(),
  };
  const messengerCallEventModel = {
    save: jest.fn().mockImplementation(async value => value),
  };
  const buildInterviewTurn = jest.fn();
  const alignManualProfileEdits = jest.fn();
  const agentMemoryProfileService = {
    buildInterviewTurn,
    alignManualProfileEdits,
  };

  service.agentModel = agentModel as never;
  service.conversationModel = conversationModel as never;
  service.messageModel = messageModel as never;
  service.messengerCallEventModel = messengerCallEventModel as never;
  service.agentMemoryProfileService = agentMemoryProfileService as never;
  service.redisService = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    del: jest.fn().mockResolvedValue(1),
  } as never;
  service.logger = { warn: jest.fn() } as never;

  return {
    service,
    agentModel,
    conversationModel,
    messageModel,
    messengerCallEventModel,
    buildInterviewTurn,
    alignManualProfileEdits,
  };
}

function buildAgent(overrides: Partial<AgentEntity> = {}): AgentEntity {
  return {
    id: new MongoObjectId(),
    createdUserId: new MongoObjectId(),
    name: '妈妈',
    sex: 0,
    lifeExperience: '',
    personalityTraits: '',
    languageHabits: '',
    hobbies: '',
    sharedMemories: '',
    updatedAt: new Date(),
    ...overrides,
  } as AgentEntity;
}

describe('MessengerService', () => {
  it('builds a per-relative messenger name', () => {
    const { service } = createService();
    expect(service.buildMessengerName('妈妈')).toBe('妈妈的小使者');
  });

  it('provisions a real messenger agent for an agent', async () => {
    const { service, agentModel } = createService();
    const parent = buildAgent();
    agentModel.findOne.mockResolvedValue(null);
    agentModel.save.mockImplementation(async value => value);

    const messenger = await service.ensureMessengerForAgent(parent);

    expect(messenger.name).toBe('妈妈的小使者');
    expect(messenger.avatar).toBe(MESSENGER_DEFAULT_AVATAR_KEY);
    expect(messenger.messengerOfAgentId).toEqual(parent.id);
    expect(messenger.status).toBe(1);
    expect(messenger.isDefault).toBe(false);
    expect(messenger.createdUserId).toEqual(parent.createdUserId);
  });

  it('reuses an existing messenger agent', async () => {
    const { service, agentModel } = createService();
    const parent = buildAgent();
    const existing = buildAgent({
      name: '妈妈的小使者',
      avatar: MESSENGER_DEFAULT_AVATAR_KEY,
      iCallAgent: '妈妈的小使者',
      messengerOfAgentId: parent.id,
    });
    agentModel.findOne.mockResolvedValue(existing);

    const messenger = await service.ensureMessengerForAgent(parent);

    expect(messenger).toBe(existing);
    expect(agentModel.save).not.toHaveBeenCalled();
  });

  it('keeps messenger name and avatar canonical when the parent is renamed', async () => {
    const { service, agentModel } = createService();
    const parent = buildAgent({ name: '妈妈' });
    const existing = buildAgent({
      name: '旧名字的小使者',
      avatar: '',
      iCallAgent: '旧名字的小使者',
      messengerOfAgentId: parent.id,
    });
    agentModel.findOne.mockResolvedValue(existing);
    agentModel.save.mockImplementation(async value => value);

    const messenger = await service.ensureMessengerForAgent(parent);

    expect(messenger.name).toBe('妈妈的小使者');
    expect(messenger.avatar).toBe(MESSENGER_DEFAULT_AVATAR_KEY);
    expect(agentModel.save).toHaveBeenCalled();
  });

  it('creates a messenger conversation and greeting', async () => {
    const { service, conversationModel, messageModel } = createService();
    const parent = buildAgent();
    const messenger = buildAgent({
      name: '妈妈的小使者',
      messengerOfAgentId: parent.id,
    });
    conversationModel.findOne.mockResolvedValue(null);
    conversationModel.save.mockImplementation(async value => value);
    messageModel.save.mockImplementation(async value => value);

    const conversation = await service.ensureMessengerConversation(
      parent,
      messenger
    );

    expect(conversation.agentId).toEqual(messenger.id);
    expect(conversation.userId).toEqual(parent.createdUserId);
    expect(conversation.accessRole).toBe('owner');
    expect(messageModel.save).toHaveBeenCalledWith([
      expect.objectContaining({
        content: '你好，我是妈妈的小使者，可以帮妈妈找回记忆。',
      }),
      expect.objectContaining({
        content: '你最想让妈妈想起来的是？',
      }),
    ]);
  });

  it('repairs an existing empty messenger conversation with the greeting', async () => {
    const { service, conversationModel, messageModel } = createService();
    const parent = buildAgent();
    const messenger = buildAgent({
      name: '妈妈的小使者',
      messengerOfAgentId: parent.id,
    });
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.agentId = messenger.id;
    conversation.userId = parent.createdUserId;
    conversationModel.findOne.mockResolvedValue(conversation);
    messageModel.findOne.mockResolvedValue(null);
    messageModel.save.mockImplementation(async value => value);

    const result = await service.ensureMessengerConversation(parent, messenger);

    expect(result).toBe(conversation);
    expect(conversationModel.save).not.toHaveBeenCalled();
    expect(messageModel.findOne).toHaveBeenCalledWith({
      where: { conversationId: conversation.id },
    });
    expect(messageModel.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          content: '你最想让妈妈想起来的是？',
        }),
      ])
    );
  });

  it('does not duplicate greetings in a messenger conversation with messages', async () => {
    const { service, conversationModel, messageModel } = createService();
    const parent = buildAgent();
    const messenger = buildAgent({
      name: '妈妈的小使者',
      messengerOfAgentId: parent.id,
    });
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.agentId = messenger.id;
    conversation.userId = parent.createdUserId;
    conversationModel.findOne.mockResolvedValue(conversation);
    messageModel.findOne.mockResolvedValue({ id: new MongoObjectId() });

    const result = await service.ensureMessengerConversation(parent, messenger);

    expect(result).toBe(conversation);
    expect(messageModel.save).not.toHaveBeenCalled();
  });

  it('provisions messengers for every non-messenger agent of a user', async () => {
    const { service, agentModel, conversationModel, messageModel } =
      createService();
    const userId = new MongoObjectId();
    const firstParent = buildAgent({ createdUserId: userId, name: '妈妈' });
    const secondParent = buildAgent({ createdUserId: userId, name: '爸爸' });
    agentModel.find.mockResolvedValue([firstParent, secondParent]);
    agentModel.findOne.mockResolvedValue(null);
    conversationModel.findOne.mockResolvedValue(null);
    agentModel.save.mockImplementation(async value => ({
      ...value,
      id: value.id ?? new MongoObjectId(),
    }));
    conversationModel.save.mockImplementation(async value => ({
      ...value,
      id: value.id ?? new MongoObjectId(),
    }));
    messageModel.save.mockImplementation(async value => value);

    const result = await service.ensureMessengersForUser(userId);

    expect(result).toEqual({
      processed: 2,
      messengersCreated: 2,
      conversationsCreated: 2,
    });
    expect(agentModel.find).toHaveBeenCalledWith({
      where: {
        createdUserId: userId,
        messengerOfAgentId: { $exists: false },
      },
    });
  });

  it('reveals a silent messenger after ten live user turns', async () => {
    const { service, agentModel, conversationModel, messageModel } =
      createService();
    const now = new Date('2026-08-18T12:00:00.000Z');
    const userId = new MongoObjectId();
    const parent = buildAgent({
      createdUserId: userId,
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    });
    const messenger = buildAgent({
      createdUserId: userId,
      name: '妈妈的小使者',
      messengerOfAgentId: parent.id,
    });
    agentModel.find.mockResolvedValue([messenger]);
    agentModel.findOne.mockResolvedValue(parent);
    conversationModel.findOne.mockResolvedValue(null);
    conversationModel.save.mockImplementation(async value => value);
    messageModel.count.mockResolvedValue(MESSENGER_REVEAL_USER_TURN_THRESHOLD);
    messageModel.save.mockImplementation(async value => value);

    const result = await service.revealEligibleMessengersForUser(userId, now);

    expect(messageModel.count).toHaveBeenCalledWith({
      userId,
      agentId: parent.id,
      role: MessageRole.user,
      status: 'sent',
      source: { $ne: 'wechat_import' },
      isArchived: { $ne: true },
    });
    expect(conversationModel.save).toHaveBeenCalled();
    expect(result).toEqual({
      processed: 1,
      alreadyVisible: 0,
      revealed: 1,
      revealedByTurns: 1,
      revealedByAge: 0,
    });
  });

  it('reveals a silent messenger after 24 hours without counting turns', async () => {
    const { service, agentModel, conversationModel, messageModel } =
      createService();
    const now = new Date('2026-08-18T12:00:00.000Z');
    const userId = new MongoObjectId();
    const parent = buildAgent({
      createdUserId: userId,
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
    const messenger = buildAgent({
      createdUserId: userId,
      messengerOfAgentId: parent.id,
    });
    agentModel.find.mockResolvedValue([messenger]);
    agentModel.findOne.mockResolvedValue(parent);
    conversationModel.findOne.mockResolvedValue(null);
    conversationModel.save.mockImplementation(async value => value);
    messageModel.save.mockImplementation(async value => value);

    const result = await service.revealEligibleMessengersForUser(userId, now);

    expect(messageModel.count).not.toHaveBeenCalled();
    expect(conversationModel.save).toHaveBeenCalled();
    expect(result.revealedByAge).toBe(1);
  });

  it('keeps a silent messenger hidden before either reveal condition', async () => {
    const { service, agentModel, conversationModel, messageModel } =
      createService();
    const now = new Date('2026-08-18T12:00:00.000Z');
    const userId = new MongoObjectId();
    const parent = buildAgent({
      createdUserId: userId,
      createdAt: new Date(now.getTime() - 23 * 60 * 60 * 1000),
    });
    const messenger = buildAgent({
      createdUserId: userId,
      messengerOfAgentId: parent.id,
    });
    agentModel.find.mockResolvedValue([messenger]);
    agentModel.findOne.mockResolvedValue(parent);
    conversationModel.findOne.mockResolvedValue(null);
    messageModel.count.mockResolvedValue(
      MESSENGER_REVEAL_USER_TURN_THRESHOLD - 1
    );

    const result = await service.revealEligibleMessengersForUser(userId, now);

    expect(conversationModel.save).not.toHaveBeenCalled();
    expect(result.revealed).toBe(0);
  });

  it('runs an interview turn and persists the draft to the parent agent', async () => {
    const {
      service,
      messageModel,
      buildInterviewTurn,
      alignManualProfileEdits,
    } = createService();
    const parent = buildAgent();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.agentId = new MongoObjectId();
    conversation.userId = parent.createdUserId;
    const sourceMessageId = new MongoObjectId();
    messageModel.count.mockResolvedValue(1);
    messageModel.find.mockResolvedValue([
      {
        id: sourceMessageId,
        role: MessageRole.user,
        content: '她以前做过老师',
      },
      {
        role: MessageRole.assistant,
        content: '妈妈平时怎么说话，有没有常说的一句话？',
      },
      {
        role: MessageRole.assistant,
        content: '一想到妈妈，你最先想起 TA 怎样的性格？',
      },
    ]);
    const draft = {
      lifeExperience: '做过老师',
      personalityTraits: '很温和',
      languageHabits: '常说慢慢来',
      hobbies: '种花',
      sharedMemories: '一起包饺子',
    };
    buildInterviewTurn.mockResolvedValue({
      reply: '听得出来，她把很多温柔留在了这些小事里。',
      draft,
      coveredFields: ['lifeExperience'],
      nextFocusField: '',
      isComplete: true,
    });
    alignManualProfileEdits.mockImplementation(
      async ({ agent: value }) => value
    );

    const reply = await service.runInterviewTurn({
      agent: parent,
      conversation,
      input: '她以前做过老师',
    });

    expect(reply).toBe('听得出来，她把很多温柔留在了这些小事里。');
    expect(parent.lifeExperience).toBe('做过老师');
    expect(buildInterviewTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        focusField: 'languageHabits',
        askedFields: ['languageHabits', 'personalityTraits'],
        previousReplies: [
          '妈妈平时怎么说话，有没有常说的一句话？',
          '一想到妈妈，你最先想起 TA 怎样的性格？',
        ],
      })
    );
    expect(alignManualProfileEdits).toHaveBeenCalledWith({
      agent: parent,
      userId: parent.createdUserId,
      sources: draft,
      sourceMessageId,
      sourceText: '她以前做过老师',
    });
  });

  it('asks for the concrete phrase after a bare yes instead of advancing fields', async () => {
    const {
      service,
      messageModel,
      buildInterviewTurn,
      messengerCallEventModel,
    } = createService();
    const parent = buildAgent({ name: '爸爸' });
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.agentId = new MongoObjectId();
    conversation.userId = parent.createdUserId;
    messageModel.find.mockResolvedValue([
      {
        id: new MongoObjectId(),
        role: MessageRole.user,
        content: '有',
      },
      {
        role: MessageRole.assistant,
        content: '爸爸平时怎么说话，有没有常说的一句话？',
      },
    ]);

    const reply = await service.runInterviewTurn({
      agent: parent,
      conversation,
      input: '有',
    });

    expect(reply).toBe('有的话，爸爸最常说的是哪一句？');
    expect(buildInterviewTurn).not.toHaveBeenCalled();
    expect(messengerCallEventModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        skipReason: 'short_context_reply',
        profileSaved: false,
      })
    );
  });

  it('does not enter another confirmation loop for a bare confirmation', async () => {
    const { service, messageModel, buildInterviewTurn } = createService();
    const parent = buildAgent({ name: '爸爸' });
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    messageModel.find.mockResolvedValue([
      {
        id: new MongoObjectId(),
        role: MessageRole.user,
        content: '对',
      },
      {
        role: MessageRole.assistant,
        content: '你是想通过照片和爸爸通话吗？',
      },
    ]);

    const reply = await service.runInterviewTurn({
      agent: parent,
      conversation,
      input: '对',
    });

    expect(reply).toContain('明白，我接着听');
    expect(reply).not.toContain('确认');
    expect(buildInterviewTurn).not.toHaveBeenCalled();
  });

  it.each([
    ['我想他了他在哪边过的好不好呀', '不能确认那边的真实情况'],
    ['抖音上用照片可以通话吗', '不能用照片复活或视频通话'],
  ])(
    'answers the current capability question directly: %s',
    async (input, expected) => {
      const { service, messageModel, buildInterviewTurn } = createService();
      const parent = buildAgent({ name: '爸爸' });
      const conversation = new ConversationEntity();
      conversation.id = new MongoObjectId();
      messageModel.find.mockResolvedValue([
        {
          id: new MongoObjectId(),
          role: MessageRole.user,
          content: input,
        },
      ]);

      const reply = await service.runInterviewTurn({
        agent: parent,
        conversation,
        input,
      });

      expect(reply).toContain(expected);
      expect(buildInterviewTurn).not.toHaveBeenCalled();
    }
  );

  it('records dedicated model, token, latency, and profile-save telemetry', async () => {
    const {
      service,
      messageModel,
      messengerCallEventModel,
      buildInterviewTurn,
      alignManualProfileEdits,
    } = createService();
    const parent = buildAgent();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.agentId = new MongoObjectId();
    conversation.userId = parent.createdUserId;
    const sourceMessageId = new MongoObjectId();
    messageModel.find.mockResolvedValue([
      {
        id: sourceMessageId,
        role: MessageRole.user,
        content: '爸爸喜欢下棋',
      },
    ]);
    buildInterviewTurn.mockImplementation(async options => {
      options.onTelemetry({
        modelCalled: true,
        modelSucceeded: true,
        fallbackUsed: false,
        model: 'MiniMax-M2.1',
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
      });
      return {
        reply: '下棋是爸爸很鲜活的一面。',
        draft: {
          lifeExperience: '',
          personalityTraits: '',
          languageHabits: '',
          hobbies: '喜欢下棋',
          sharedMemories: '',
        },
        coveredFields: ['hobbies'],
        nextFocusField: '',
        isComplete: false,
      };
    });
    alignManualProfileEdits.mockImplementation(async ({ agent }) => agent);
    const previousReleaseVersion = process.env.RELEASE_VERSION;
    process.env.RELEASE_VERSION = '0123456789abcdef0123456789abcdef01234567';

    try {
      await service.runInterviewTurn({
        agent: parent,
        conversation,
        input: '爸爸喜欢下棋',
      });
    } finally {
      if (previousReleaseVersion === undefined) {
        delete process.env.RELEASE_VERSION;
      } else {
        process.env.RELEASE_VERSION = previousReleaseVersion;
      }
    }

    expect(messengerCallEventModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: parent.createdUserId,
        conversationId: conversation.id,
        messengerAgentId: conversation.agentId,
        parentAgentId: parent.id,
        sourceMessageId,
        status: MessengerCallStatus.completed,
        modelCalled: true,
        modelSucceeded: true,
        fallbackUsed: false,
        model: 'MiniMax-M2.1',
        promptTokens: 120,
        completionTokens: 30,
        totalTokens: 150,
        profileSaved: true,
        changedProfileFields: ['hobbies'],
        releaseVersion: '0123456789abcdef0123456789abcdef01234567',
      })
    );
  });

  it.each(['？', '我不知道说什么'])(
    'does not extract or save a low-information turn: %s',
    async input => {
      const {
        service,
        messageModel,
        messengerCallEventModel,
        buildInterviewTurn,
        alignManualProfileEdits,
      } = createService();
      const updatedAt = new Date('2026-08-17T09:00:00.000Z');
      const parent = buildAgent({ name: '爸比', updatedAt });
      const conversation = new ConversationEntity();
      conversation.id = new MongoObjectId();
      messageModel.find.mockResolvedValue([]);

      const reply = await service.runInterviewTurn({
        agent: parent,
        conversation,
        input,
      });

      expect(reply).not.toContain('记住');
      expect(buildInterviewTurn).not.toHaveBeenCalled();
      expect(alignManualProfileEdits).not.toHaveBeenCalled();
      expect(parent.updatedAt).toBe(updatedAt);
      expect(messengerCallEventModel.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MessengerCallStatus.skipped,
          skipReason: 'low_information',
          modelCalled: false,
          profileSaved: false,
        })
      );
    }
  );

  it('does not break chat when telemetry persistence fails', async () => {
    const { service, messengerCallEventModel, buildInterviewTurn } =
      createService();
    const parent = buildAgent();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.agentId = new MongoObjectId();
    conversation.userId = parent.createdUserId;
    buildInterviewTurn.mockResolvedValue({
      reply: '我在认真听。',
      draft: {
        lifeExperience: '',
        personalityTraits: '',
        languageHabits: '',
        hobbies: '',
        sharedMemories: '',
      },
      coveredFields: [],
      nextFocusField: '',
      isComplete: false,
    });
    messengerCallEventModel.save.mockRejectedValue(new Error('mongo down'));

    await expect(
      service.runInterviewTurn({
        agent: parent,
        conversation,
        input: '我想慢慢说说爸爸',
      })
    ).resolves.toBe('我在认真听。');
  });

  it('does not resave profile memory when the extracted draft is unchanged', async () => {
    const { service, buildInterviewTurn, alignManualProfileEdits } =
      createService();
    const updatedAt = new Date('2026-08-17T09:00:00.000Z');
    const parent = buildAgent({
      updatedAt,
      lifeExperience: '卖花',
      personalityTraits: '有责任心',
      languageHabits: '天津人',
      hobbies: '爬山',
      sharedMemories: '考试时会给女儿剪指甲',
    });
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    const draft = {
      lifeExperience: parent.lifeExperience,
      personalityTraits: parent.personalityTraits,
      languageHabits: parent.languageHabits,
      hobbies: parent.hobbies,
      sharedMemories: parent.sharedMemories,
    };
    buildInterviewTurn.mockResolvedValue({
      reply: '我在认真听，你可以继续慢慢说。',
      draft,
      coveredFields: [],
      nextFocusField: '',
      isComplete: true,
    });

    await service.runInterviewTurn({
      agent: parent,
      conversation,
      input: '嗯',
    });

    expect(alignManualProfileEdits).not.toHaveBeenCalled();
    expect(parent.updatedAt).toBe(updatedAt);
  });

  describe('sendEventNotice', () => {
    function buildNoticeService() {
      const service = new MessengerService();
      const parent = buildAgent({
        iCallAgent: '爸爸',
      });
      const messenger = buildAgent({
        name: '妈妈的小使者',
        messengerOfAgentId: parent.id,
      });
      const conversation = new ConversationEntity();
      conversation.id = new MongoObjectId();
      conversation.agentId = messenger.id;
      conversation.userId = parent.createdUserId;

      const agentModel = {
        findOne: jest.fn().mockResolvedValue(messenger),
        find: jest.fn().mockResolvedValue([parent]),
        save: jest.fn().mockImplementation(async entity => entity),
      };
      const conversationModel = {
        findOne: jest.fn().mockResolvedValue(conversation),
        save: jest.fn(),
      };
      const messageModel = {
        findOne: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
        save: jest.fn().mockImplementation(async msgs => msgs),
      };
      const openAIService = {
        generateText: jest.fn().mockRejectedValue(new Error('model down')),
      };
      const redisService = {
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
      };

      service.agentModel = agentModel as never;
      service.conversationModel = conversationModel as never;
      service.messageModel = messageModel as never;
      service.messengerCallEventModel = {
        save: jest.fn(),
      } as never;
      service.agentMemoryProfileService = {
        buildInterviewTurn: jest.fn(),
        alignManualProfileEdits: jest.fn(),
      } as never;
      service.openAIService = openAIService as never;
      service.redisService = redisService as never;
      service.logger = {
        info: jest.fn(),
        warn: jest.fn(),
      } as never;

      return {
        service,
        agentModel,
        conversationModel,
        messageModel,
        openAIService,
        redisService,
        parent,
        messenger,
        conversation,
      };
    }

    it('基础版购买：模型失败时回退固定模板，非首次不自我介绍，称呼替换为 relationToThem', async () => {
      const { service, messageModel, parent } = buildNoticeService();

      const result = await service.sendEventNotice({
        eventType: 'membership_purchase',
        userId: parent.createdUserId,
        orderId: 'order-1',
      });

      expect(result.skippedDuplicate).toBe(false);
      expect(result.sentConversations).toBe(1);
      expect(messageModel.save).toHaveBeenCalledTimes(1);
      const saved = messageModel.save.mock.calls[0][0] as MessageEntity[];
      expect(saved.length).toBe(1);
      expect(saved[0].content).toContain('爸爸');
      expect(saved[0].content).not.toContain('我是');
      expect(saved[0].traceId).toContain('event_notice:membership_purchase:order-1');
    });

    it('声音版购买：追加客服二维码图片消息', async () => {
      const { service, messageModel, parent } = buildNoticeService();

      await service.sendEventNotice({
        eventType: 'voice_purchase',
        userId: parent.createdUserId,
        orderId: 'order-2',
      });

      const saved = messageModel.save.mock.calls[0][0] as MessageEntity[];
      const imageMessage = saved.find(m => m.type === 'image');
      expect(saved.length).toBeGreaterThan(1);
      expect(imageMessage).toBeDefined();
      expect(imageMessage?.mediaUrl).toContain('https://oss.tianzhiling.chat');
    });

    it('声音服务购买（普通话/方言模型）：fallback 说明人工声音服务并引导添加客服微信，非首次不自我介绍', async () => {
      const { service, messageModel, parent } = buildNoticeService();

      await service.sendEventNotice({
        eventType: 'voice_package_purchase',
        userId: parent.createdUserId,
        orderId: 'order-6',
        planName: '普通话模型',
      });

      const saved = messageModel.save.mock.calls[0][0] as MessageEntity[];
      const imageMessage = saved.find(m => m.type === 'image');
      const joined = saved.map(m => m.content || '').join('\n');
      expect(imageMessage).toBeDefined();
      expect(imageMessage?.mediaUrl).toContain('https://oss.tianzhiling.chat');
      expect(joined).toContain('爸爸');
      expect(joined).toContain('人工');
      expect(joined).toContain('客服微信');
      expect(joined).toContain('素材');
      expect(joined).not.toContain('我是');
    });

    it('降级退款：fallback 含温和话术与退款说明，且不带推销/承诺', async () => {
      const { service, messageModel, parent } = buildNoticeService();

      await service.sendEventNotice({
        eventType: 'membership_downgrade',
        userId: parent.createdUserId,
        orderId: 'order-3',
        refundAmount: 3000,
      });

      const saved = messageModel.save.mock.calls[0][0] as MessageEntity[];
      const joined = saved.map(m => m.content || '').join('\n');
      expect(joined).toContain('爸爸');
      expect(joined).toContain('调整为基础版');
      expect(joined).toContain('AI 技术发展很快');
      expect(joined).not.toMatch(/100%|完全一致|立即购买/);
    });

    it('模型生成成功时使用模型输出并做护栏替换', async () => {
      const {
        service,
        messageModel,
        openAIService,
        parent,
      } = buildNoticeService();
      openAIService.generateText.mockResolvedValue({
        content:
          '["你的会员已经开通好了，以后和{{relation}}聊天不再限额度。","有需要随时找我。"]',
        reasoning: [],
        response: {},
      });

      await service.sendEventNotice({
        eventType: 'membership_purchase',
        userId: parent.createdUserId,
        orderId: 'order-4',
      });

      const saved = messageModel.save.mock.calls[0][0] as MessageEntity[];
      expect(saved.length).toBe(2);
      expect(saved[0].content).toContain('爸爸');
      expect(saved[0].content).not.toContain('{{');
    });

    it('幂等：redis 已占用时跳过且不写消息', async () => {
      const {
        service,
        redisService,
        messageModel,
        parent,
      } = buildNoticeService();
      redisService.set.mockResolvedValue(null);

      const result = await service.sendEventNotice({
        eventType: 'membership_purchase',
        userId: parent.createdUserId,
        orderId: 'order-5',
      });

      expect(result.skippedDuplicate).toBe(true);
      expect(messageModel.save).not.toHaveBeenCalled();
    });
  });
});
