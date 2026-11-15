import { MongoObjectId } from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';

describe('findActiveVoiceTimbreForAgent 解绑语义', () => {
  const createService = () => {
    const service = new ConversationService();
    const voiceModel = { findOne: jest.fn(), updateOne: jest.fn() };
    (service as any).voiceTimbreModel = voiceModel;
    (service as any).agentModel = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    (service as any).logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    return { service, voiceModel };
  };

  it('voiceTimbreId 为空（已解绑）时不回退到用户其它音色', async () => {
    const { service, voiceModel } = createService();
    const agent = {
      id: new MongoObjectId(),
      createdUserId: new MongoObjectId(),
      voiceTimbreId: null,
    };

    const result = await (service as any).findActiveVoiceTimbreForAgent(agent);

    expect(result).toBeUndefined();
    expect(voiceModel.findOne).not.toHaveBeenCalled();
  });

  it('配置的音色失效时仍回退并修写 voiceTimbreId', async () => {
    const { service, voiceModel } = createService();
    const staleId = new MongoObjectId();
    const fallbackId = new MongoObjectId();
    voiceModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: fallbackId, status: 'active' });
    const agent = {
      id: new MongoObjectId(),
      createdUserId: new MongoObjectId(),
      voiceTimbreId: staleId,
    };

    const result = await (service as any).findActiveVoiceTimbreForAgent(agent);

    expect(result).toMatchObject({ id: fallbackId });
    expect((agent as any).voiceTimbreId).toBe(fallbackId);
  });
});
