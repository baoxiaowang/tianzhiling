import {
  OrderStatus,
  UserAccountStatus,
  VoiceServiceSessionStatus,
  VoiceTrainingTaskStatus,
} from '@tzl/entities';
import { ObjectId } from 'mongodb';
import { AccountCancellationService } from '../../src/service/account-cancellation.service';

const USER_ID = new ObjectId('507f1f77bcf86cd799439011');
const ACCOUNT_ID = new ObjectId('507f1f77bcf86cd799439012');

function createService() {
  const service = new AccountCancellationService();
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never;
  service.userModel = {
    findOne: jest.fn().mockResolvedValue({
      id: USER_ID,
      name: '测试用户',
      avatar: '',
      accountStatus: UserAccountStatus.active,
    }),
  } as never;
  service.orderModel = { find: jest.fn().mockResolvedValue([]) } as never;
  service.voiceServiceSessionModel = {
    find: jest.fn().mockResolvedValue([]),
  } as never;
  service.voiceTrainingTaskModel = {
    find: jest.fn().mockResolvedValue([]),
  } as never;
  service.chatImportBatchModel = {
    find: jest.fn().mockResolvedValue([]),
  } as never;
  service.userAccountModel = {
    find: jest.fn().mockResolvedValue([]),
  } as never;
  service.wechatPayService = {
    getOpenidByJsCode: jest.fn().mockResolvedValue('openid-current'),
  } as never;

  return service;
}

describe('AccountCancellationService', () => {
  it('groups unfinished orders and active voice work into clear blockers', async () => {
    const service = createService();
    (service.orderModel.find as jest.Mock).mockResolvedValue([
      { status: OrderStatus.pending },
      { status: OrderStatus.completed },
    ]);
    (service.voiceServiceSessionModel.find as jest.Mock).mockResolvedValue([
      {
        status: VoiceServiceSessionStatus.reviewing,
        reviewClips: [{ recutStatus: 'processing' }],
      },
    ]);
    (service.voiceTrainingTaskModel.find as jest.Mock).mockResolvedValue([
      { status: VoiceTrainingTaskStatus.awaitingMaterial },
    ]);

    const result = await service.checkCurrentUser({
      sub: String(USER_ID),
      accountId: String(ACCOUNT_ID),
      account: 'weapp:test',
      iat: 0,
      exp: 1,
      nonce: 'nonce',
    });

    expect(result.eligible).toBe(false);
    expect(result.blockers).toEqual([
      expect.objectContaining({ code: 'ORDER_PROCESSING', count: 1 }),
      expect.objectContaining({ code: 'VOICE_PROCESSING', count: 1 }),
    ]);
  });

  it('allows cancellation when all business records are in stable states', async () => {
    const service = createService();
    (service.orderModel.find as jest.Mock).mockResolvedValue([
      { status: OrderStatus.completed },
      { status: OrderStatus.refunded },
    ]);
    (service.voiceServiceSessionModel.find as jest.Mock).mockResolvedValue([
      { status: VoiceServiceSessionStatus.completed, reviewClips: [] },
    ]);
    (service.voiceTrainingTaskModel.find as jest.Mock).mockResolvedValue([
      { status: VoiceTrainingTaskStatus.completed },
    ]);

    const result = await service.checkCurrentUser({
      sub: String(USER_ID),
      accountId: String(ACCOUNT_ID),
      account: 'weapp:test',
      iat: 0,
      exp: 1,
      nonce: 'nonce',
    });

    expect(result.eligible).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.confirmationText).toBe('确认注销');
  });

  it('rejects a different WeChat identity when the account is already linked', async () => {
    const service = createService();
    (service.userAccountModel.find as jest.Mock).mockResolvedValue([
      {
        id: ACCOUNT_ID,
        userId: USER_ID,
        account: 'weapp:test',
        openId: 'openid-linked',
      },
    ]);

    await expect(
      (service as any).verifyWechatIdentity(
        USER_ID,
        String(ACCOUNT_ID),
        'fresh-code',
      ),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_CANCELLATION_IDENTITY_MISMATCH',
      status: 403,
    });
  });

  it('supports a current phone-only account after fresh WeChat verification', async () => {
    const service = createService();
    (service.userAccountModel.find as jest.Mock).mockResolvedValue([
      {
        id: ACCOUNT_ID,
        userId: USER_ID,
        account: '13800138000',
      },
    ]);

    await expect(
      (service as any).verifyWechatIdentity(
        USER_ID,
        String(ACCOUNT_ID),
        'fresh-code',
      ),
    ).resolves.toBeUndefined();
  });
});
