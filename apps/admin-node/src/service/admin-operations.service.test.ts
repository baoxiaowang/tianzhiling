import {
  ConversationMessageFeedbackHandlingStatus,
  MongoObjectId,
} from '@tzl/entities';
import { AdminOperationsService } from './admin-operations.service';

const aggregateResult = (rows: unknown[]) => ({
  toArray: jest.fn().mockResolvedValue(rows),
});

describe('AdminOperationsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('按北京时间生成日报并统计实时用户消息和净收入', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T04:30:00.000Z'));
    const service = new AdminOperationsService();
    service.userModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        return aggregateResult(
          serialized.includes('"format":"%H"')
            ? [{ _id: '12', count: 2 }]
            : [{ _id: '2026-08-23', count: 3 }]
        );
      }),
    } as never;
    service.agentModel = {
      aggregate: jest.fn(() =>
        aggregateResult([{ _id: '2026-08-23', count: 4 }])
      ),
    } as never;
    service.messageModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        return aggregateResult(
          serialized.includes('"format":"%H"')
            ? [{ _id: '12', count: 9 }]
            : [{ _id: '2026-08-23', count: 12 }]
        );
      }),
    } as never;
    service.orderModel = {
      aggregate: jest.fn((pipeline: Record<string, unknown>[]) => {
        const serialized = JSON.stringify(pipeline);
        return aggregateResult(
          serialized.includes('"status":"refunded"')
            ? [{ _id: '2026-08-23', amount: 1800 }]
            : [{ _id: '2026-08-23', amount: 9900 }]
        );
      }),
    } as never;

    const result = await service.getReport('2026-08');
    const today = result.daily.find(item => item.date === '2026-08-23');

    expect(result.timezone).toBe('Asia/Shanghai');
    expect(today).toMatchObject({
      newUsers: 3,
      newAgents: 4,
      userMessages: 12,
      paidRevenue: 99,
      refundedRevenue: 18,
      netRevenue: 81,
    });
    expect(result.hourly[12]).toMatchObject({
      hour: '12:00',
      newUsers: 2,
      userMessages: 9,
    });
  });

  it('兼容旧反馈并保存处理状态和管理员记录', async () => {
    const service = new AdminOperationsService();
    const feedback = {
      id: new MongoObjectId('64f000000000000000000001'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    };
    const save = jest.fn().mockResolvedValue(feedback);
    service.feedbackModel = {
      findOne: jest.fn().mockResolvedValueOnce(feedback),
      save,
    } as never;

    const result = await service.updateFeedback(
      feedback.id.toHexString(),
      {
        status: 'resolved',
        note: ' 已核对并修复 ',
      },
      {
        sub: 'admin-id',
        account: 'operator',
        roles: ['admin'],
        nonce: 'test-nonce',
        exp: 1,
        iat: 1,
      }
    );

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        handlingStatus: ConversationMessageFeedbackHandlingStatus.resolved,
        handlingNote: '已核对并修复',
        handledBy: 'operator',
      })
    );
    expect(result.handlingStatus).toBe('resolved');
  });
});
