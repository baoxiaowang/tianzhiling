import {
  AgentEntity,
  MongoObjectId,
  OrderEntity,
  OrderSource,
  OrderStatus,
  OrderType,
  VipPlanGroup,
  VoiceTrainingTaskEntity,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { VoiceUsageAccessService } from '../../src/service/voice-usage-access.service';

const USER_ID = new MongoObjectId('665000000000000000000301');

function createService() {
  const service = new VoiceUsageAccessService();
  service.orderModel = { find: jest.fn().mockResolvedValue([]) } as never;
  service.vipPlanModel = {
    findOne: jest.fn().mockResolvedValue(null),
  } as never;
  service.userMembershipModel = {
    find: jest.fn().mockResolvedValue([]),
  } as never;
  service.agentEntitlementModel = {
    find: jest.fn().mockResolvedValue([]),
  } as never;
  service.voiceTrainingTaskModel = {
    find: jest.fn().mockResolvedValue([]),
  } as never;
  service.agentModel = { find: jest.fn().mockResolvedValue([]) } as never;
  return service;
}

function createOrder(
  values: Partial<OrderEntity> & Pick<OrderEntity, 'orderType'>
) {
  const now = new Date('2026-08-03T08:00:00.000Z');
  return Object.assign(new OrderEntity(), {
    id: new MongoObjectId(),
    userId: USER_ID,
    orderNo: `ORDER_${Math.random()}`,
    title: '测试订单',
    amount: 19900,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount: 19900,
    currency: 'CNY',
    status: OrderStatus.completed,
    source: OrderSource.weapp,
    createdAt: now,
    updatedAt: now,
    ...values,
  });
}

describe('VoiceUsageAccessService', () => {
  it('recognizes a paid voice membership even when no voice was fulfilled', async () => {
    const service = createService();
    const order = createOrder({
      orderType: OrderType.vipPlan,
      snapshot: {
        vipPlan: {
          code: 'vip_year_voice',
          name: '声音年会员',
          planGroup: VipPlanGroup.voice,
        },
      },
    });
    jest.mocked(service.orderModel.find).mockResolvedValue([order]);

    await expect(service.resolve(USER_ID)).resolves.toEqual({
      eligible: true,
      source: 'voice_membership_order',
      referenceId: String(order.id),
    });
  });

  it('recognizes a standalone admin voice order', async () => {
    const service = createService();
    const order = createOrder({
      orderType: OrderType.voicePackage,
      source: OrderSource.admin,
    });
    jest.mocked(service.orderModel.find).mockResolvedValue([order]);

    await expect(service.resolve(USER_ID)).resolves.toEqual({
      eligible: true,
      source: 'admin_voice_order',
      referenceId: String(order.id),
    });
  });

  it('uses an old non-refunded voice task as compatibility evidence', async () => {
    const service = createService();
    const task = Object.assign(new VoiceTrainingTaskEntity(), {
      id: new MongoObjectId(),
      userId: USER_ID,
      status: VoiceTrainingTaskStatus.completed,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    jest.mocked(service.voiceTrainingTaskModel.find).mockResolvedValue([task]);

    await expect(service.resolve(USER_ID)).resolves.toEqual({
      eligible: true,
      source: 'legacy_voice_task',
      referenceId: String(task.id),
    });
  });

  it('keeps direct backend voice bindings eligible without changing them', async () => {
    const service = createService();
    const agent = Object.assign(new AgentEntity(), {
      id: new MongoObjectId(),
      createdUserId: USER_ID,
      voiceTimbreId: new MongoObjectId(),
    });
    jest.mocked(service.agentModel.find).mockResolvedValue([agent]);

    await expect(service.resolve(USER_ID)).resolves.toEqual({
      eligible: true,
      source: 'existing_voice_binding',
      referenceId: String(agent.id),
    });
  });

  it('does not grant access from refunded voice records', async () => {
    const service = createService();
    const order = createOrder({
      orderType: OrderType.voicePackage,
      status: OrderStatus.refunded,
    });
    const task = Object.assign(new VoiceTrainingTaskEntity(), {
      id: new MongoObjectId(),
      userId: USER_ID,
      status: VoiceTrainingTaskStatus.refunded,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    jest.mocked(service.orderModel.find).mockResolvedValue([order]);
    jest.mocked(service.voiceTrainingTaskModel.find).mockResolvedValue([task]);

    await expect(service.resolve(USER_ID)).resolves.toEqual({
      eligible: false,
    });
  });

  it('does not restore old voice access after a membership downgrade', async () => {
    const service = createService();
    const downgradeTime = new Date('2026-08-03T09:00:00.000Z');
    const downgradedOrder = createOrder({
      orderType: OrderType.vipPlan,
      paidAt: new Date('2026-08-03T08:00:00.000Z'),
      snapshot: {
        vipPlan: {
          code: 'vip_year_voice',
          name: '声音年会员',
          planGroup: VipPlanGroup.voice,
        },
        voiceMembershipDowngrade: {
          status: 'completed',
          completedAt: downgradeTime.toISOString(),
        },
      },
    });
    const oldVoiceOrder = createOrder({
      orderType: OrderType.vipPlan,
      paidAt: new Date('2025-08-03T08:00:00.000Z'),
      snapshot: {
        vipPlan: {
          code: 'vip_old_voice',
          name: '旧声音会员',
          planGroup: VipPlanGroup.voice,
        },
      },
    });
    const task = Object.assign(new VoiceTrainingTaskEntity(), {
      id: new MongoObjectId(),
      userId: USER_ID,
      status: VoiceTrainingTaskStatus.completed,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    const agent = Object.assign(new AgentEntity(), {
      id: new MongoObjectId(),
      createdUserId: USER_ID,
      voiceTimbreId: new MongoObjectId(),
    });

    jest
      .mocked(service.orderModel.find)
      .mockResolvedValue([downgradedOrder, oldVoiceOrder]);
    jest.mocked(service.voiceTrainingTaskModel.find).mockResolvedValue([task]);
    jest.mocked(service.agentModel.find).mockResolvedValue([agent]);

    await expect(service.resolve(USER_ID)).resolves.toEqual({
      eligible: false,
    });
    expect(service.voiceTrainingTaskModel.find).not.toHaveBeenCalled();
    expect(service.agentModel.find).not.toHaveBeenCalled();
  });

  it('stops voice access when refund succeeded but benefit cleanup needs retry', async () => {
    const service = createService();
    const order = createOrder({
      orderType: OrderType.vipPlan,
      snapshot: {
        vipPlan: {
          code: 'vip_year_voice',
          planGroup: VipPlanGroup.voice,
        },
        voiceMembershipDowngrade: {
          status: 'benefits_failed',
          wechatRefundStatus: 'SUCCESS',
          refundRecordedAt: '2026-08-03T09:00:00.000Z',
        },
      },
    });

    jest.mocked(service.orderModel.find).mockResolvedValue([order]);

    await expect(service.resolve(USER_ID)).resolves.toEqual({
      eligible: false,
    });
  });
});
