import { AdminAppPreviewGrantService } from './admin-app-preview-grant.service';

const userId = '6d6f62b8f5943d6f4d30111b';
const admin = { sub: '507f1f77bcf86cd799439011', roles: ['admin'] } as any;

describe('AdminAppPreviewGrantService', () => {
  const oldUsers = process.env.APP_PREVIEW_ALLOWED_USER_IDS;
  const oldAdmins = process.env.APP_PREVIEW_APPROVER_ADMIN_IDS;

  afterEach(() => {
    if (oldUsers === undefined) delete process.env.APP_PREVIEW_ALLOWED_USER_IDS;
    else process.env.APP_PREVIEW_ALLOWED_USER_IDS = oldUsers;
    if (oldAdmins === undefined) delete process.env.APP_PREVIEW_APPROVER_ADMIN_IDS;
    else process.env.APP_PREVIEW_APPROVER_ADMIN_IDS = oldAdmins;
  });

  function createService() {
    const service = new AdminAppPreviewGrantService();
    service.userModel = { findOne: jest.fn().mockResolvedValue({ id: userId }) } as any;
    service.grantModel = { save: jest.fn().mockImplementation(async value => value) } as any;
    service.logger = { warn: jest.fn() } as any;
    return service;
  }

  it('requires both target user and issuing admin on allowlists', async () => {
    const service = createService();
    process.env.APP_PREVIEW_ALLOWED_USER_IDS = userId;
    delete process.env.APP_PREVIEW_APPROVER_ADMIN_IDS;
    await expect(service.issue(userId, admin)).rejects.toMatchObject({
      code: 'PREVIEW_GRANT_FORBIDDEN',
    });
    expect(service.grantModel.save).not.toHaveBeenCalled();
  });

  it('stores only a hash and issues a short-lived code', async () => {
    const service = createService();
    process.env.APP_PREVIEW_ALLOWED_USER_IDS = userId;
    process.env.APP_PREVIEW_APPROVER_ADMIN_IDS = admin.sub;
    const result = await service.issue(userId, admin);
    expect(result.code).toMatch(/^[A-Z2-9]{12}$/);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 3 * 60 * 1000);
    const saved = (service.grantModel.save as jest.Mock).mock.calls[0][0];
    expect(saved.codeHash).not.toBe(result.code);
    expect(saved).not.toHaveProperty('code');
  });
});
