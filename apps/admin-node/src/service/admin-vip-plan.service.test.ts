import { MongoObjectId, VipPlanStatus } from '@tzl/entities';
import { AdminVipPlanService } from './admin-vip-plan.service';

function createService() {
  const service = new AdminVipPlanService();

  service.vipPlanModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as any;

  return service;
}

describe('AdminVipPlanService', () => {
  it('normalizes vip plan code before saving', async () => {
    const service = createService();
    const planId = new MongoObjectId();

    jest.mocked(service.vipPlanModel.findOne).mockResolvedValue(null as never);
    jest
      .mocked(service.vipPlanModel.save)
      .mockImplementation(async plan => ({ ...plan, id: planId }) as never);

    const result = await service.createVipPlan({
      code: ' VIP_YEAR ',
      name: '一年会员',
      description: '',
      priceAmount: 9900,
      originalPriceAmount: 19900,
      currency: 'CNY',
      lifetime: false,
      durationDays: 365,
      status: VipPlanStatus.active,
      sort: 0,
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
        durationDays: 365,
        lifetime: false,
        benefits: [{ title: '无限聊天' }, { title: '动态服务' }],
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: planId.toHexString(),
        code: 'vip_year',
        status: VipPlanStatus.active,
      })
    );
  });
});
