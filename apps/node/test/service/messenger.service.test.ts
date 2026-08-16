import { AgentEntity, AgentSubEntity, ConversationEntity, MongoObjectId } from '@tzl/entities';
import {
  AGENT_SUB_KIND_MESSENGER,
  AGENT_SUB_STATUS_ACTIVE,
  MessengerService,
} from '../../src/service/agents/messenger.service';

function createService() {
  const service = new MessengerService();
  const agentSubModel = {
    findOne: jest.fn(),
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

  service.agentSubModel = agentSubModel as never;
  service.conversationModel = conversationModel as never;
  service.messageModel = messageModel as never;
  service.agentMemoryProfileService = agentMemoryProfileService as never;

  return {
    service,
    agentSubModel,
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

  it('provisions a messenger sub-agent for an agent', async () => {
    const { service, agentSubModel } = createService();
    const agent = buildAgent();
    agentSubModel.findOne.mockResolvedValue(null);
    agentSubModel.save.mockImplementation(async value => value);

    const messenger = await service.ensureMessengerForAgent(agent);

    expect(messenger.kind).toBe(AGENT_SUB_KIND_MESSENGER);
    expect(messenger.name).toBe('妈妈的小使者');
    expect(messenger.status).toBe(AGENT_SUB_STATUS_ACTIVE);
  });

  it('reuses an existing messenger sub-agent', async () => {
    const { service, agentSubModel } = createService();
    const agent = buildAgent();
    const existing = new AgentSubEntity();
    existing.agentId = agent.id;
    existing.kind = AGENT_SUB_KIND_MESSENGER;
    existing.name = '妈妈的小使者';
    agentSubModel.findOne.mockResolvedValue(existing);

    const messenger = await service.ensureMessengerForAgent(agent);

    expect(messenger).toBe(existing);
    expect(agentSubModel.save).not.toHaveBeenCalled();
  });

  it('creates a messenger conversation and greeting', async () => {
    const { service, conversationModel, messageModel } = createService();
    const agent = buildAgent();
    const messenger = new AgentSubEntity();
    messenger.agentId = agent.id;
    messenger.id = new MongoObjectId();
    messenger.kind = AGENT_SUB_KIND_MESSENGER;
    messenger.name = '妈妈的小使者';
    conversationModel.findOne.mockResolvedValue(null);
    conversationModel.save.mockImplementation(async value => value);
    messageModel.save.mockImplementation(async value => value);

    const conversation = await service.ensureMessengerConversation(agent, messenger);

    expect(conversation.subAgentId).toEqual(messenger.id);
    expect(conversation.agentId).toEqual(agent.id);
    expect(conversation.accessRole).toBe('owner');
    expect(messageModel.save).toHaveBeenCalled();
  });

  it('returns null when a conversation has no messenger', async () => {
    const { service, agentSubModel } = createService();
    const conversation = new ConversationEntity();
    conversation.agentId = new MongoObjectId();

    await expect(service.resolveMessengerForConversation(conversation)).resolves.toBeNull();
    expect(agentSubModel.findOne).not.toHaveBeenCalled();
  });

  it('runs an interview turn and persists the draft to the parent agent', async () => {
    const {
      service,
      messageModel,
      buildInterviewTurn,
      alignManualProfileEdits,
    } = createService();
    const agent = buildAgent();
    const conversation = new ConversationEntity();
    conversation.id = new MongoObjectId();
    conversation.agentId = agent.id;
    conversation.userId = agent.createdUserId;
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
      agent,
      conversation,
      input: '她以前做过老师',
    });

    expect(reply).toBe('我记住了，还有别的想告诉我吗？');
    expect(agent.lifeExperience).toBe('做过老师');
    expect(alignManualProfileEdits).toHaveBeenCalledWith({
      agent,
      userId: agent.createdUserId,
      sources: draft,
    });
  });
});
