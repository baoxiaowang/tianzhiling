import {
  AgentEntity,
  MongoObjectId,
  VoicePackageEntity,
  VoicePackageStatus,
} from '@tzl/entities';
import { VoicePackageService } from '../../src/service/voice-package.service';

const NOW = new Date('2026-05-01T00:00:00.000Z');
const USER_ID = '665000000000000000000001';
const AGENT_ID = '665000000000000000000005';
const VOICE_PACKAGE_ID = '665000000000000000000004';
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.78';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 12; BLK-AL80 Build/HUAWEIBLK-AL80; wv) AppleWebKit/537.36 MiniProgramEnv/android';

function createAgent(): AgentEntity {
  const agent = new AgentEntity();

  Object.assign(agent, {
    id: new MongoObjectId(AGENT_ID),
    createdUserId: new MongoObjectId(USER_ID),
    name: '小天使',
  });

  return agent;
}

function createVoicePackage(overrides: Partial<VoicePackageEntity> = {}) {
  const voicePackage = new VoicePackageEntity();

  Object.assign(voicePackage, {
    id: new MongoObjectId(VOICE_PACKAGE_ID),
    code: 'voice_standard',
    name: '标准语音包',
    description: '',
    priceAmount: 12000,
    currency: 'CNY',
    deliverables: [],
    materialRequirement: '',
    virtualPaymentProductId: 'voice_standard_goods',
    status: VoicePackageStatus.active,
    sort: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });

  return voicePackage;
}

function createService(voicePackage = createVoicePackage()) {
  const agent = createAgent();
  const service = new VoicePackageService();

  service.agentModel = {
    findOne: jest.fn(async () => agent),
  } as never;
  service.voicePackageModel = {
    find: jest.fn(async () => [voicePackage]),
  } as never;
  service.voiceTrainingTaskModel = {
    find: jest.fn(async () => []),
  } as never;
  service.orderModel = {
    findOne: jest.fn(async () => null),
  } as never;

  return service;
}

const auth = {
  sub: USER_ID,
  accountId: 'account-1',
  account: 'tester',
  iat: 0,
  exp: 0,
  nonce: 'nonce',
} as never;

describe('VoicePackageService 虚拟支付道具 ID 下发', () => {
  it('iOS 请求不下发道具 ID，旧小程序据此回落普通微信支付', async () => {
    const service = createService();

    const result = await service.getAgentVoicePackageCenter(
      auth,
      AGENT_ID,
      IOS_UA
    );

    expect(result.packages).toEqual([
      expect.objectContaining({
        id: VOICE_PACKAGE_ID,
        virtualPaymentProductId: '',
      }),
    ]);
  });

  it('非 iOS 请求照常下发道具 ID，客户端继续走虚拟支付', async () => {
    const service = createService();

    const result = await service.getAgentVoicePackageCenter(
      auth,
      AGENT_ID,
      ANDROID_UA
    );

    expect(result.packages).toEqual([
      expect.objectContaining({
        id: VOICE_PACKAGE_ID,
        virtualPaymentProductId: 'voice_standard_goods',
      }),
    ]);
  });

  it('缺 UA 时不按 iOS 掩码', async () => {
    const service = createService();

    const result = await service.getAgentVoicePackageCenter(auth, AGENT_ID);

    expect(result.packages).toEqual([
      expect.objectContaining({
        virtualPaymentProductId: 'voice_standard_goods',
      }),
    ]);
  });
});
