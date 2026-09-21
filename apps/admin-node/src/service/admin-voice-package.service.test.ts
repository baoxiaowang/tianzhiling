import { MongoObjectId, VoicePackageStatus } from '@tzl/entities';
import { AdminVoicePackageService } from './admin-voice-package.service';

function createService() {
  const service = new AdminVoicePackageService();

  service.voicePackageModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as any;

  return service;
}

function basePackagePayload(overrides: Record<string, unknown> = {}) {
  return {
    code: 'voice_standard',
    name: '标准声音套餐',
    description: '',
    priceAmount: 18000,
    currency: 'CNY',
    deliverables: [{ title: '声音模型' }],
    status: VoicePackageStatus.active,
    sort: 0,
    ...overrides,
  } as never;
}

describe('AdminVoicePackageService virtual payment product guard', () => {
  it('付费且在售的声音套餐缺虚拟支付道具 ID 时拒绝保存', async () => {
    const service = createService();
    jest
      .mocked(service.voicePackageModel.findOne)
      .mockResolvedValue(null as never);

    await expect(
      service.createVoicePackage(basePackagePayload())
    ).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_PRODUCT_ID_REQUIRED',
      message: expect.stringContaining('180.00'),
    });

    expect(service.voicePackageModel.save).not.toHaveBeenCalled();
  });

  it('配置了道具 ID 的付费在售套餐可以保存', async () => {
    const service = createService();
    const packageId = new MongoObjectId();

    jest
      .mocked(service.voicePackageModel.findOne)
      .mockResolvedValue(null as never);
    jest
      .mocked(service.voicePackageModel.save)
      .mockImplementation(async item => ({ ...item, id: packageId }) as never);

    await expect(
      service.createVoicePackage(
        basePackagePayload({ virtualPaymentProductId: 'voice_standard_goods' })
      )
    ).resolves.toBeDefined();
  });

  it('免费套餐与 disabled 草稿不要求道具 ID', async () => {
    const service = createService();
    jest
      .mocked(service.voicePackageModel.findOne)
      .mockResolvedValue(null as never);
    jest
      .mocked(service.voicePackageModel.save)
      .mockImplementation(async item => item as never);

    await expect(
      service.createVoicePackage(basePackagePayload({ priceAmount: 0 }))
    ).resolves.toBeDefined();

    await expect(
      service.createVoicePackage(
        basePackagePayload({
          code: 'voice_draft',
          status: VoicePackageStatus.disabled,
        })
      )
    ).resolves.toBeDefined();
  });
});
