import { AgentEntity, ConversationEntity, MongoObjectId } from '@tzl/entities';
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

    const conversation = await service.ensureMessengerConversation(parent, messenger);

    expect(conversation.agentId).toEqual(messenger.id);
    expect(conversation.userId).toEqual(parent.createdUserId);
    expect(conversation.accessRole).toBe('owner');
    expect(messageModel.save).toHaveBeenCalled();
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
    messageModel.count.mockResolvedValue(1);
    const draft = {
      lifeExperience: '做过老师',
      personalityTraits: '很温和',
      languageHabits: '常说慢慢来',
      hobbies: '种花',
      sharedMemories: '一起包饺子',
    };
    buildInterviewTurn.mockResolvedValue({
      reply: '我记住了，还有别的想告诉我吗？',
      draft,
      coveredFields: ['lifeExperience'],
      nextFocusField: '',
      isComplete: true,
    });
    alignManualProfileEdits.mockImplementation(async ({ agent: value }) => value);

    const reply = await service.runInterviewTurn({
      agent: parent,
      conversation,
      input: '她以前做过老师',
    });

    expect(reply).toBe('我记住了，还有别的想告诉我吗？');
    expect(parent.lifeExperience).toBe('做过老师');
    expect(alignManualProfileEdits).toHaveBeenCalledWith({
      agent: parent,
      userId: parent.createdUserId,
      sources: draft,
    });
  });
});
