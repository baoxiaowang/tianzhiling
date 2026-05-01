import { Config, Inject, Provide } from '@midwayjs/core';
import { JwtService } from '@midwayjs/jwt';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AdminAuthenticatedPayload,
  AdminBootstrapRegisterResult,
  AdminBootstrapStatus,
  AdminPasswordLoginResult,
  AppError,
} from '@tzl/shared';
import {
  AdminAccountEntity,
  AdminUserEntity,
  MongoObjectId,
} from '@tzl/entities';
import { randomBytes } from 'crypto';
import { MongoRepository } from 'typeorm';
import {
  AdminBootstrapRegisterDTO,
  AdminPasswordLoginDTO,
} from '../dto/admin-auth.dto';
import {
  hashAdminPassword,
  verifyAdminPassword,
} from '../common/admin-password';

interface JwtConfig {
  secret?: string;
  sign?: {
    expiresIn?: number;
  };
}

@Provide()
export class AdminAuthService {
  @Config('jwt')
  jwtConfig: JwtConfig;

  @Inject()
  jwtService: JwtService;

  @InjectEntityModel(AdminUserEntity)
  adminUserModel: MongoRepository<AdminUserEntity>;

  @InjectEntityModel(AdminAccountEntity)
  adminAccountModel: MongoRepository<AdminAccountEntity>;

  async getBootstrapStatus(): Promise<AdminBootstrapStatus> {
    return {
      hasSuperAdmin: await this.hasSuperAdmin(),
    };
  }

  async registerSuperAdmin(
    body: AdminBootstrapRegisterDTO
  ): Promise<AdminBootstrapRegisterResult> {
    if (await this.hasSuperAdmin()) {
      throw new AppError(
        'SUPER_ADMIN_EXISTS',
        'super admin already exists',
        409
      );
    }

    const name = this.normalizeName(body.name);
    const account = this.normalizeAccount(body.account);
    const password = this.normalizePassword(body.password);
    const existingAccount = await this.adminAccountModel.findOne({
      where: {
        account,
      },
    });

    if (existingAccount) {
      throw new AppError('ADMIN_ACCOUNT_EXISTS', 'admin account exists', 409);
    }

    const now = new Date();
    let adminUser = new AdminUserEntity();
    adminUser.name = name;
    adminUser.avatar = '';
    adminUser.roles = ['admin'];
    adminUser.createdAt = now;
    adminUser.updatedAt = now;
    adminUser = await this.adminUserModel.save(adminUser);

    const adminAccount = new AdminAccountEntity();
    adminAccount.adminUserId = adminUser.id;
    adminAccount.account = account;
    adminAccount.password = hashAdminPassword(password);
    adminAccount.createdAt = now;
    adminAccount.updatedAt = now;
    await this.adminAccountModel.save(adminAccount);

    return {
      admin: {
        id: this.stringifyObjectId(adminUser.id),
        account,
        name: adminUser.name,
        roles: adminUser.roles,
      },
    };
  }

  async login(body: AdminPasswordLoginDTO): Promise<AdminPasswordLoginResult> {
    const account = this.normalizeAccount(body.account);
    const password = body.password ?? '';
    const adminAccount = await this.adminAccountModel.findOne({
      where: {
        account,
      },
    });

    if (!adminAccount) {
      throw new AppError('INVALID_ADMIN_CREDENTIALS', '账号或密码错误', 401);
    }

    if (!verifyAdminPassword(password, adminAccount.password)) {
      throw new AppError('INVALID_ADMIN_CREDENTIALS', '账号或密码错误', 401);
    }

    const adminUser = await this.findAdminUserById(adminAccount.adminUserId);

    if (!adminUser) {
      throw new AppError('ADMIN_USER_NOT_FOUND', '管理员用户不存在', 404);
    }

    return this.buildLoginResult(
      this.stringifyObjectId(adminUser.id),
      adminAccount.account,
      adminUser.roles?.length ? adminUser.roles : ['admin']
    );
  }

  private buildLoginResult(
    id: string,
    account: string,
    roles: string[]
  ): AdminPasswordLoginResult {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.jwtConfig.sign?.expiresIn ?? 8 * 60 * 60;
    const payload: Omit<AdminAuthenticatedPayload, 'iat' | 'exp'> = {
      sub: id,
      account,
      roles,
      nonce: randomBytes(16).toString('hex'),
    };
    const accessToken = this.jwtService.signSync(
      payload,
      this.jwtConfig.secret,
      this.jwtConfig.sign ?? {}
    );

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresAt: now + expiresIn,
      admin: {
        id,
        account,
        roles,
      },
    };
  }

  private async hasSuperAdmin(): Promise<boolean> {
    const superAdmin = await this.adminUserModel.findOne({
      where: {
        roles: 'admin',
      } as unknown as Partial<AdminUserEntity>,
    });

    return Boolean(superAdmin);
  }

  private normalizeName(rawName?: string): string {
    const name = rawName?.trim() ?? '';

    if (!name) {
      throw new AppError('INVALID_ADMIN_NAME', '管理员名称不能为空');
    }

    if (name.length > 50) {
      throw new AppError('INVALID_ADMIN_NAME', '管理员名称不能超过 50 个字符');
    }

    return name;
  }

  private normalizeAccount(rawAccount?: string): string {
    const account = rawAccount?.trim() ?? '';

    if (!account) {
      throw new AppError('INVALID_ADMIN_ACCOUNT', '管理员账号不能为空');
    }

    if (account.length < 3 || account.length > 50) {
      throw new AppError(
        'INVALID_ADMIN_ACCOUNT',
        '管理员账号长度需要在 3 到 50 个字符之间'
      );
    }

    return account;
  }

  private normalizePassword(rawPassword?: string): string {
    const password = rawPassword ?? '';

    if (password.length < 6 || password.length > 128) {
      throw new AppError(
        'INVALID_ADMIN_PASSWORD',
        '管理员密码长度需要在 6 到 128 个字符之间'
      );
    }

    return password;
  }

  private async findAdminUserById(
    adminUserId: MongoObjectId
  ): Promise<AdminUserEntity | null> {
    const adminUserById = await this.adminUserModel.findOne({
      where: {
        id: adminUserId,
      },
    });

    if (adminUserById) {
      return adminUserById;
    }

    return this.adminUserModel.findOne({
      where: {
        _id: adminUserId,
      } as never,
    });
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }
}
