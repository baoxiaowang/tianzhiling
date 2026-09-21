import { MongoObjectId, VipPlanGroup, VipPlanStatus } from '@tzl/entities';
import { AdminVipPlanService } from './admin-vip-plan.service';

function createService() {
  const service = new AdminVipPlanService();

  service.vipPlanModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as any;
  service.voicePackageModel = {
    findOne: jest.fn(),
  } as any;

  return service;
}


function basePlanPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: 'vip_year',
    name: '一年会员',
    description: '',
    planGroup: VipPlanGroup.basic,
    priceAmount: 9900,
    currency: 'CNY',
    lifetime: false,
    durationDays: 365,
    status: VipPlanStatus.active,
    sort: 0,
    benefits: [],
    ...overrides,
  } as never;
}

describe('AdminVipPlanService', () => {
  it('normalizes vip plan code before saving', async () => {
    const service = createService();
    const planId = new MongoObjectId();
    const voicePackageId = new MongoObjectId();

    jest.mocked(service.vipPlanModel.findOne).mockResolvedValue(null as never);
    jest.mocked(service.voicePackageModel.findOne).mockResolvedValue({
      id: voicePackageId,
      code: 'voice_basic',
      name: '基础声音训练',
    } as never);
    jest
      .mocked(service.vipPlanModel.save)
      .mockImplementation(async plan => ({ ...plan, id: planId }) as never);

    const result = await service.createVipPlan({
      code: ' VIP_YEAR ',
      name: '一年会员',
      description: '',
      planGroup: VipPlanGroup.voice,
      priceAmount: 9900,
      originalPriceAmount: 19900,
      currency: 'CNY',
      lifetime: false,
      durationDays: 365,
      status: VipPlanStatus.active,
      sort: 0,
      voicePackageId: voicePackageId.toHexString(),
      virtualPaymentProductId: 'vip_year_goods',
      benefits: [{ title: '无限聊天' }, { title: '动态服务' }],
    });

    expect(service.vipPlanModel.findOne).toHaveBeenCalledWith({
      where: {
        code: 'vip_year',
      },
    });
    expect(service.vipPlanModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'vip_year',
        name: '一年会员',
        planGroup: VipPlanGroup.voice,
        durationDays: 365,
        lifetime: false,
        voicePackageId,
        voicePackageCode: 'voice_basic',
        voicePackageName: '基础声音训练',
        benefits: [{ title: '无限聊天' }, { title: '动态服务' }],
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: planId.toHexString(),
        code: 'vip_year',
        planGroup: VipPlanGroup.voice,
        voicePackageId: voicePackageId.toHexString(),
        voicePackageCode: 'voice_basic',
        voicePackageName: '基础声音训练',
        status: VipPlanStatus.active,
      })
    );
  });

  it('付费且在售的套餐缺虚拟支付道具 ID 时拒绝保存', async () => {
    const service = createService();
    jest.mocked(service.vipPlanModel.findOne).mockResolvedValue(null as never);

    await expect(
      service.createVipPlan(basePlanPayload({ priceAmount: 9900 }))
    ).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_PRODUCT_ID_REQUIRED',
    });

    expect(service.vipPlanModel.save).not.toHaveBeenCalled();
  });

  it('120 元与 180 元这类商品漏配同样不能上线，且报错文案带金额', async () => {
    const service = createService();
    jest.mocked(service.vipPlanModel.findOne).mockResolvedValue(null as never);

    await expect(
      service.createVipPlan(basePlanPayload({ code: 'a', priceAmount: 12000 }))
    ).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_PRODUCT_ID_REQUIRED',
      message: expect.stringContaining('120.00'),
    });

    await expect(
      service.createVipPlan(basePlanPayload({ code: 'b', priceAmount: 18000 }))
    ).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_PRODUCT_ID_REQUIRED',
      message: expect.stringContaining('180.00'),
    });

    expect(service.vipPlanModel.save).not.toHaveBeenCalled();
  });

  it('免费套餐与 disabled 草稿不要求虚拟支付道具 ID', async () => {
    const service = createService();
    jest.mocked(service.vipPlanModel.findOne).mockResolvedValue(null as never);
    jest
      .mocked(service.vipPlanModel.save)
      .mockImplementation(async plan => plan as never);

    await expect(
      service.createVipPlan(basePlanPayload({ code: 'free', priceAmount: 0 }))
    ).resolves.toBeDefined();

    await expect(
      service.createVipPlan(
        basePlanPayload({ code: 'draft', status: VipPlanStatus.disabled })
      )
    ).resolves.toBeDefined();
  });

  it('把已有付费套餐改回在售时同样要求补齐道具 ID', async () => {
    const service = createService();
    const planId = new MongoObjectId();

    jest.mocked(service.vipPlanModel.findOne).mockImplementation(
      async ({ where }: any) => {
        if (where?.id && String(where.id) === planId.toHexString()) {
          return { id: planId, code: 'vip_year', virtualPaymentProductId: '' } as never;
        }
        return null as never;
      }
    );

    await expect(
      service.updateVipPlan(planId.toHexString(), basePlanPayload())
    ).rejects.toMatchObject({
      code: 'VIRTUAL_PAYMENT_PRODUCT_ID_REQUIRED',
    });

    expect(service.vipPlanModel.save).not.toHaveBeenCalled();
  });
});
