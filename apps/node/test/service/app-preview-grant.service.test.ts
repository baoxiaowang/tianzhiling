import { createHash } from 'crypto';
import { AppPreviewGrantService } from '../../src/service/app-preview-grant.service';

const code = 'ABCDEFGHJKLM';
const userId = '6d6f62b8f5943d6f4d30111b';
const oldUsers = process.env.APP_PREVIEW_ALLOWED_USER_IDS;

afterEach(() => {
  if (oldUsers === undefined) delete process.env.APP_PREVIEW_ALLOWED_USER_IDS;
  else process.env.APP_PREVIEW_ALLOWED_USER_IDS = oldUsers;
});

function createService() {
  const service = new AppPreviewGrantService();
  const grant = {
    id: 'grant-id',
    codeHash: createHash('sha256').update(code).digest('hex'),
    targetUserId: userId,
    state: 'issued',
    expiresAt: new Date(Date.now() + 60_000),
    issuedByAdminId: 'admin-id',
  };
  service.redisService = {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
  } as any;
  service.grantModel = {
    findOne: jest.fn().mockResolvedValue(grant),
    findOneAndUpdate: jest.fn().mockResolvedValue(grant),
  } as any;
  service.userService = {
    issueReadOnlyPreviewSession: jest.fn().mockResolvedValue({ accessToken: 'preview' }),
  } as any;
  service.logger = { warn: jest.fn() } as any;
  return service;
}

describe('AppPreviewGrantService', () => {
  it('consumes the grant atomically before issuing a session', async () => {
    process.env.APP_PREVIEW_ALLOWED_USER_IDS = userId;
    const service = createService();
    await expect(service.redeem(code, '127.0.0.1')).resolves.toMatchObject({
      accessToken: 'preview',
    });
    expect(service.grantModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'issued', expiresAt: expect.any(Object) }),
      expect.objectContaining({ $set: expect.objectContaining({ state: 'redeemed' }) }),
      expect.any(Object)
    );
    expect(service.userService.issueReadOnlyPreviewSession).toHaveBeenCalledWith(userId);
  });

  it('rejects a losing atomic claim without issuing a session', async () => {
    process.env.APP_PREVIEW_ALLOWED_USER_IDS = userId;
    const service = createService();
    (service.grantModel.findOneAndUpdate as jest.Mock).mockResolvedValue(null);
    await expect(service.redeem(code, '127.0.0.1')).rejects.toMatchObject({
      code: 'PREVIEW_ALREADY_USED',
    });
    expect(service.userService.issueReadOnlyPreviewSession).not.toHaveBeenCalled();
  });

  it('rate limits guesses before querying the grant', async () => {
    const service = createService();
    (service.redisService.incr as jest.Mock).mockResolvedValue(21);
    await expect(service.redeem(code, '127.0.0.1')).rejects.toMatchObject({
      code: 'PREVIEW_RATE_LIMIT',
    });
    expect(service.grantModel.findOne).not.toHaveBeenCalled();
  });
});
