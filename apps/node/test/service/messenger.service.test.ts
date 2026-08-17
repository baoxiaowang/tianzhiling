import {
  AgentEntity,
  ConversationEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';
import {
  MESSENGER_DEFAULT_AVATAR_KEY,
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
  const buildInterviewTurn = jest.fn();
  const alignManualProfileEdits = jest.fn();
  const agentMemoryProfileService = {
    buildInterviewTurn,
    alignManualProfileEdits,
  };

  service.agentModel = agentModel as never;
  service.conversationModel = conversationModel as never;
  service.messageModel = messageModel as never;
  service.agentMemoryProfileService = agentMemoryProfileService as never;

  return {
    service,
    agentModel,
    conversationModel,
    messageModel,
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
        content: '你好，我是妈妈的小使者。关于妈妈的事，都可以慢慢跟我讲。',
      }),
      expect.objectContaining({
        content: '你最想先让我了解妈妈的哪一面？',
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
          content: expect.stringContaining('你最想先让我了解妈妈的哪一面'),
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

  it.each(['？', '我不知道说什么'])(
    'does not extract or save a low-information turn: %s',
    async input => {
      const {
        service,
        messageModel,
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
    }
  );

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
});
