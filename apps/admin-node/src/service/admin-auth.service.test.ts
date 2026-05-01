import {
  AdminAccountEntity,
  AdminUserEntity,
  MongoObjectId,
} from '@tzl/entities';
import { AdminAuthService } from './admin-auth.service';

const ADMIN_USER_ID = '665000000000000000000101';

function createService() {
  const service = new AdminAuthService();
  const adminUsers: AdminUserEntity[] = [];
  const adminAccounts: AdminAccountEntity[] = [];
  const adminUserModel = {
    findOne: jest.fn(async ({ where }: any) => {
      if (where?.roles === 'admin') {
        return adminUsers.find(user => user.roles?.includes('admin')) ?? null;
      }

      const id = where?.id ?? where?._id;

      if (id) {
        const targetId = id.toHexString?.() ?? String(id);

        return (
          adminUsers.find(user => user.id?.toHexString?.() === targetId) ?? null
        );
      }

      return null;
    }),
    save: jest.fn(async (adminUser: AdminUserEntity) => {
      adminUser.id = adminUser.id ?? new MongoObjectId(ADMIN_USER_ID);
      adminUsers.push(adminUser);
      return adminUser;
    }),
  };
  const adminAccountModel = {
    findOne: jest.fn(async ({ where }: any) => {
      return (
        adminAccounts.find(account => account.account === where?.account) ??
        null
      );
    }),
    save: jest.fn(async (adminAccount: AdminAccountEntity) => {
      adminAccount.id =
        adminAccount.id ?? new MongoObjectId('665000000000000000000102');
      adminAccounts.push(adminAccount);
      return adminAccount;
    }),
  };

  service.jwtConfig = {
    secret: 'test-secret',
    sign: {
      expiresIn: 3600,
    },
  };
  service.jwtService = {
    signSync: jest.fn().mockReturnValue('admin-token'),
  } as any;
  service.adminUserModel = adminUserModel as any;
  service.adminAccountModel = adminAccountModel as any;

  return {
    service,
    adminUsers,
    adminAccounts,
    adminUserModel,
    adminAccountModel,
  };
}

describe('AdminAuthService', () => {
  it('does not fall back to a configured default admin account', async () => {
    const { service, adminAccountModel } = createService();

    await expect(
      service.login({
        account: 'admin',
        password: 'admin123456',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_ADMIN_CREDENTIALS',
      status: 401,
    });
    expect(adminAccountModel.findOne).toHaveBeenCalledWith({
      where: {
        account: 'admin',
      },
    });
  });

  it('registers a super admin with hashed password and logs in from database', async () => {
    const { service, adminAccounts } = createService();

    await service.registerSuperAdmin({
      name: '超级管理员',
      account: 'admin',
      password: 'strong-password',
    });

    expect(adminAccounts[0].password).toMatch(/^scrypt\$/);
    expect(adminAccounts[0].password).not.toBe('strong-password');

    const result = await service.login({
      account: 'admin',
      password: 'strong-password',
    });

    expect(result.accessToken).toBe('admin-token');
    expect(result.admin.account).toBe('admin');
    expect(result.admin.roles).toEqual(['admin']);
  });
});
