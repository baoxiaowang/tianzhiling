import {
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  ConversationEmotionStateEntity,
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';
import { AgentEmotionStateService } from '../../src/service/agents/agent-emotion-state.service';

const USER_ID = '665000000000000000000001';
const AGENT_ID = '665000000000000000000010';
const CONVERSATION_ID = '665000000000000000000020';
const MESSAGE_ID = '665000000000000000000030';
const NOW = new Date('2026-05-03T08:00:00.000Z');

function createMessage(content: string): MessageEntity {
  const message = new MessageEntity();

  Object.assign(message, {
    id: new MongoObjectId(MESSAGE_ID),
    conversationId: new MongoObjectId(CONVERSATION_ID),
    userId: new MongoObjectId(USER_ID),
    agentId: new MongoObjectId(AGENT_ID),
    role: MessageRole.user,
    content,
    createdAt: NOW,
    updatedAt: NOW,
  });

  return message;
}

describe('AgentEmotionStateService', () => {
  async function recognize(text: string) {
    const service = new AgentEmotionStateService();
    const savedStates: ConversationEmotionStateEntity[] = [];

    service.stateModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async state => {
        savedStates.push(state);
        return state;
      }),
    } as never;

    const summary = await service.recognizeAndUpsertFromUserMessage({
      message: createMessage(text),
      searchableText: text,
      now: NOW,
    });

    return { summary, savedStates };
  }

  it.each([
    ['我想去陪你', ConversationEmotionPrimary.crisisRisk, ConversationEmotionRiskLevel.high],
    ['他们怕我想不开', ConversationEmotionPrimary.crisisRisk, ConversationEmotionRiskLevel.high],
    ['刚才你摸我了是不', ConversationEmotionPrimary.expectingPresence, ConversationEmotionRiskLevel.none],
    ['我好想你', ConversationEmotionPrimary.missing, ConversationEmotionRiskLevel.none],
    ['你什么时候能来我梦里一次', ConversationEmotionPrimary.missing, ConversationEmotionRiskLevel.none],
    ['对不起都是我不好', ConversationEmotionPrimary.guilt, ConversationEmotionRiskLevel.none],
    ['我自己好孤独，心里没有底气', ConversationEmotionPrimary.sadness, ConversationEmotionRiskLevel.low],
  ])('recognizes %s', async (text, emotion, riskLevel) => {
    const { summary, savedStates } = await recognize(text);

    expect(summary?.primaryEmotion).toBe(emotion);
    expect(summary?.riskLevel).toBe(riskLevel);
    expect(savedStates).toHaveLength(1);
    expect(savedStates[0].signals.length).toBeGreaterThan(0);
  });

  it('returns current non-expired state and ignores expired state', async () => {
    const service = new AgentEmotionStateService();
    const state = new ConversationEmotionStateEntity();
    state.primaryEmotion = ConversationEmotionPrimary.missing;
    state.riskLevel = ConversationEmotionRiskLevel.none;
    state.signals = ['grief.missing'];
    state.expiresAt = new Date(NOW.getTime() + 1000);

    service.stateModel = {
      findOne: jest.fn().mockResolvedValue(state),
    } as never;

    await expect(
      service.getCurrentState({
        conversationId: new MongoObjectId(CONVERSATION_ID),
        userId: new MongoObjectId(USER_ID),
        agentId: new MongoObjectId(AGENT_ID),
        now: NOW,
      })
    ).resolves.toMatchObject({
      primaryEmotion: ConversationEmotionPrimary.missing,
    });

    await expect(
      service.getCurrentState({
        conversationId: new MongoObjectId(CONVERSATION_ID),
        userId: new MongoObjectId(USER_ID),
        agentId: new MongoObjectId(AGENT_ID),
        now: new Date(NOW.getTime() + 2000),
      })
    ).resolves.toBeNull();
  });

  it('does not attribute a known family member emotion to the user', async () => {
    const service = new AgentEmotionStateService();
    service.agentProfileFactService = {
      listSharedFamilyMemberNames: jest.fn().mockResolvedValue(['大宝']),
    } as never;
    service.stateModel = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as never;

    await expect(
      service.recognizeAndUpsertFromUserMessage({
        message: createMessage('大宝想你想得哭了'),
        searchableText: '大宝想你想得哭了',
        now: NOW,
      })
    ).resolves.toBeNull();
    expect(service.stateModel.save).not.toHaveBeenCalled();
  });

  it('still recognizes the user emotion when both user and family member miss the agent', async () => {
    const service = new AgentEmotionStateService();
    service.agentProfileFactService = {
      listSharedFamilyMemberNames: jest.fn().mockResolvedValue(['大宝']),
    } as never;
    service.stateModel = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async state => state),
    } as never;

    await expect(
      service.recognizeAndUpsertFromUserMessage({
        message: createMessage('大宝想你想得哭了，我也好想你'),
        searchableText: '大宝想你想得哭了，我也好想你',
        now: NOW,
      })
    ).resolves.toMatchObject({
      primaryEmotion: ConversationEmotionPrimary.missing,
    });
  });
});
