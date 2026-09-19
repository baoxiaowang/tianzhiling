import {
  AgentEntity,
  MongoObjectId,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { AgentVtApiService } from './agent-vt-api.service';

const USER_ID = new MongoObjectId('665000000000000000000601');
const OTHER_USER_ID = new MongoObjectId('665000000000000000000602');
const AGENT_ID = new MongoObjectId('665000000000000000000603');
const TIMBRE_ID = new MongoObjectId('665000000000000000000604');

function createTimbre(
  userId: MongoObjectId = USER_ID,
  status: VoiceTimbreStatus = VoiceTimbreStatus.active
): VoiceTimbreEntity {
  return {
    id: TIMBRE_ID,
    userId,
    name: '测试音色',
    provider: VoiceTimbreProvider.doubao,
    providerVoiceId: 'S_test_001',
    audioObjectKey: 'voice-timbres/demo.wav',
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as VoiceTimbreEntity;
}

function createAgent(): AgentEntity {
  return {
    id: AGENT_ID,
    createdUserId: USER_ID,
    name: '妈妈',
    voiceTimbreId: undefined,
    pendingVoiceTimbreId: undefined,
    voiceTimbreSelectedAt: undefined,
    updatedAt: new Date(),
  } as AgentEntity;
}

function createService() {
  const service = new AgentVtApiService();
  const adminVoiceTimbreService = {
    listVoiceTimbres: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 0 }),
    listDoubaoVoiceSlots: jest.fn().mockResolvedValue({ items: [] }),
    createVoiceTimbre: jest.fn().mockResolvedValue({ id: 'new-timbre-id' }),
    retryVoiceTimbreCreate: jest.fn().mockResolvedValue({ id: 'retry-id' }),
  };
  const voiceTimbreModel = {
    findOne: jest.fn(),
  };
  const agentModel = {
    findOne: jest.fn(),
    save: jest.fn(async (agent: AgentEntity) => agent),
  };

  service.adminVoiceTimbreService = adminVoiceTimbreService as never;
  service.voiceTimbreModel = voiceTimbreModel as never;
  service.agentModel = agentModel as never;
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never;

  return { service, adminVoiceTimbreService, voiceTimbreModel, agentModel };
}

describe('AgentVtApiService 受限操作', () => {
  describe('createTraining', () => {
    it('身份强制来自 token userId，忽略请求体中的 userId', async () => {
      const { service, adminVoiceTimbreService } = createService();

      await service.createTraining(USER_ID, {
        audioObjectKey: 'agent-vt/audio.wav',
        name: '测试',
        // 请求体即使携带 userId 也不得生效（服务签名本就不接受 userId）
      });

      expect(adminVoiceTimbreService.createVoiceTimbre).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID.toHexString(),
          audioObjectKey: 'agent-vt/audio.wav',
        })
      );
    });

    it('缺少 audioObjectKey 抛错', async () => {
      const { service } = createService();
      await expect(service.createTraining(USER_ID, {} as never)).rejects.toMatchObject({
        code: 'AGENT_VT_AUDIO_REQUIRED',
      });
    });
  });

  describe('retryTraining 归属断言', () => {
    it('他人音色一律 404（不暴露资源是否存在）', async () => {
      const { service, voiceTimbreModel } = createService();
      voiceTimbreModel.findOne.mockResolvedValue(createTimbre(OTHER_USER_ID));

      await expect(
        service.retryTraining(USER_ID, TIMBRE_ID.toHexString())
      ).rejects.toMatchObject({ code: 'AGENT_VT_TIMBRE_NOT_FOUND', status: 404 });
    });

    it('本人音色正常重试', async () => {
      const { service, voiceTimbreModel, adminVoiceTimbreService } = createService();
      voiceTimbreModel.findOne.mockResolvedValue(createTimbre(USER_ID, VoiceTimbreStatus.failed));

      const result = await service.retryTraining(USER_ID, TIMBRE_ID.toHexString());
      expect(result).toEqual({ id: 'retry-id' });
      expect(adminVoiceTimbreService.retryVoiceTimbreCreate).toHaveBeenCalledWith(
        TIMBRE_ID.toHexString()
      );
    });
  });

  describe('bindToRelative', () => {
    it('他人音色 404', async () => {
      const { service, voiceTimbreModel } = createService();
      voiceTimbreModel.findOne.mockResolvedValue(createTimbre(OTHER_USER_ID));

      await expect(
        service.bindToRelative(USER_ID, TIMBRE_ID.toHexString(), AGENT_ID)
      ).rejects.toMatchObject({ code: 'AGENT_VT_TIMBRE_NOT_FOUND', status: 404 });
    });

    it('训练未完成（非 active）不能绑定', async () => {
      const { service, voiceTimbreModel } = createService();
      voiceTimbreModel.findOne.mockResolvedValue(createTimbre(USER_ID, VoiceTimbreStatus.creating));

      await expect(
        service.bindToRelative(USER_ID, TIMBRE_ID.toHexString(), AGENT_ID)
      ).rejects.toMatchObject({ code: 'AGENT_VT_TIMBRE_NOT_ACTIVE', status: 409 });
    });

    it('目标亲人不属于该用户 404', async () => {
      const { service, voiceTimbreModel, agentModel } = createService();
      voiceTimbreModel.findOne.mockResolvedValue(createTimbre(USER_ID));
      agentModel.findOne.mockResolvedValue({
        ...createAgent(),
        createdUserId: OTHER_USER_ID,
      });

      await expect(
        service.bindToRelative(USER_ID, TIMBRE_ID.toHexString(), AGENT_ID)
      ).rejects.toMatchObject({ code: 'AGENT_VT_RELATIVE_NOT_FOUND', status: 404 });
    });

    it('训练成功绑定到该账号 AI 亲人（写 voiceTimbreId）', async () => {
      const { service, voiceTimbreModel, agentModel } = createService();
      voiceTimbreModel.findOne.mockResolvedValue(createTimbre(USER_ID));
      agentModel.findOne.mockResolvedValue(createAgent());

      const result = await service.bindToRelative(
        USER_ID,
        TIMBRE_ID.toHexString(),
        AGENT_ID
      );

      expect(result.agentId).toBe(AGENT_ID.toHexString());
      expect(result.timbreId).toBe(TIMBRE_ID.toHexString());
      expect(agentModel.save).toHaveBeenCalledWith(
        expect.objectContaining({
          voiceTimbreId: TIMBRE_ID,
          pendingVoiceTimbreId: undefined,
        })
      );
    });
  });

  describe('listTimbres', () => {
    it('按 token userId 过滤，不返回他人音色', async () => {
      const { service, adminVoiceTimbreService } = createService();
      adminVoiceTimbreService.listVoiceTimbres.mockResolvedValue({
        items: [{ id: 'a' }],
        total: 1,
        page: 1,
        pageSize: 1,
      });

      const result = await service.listTimbres(USER_ID);
      expect(result).toEqual([{ id: 'a' }]);
      expect(adminVoiceTimbreService.listVoiceTimbres).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID.toHexString() })
      );
    });
  });
});
