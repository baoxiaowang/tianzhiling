import {
  MongoObjectId,
  OrderSource,
  OrderStatus,
  OrderType,
} from '@tzl/entities';
import { AdminOrderService } from './admin-order.service';

const USER_ID = new MongoObjectId('665000000000000000000201');
const ORDER_ID = new MongoObjectId('665000000000000000000301');
const ORDER_CREATED_AT = new Date('2026-05-02T08:00:00.000Z');

function createService() {
  const service = new AdminOrderService();

  service.orderModel = {
    count: jest.fn(),
    find: jest.fn(),
  } as any;
  service.userModel = {
    find: jest.fn(),
  } as any;
  service.userAccountModel = {
    find: jest.fn(),
  } as any;

  return service;
}

describe('AdminOrderService', () => {
  it('lists orders with user profile and account fields', async () => {
    const service = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([
      {
        id: ORDER_ID,
        orderNo: 'VIP202605020001',
        userId: USER_ID,
        orderType: OrderType.vipPlan,
        targetCode: 'vip_year',
        title: '一年会员',
        amount: 19900,
        discountAmount: 10000,
        couponAmount: 0,
        payableAmount: 9900,
        currency: 'CNY',
        status: OrderStatus.completed,
        source: OrderSource.weapp,
        paymentProvider: 'wechat_pay',
        paymentTradeNo: '420000000020260502000001',
        createdAt: ORDER_CREATED_AT,
        updatedAt: ORDER_CREATED_AT,
        paidAt: ORDER_CREATED_AT,
      },
    ] as never);
    jest.mocked(service.userModel.find).mockResolvedValue([
      {
        id: USER_ID,
        name: '测试用户',
        avatar: '',
        phone: '13800000000',
      },
    ] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([
      {
        userId: USER_ID,
        account: '13800000000',
      },
    ] as never);

    const result = await service.listOrders({
      keyword: '',
      page: '1',
      pageSize: '20',
    });

    expect(service.orderModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        order: {
          createdAt: 'DESC',
        },
        skip: 0,
        take: 20,
      })
    );
    expect(service.userModel.find).toHaveBeenCalledWith({
      where: {
        $or: [{ id: { $in: [USER_ID] } }, { _id: { $in: [USER_ID] } }],
      },
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: ORDER_ID.toHexString(),
          orderNo: 'VIP202605020001',
          userId: USER_ID.toHexString(),
          user: {
            id: USER_ID.toHexString(),
            account: '13800000000',
            name: '测试用户',
            phone: '13800000000',
          },
          payableAmount: 9900,
          status: OrderStatus.completed,
          source: OrderSource.weapp,
          paymentTradeNo: '420000000020260502000001',
          createdAt: ORDER_CREATED_AT.toISOString(),
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it('falls back to _id when joining order users', async () => {
    const service = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(1 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([
      {
        id: ORDER_ID,
        orderNo: 'VIP202605020002',
        userId: USER_ID,
        orderType: OrderType.vipPlan,
        title: '一年会员',
        amount: 100,
        discountAmount: 0,
        couponAmount: 0,
        payableAmount: 100,
        currency: 'CNY',
        status: OrderStatus.pending,
        source: OrderSource.weapp,
        createdAt: ORDER_CREATED_AT,
        updatedAt: ORDER_CREATED_AT,
      },
    ] as never);
    jest.mocked(service.userModel.find).mockResolvedValue([
      {
        _id: USER_ID,
        name: 'ID兜底用户',
        avatar: '',
        phone: '13900000000',
      },
    ] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);

    const result = await service.listOrders({});

    expect(result.items[0].user).toEqual({
      id: USER_ID.toHexString(),
      account: '13900000000',
      name: 'ID兜底用户',
      phone: '13900000000',
    });
  });

  it('combines base filters and keyword filters for order search', async () => {
    const service = createService();

    jest.mocked(service.userModel.find).mockResolvedValue([] as never);
    jest.mocked(service.userAccountModel.find).mockResolvedValue([] as never);
    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      keyword: 'VIP20260502',
      status: OrderStatus.pending,
      source: OrderSource.weapp,
      orderType: OrderType.vipPlan,
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      $and: [
        {
          status: OrderStatus.pending,
          orderType: OrderType.vipPlan,
          source: OrderSource.weapp,
        },
        {
          $or: expect.arrayContaining([
            { orderNo: { $regex: 'VIP20260502', $options: 'i' } },
            { title: { $regex: 'VIP20260502', $options: 'i' } },
            { targetCode: { $regex: 'VIP20260502', $options: 'i' } },
            { paymentTradeNo: { $regex: 'VIP20260502', $options: 'i' } },
          ]),
        },
      ],
    });
  });

  it('filters orders by user id', async () => {
    const service = createService();

    jest.mocked(service.orderModel.count).mockResolvedValue(0 as never);
    jest.mocked(service.orderModel.find).mockResolvedValue([] as never);

    await service.listOrders({
      userId: USER_ID.toHexString(),
    });

    expect(service.orderModel.count).toHaveBeenCalledWith({
      userId: USER_ID,
    });
  });
});
