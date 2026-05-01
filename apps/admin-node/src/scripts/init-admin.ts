import { resolve } from 'path';
import { randomBytes } from 'crypto';
import { DataSource, MongoRepository } from 'typeorm';
import {
  AdminAccountEntity,
  AdminUserEntity,
  MongoObjectId,
} from '@tzl/entities';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';
import { hashAdminPassword } from '../common/admin-password';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

interface InitAdminOptions {
  name: string;
  account: string;
  password: string;
  generatedPassword: boolean;
}

async function main(): Promise<void> {
  const options = readInitAdminOptions();
  const dataSource = new DataSource({
    type: 'mongodb',
    database: readStringFrom(
      ['ADMIN_API_MONGO_DB', 'NODE_MONGO_DB', 'MONGO_DB'],
      'tzl'
    ),
    host: readStringFrom(
      ['ADMIN_API_MONGO_HOST', 'NODE_MONGO_HOST', 'MONGO_HOST'],
      '127.0.0.1'
    ),
    port: readNumberFrom(
      ['ADMIN_API_MONGO_PORT', 'NODE_MONGO_PORT', 'MONGO_PORT'],
      17271
    ),
    authSource: readStringFrom(
      [
        'ADMIN_API_MONGO_AUTH_SOURCE',
        'NODE_MONGO_AUTH_SOURCE',
        'MONGO_AUTH_SOURCE',
      ],
      'admin'
    ),
    username: readStringFrom(
      ['ADMIN_API_MONGO_USERNAME', 'NODE_MONGO_USERNAME', 'MONGO_USERNAME'],
      'admin'
    ),
    password: readStringFrom(
      ['ADMIN_API_MONGO_PASSWORD', 'NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'],
      'qwerasdf'
    ),
    synchronize: readBooleanFrom(['ADMIN_API_DB_SYNCHRONIZE'], false),
    logging: readBooleanFrom(['ADMIN_API_DB_LOGGING'], false),
    entities: [AdminAccountEntity, AdminUserEntity],
  } as never);

  await dataSource.initialize();

  try {
    await createSuperAdminIfMissing(
      dataSource.getMongoRepository(AdminUserEntity),
      dataSource.getMongoRepository(AdminAccountEntity),
      options
    );
  } finally {
    await dataSource.destroy();
  }
}

async function createSuperAdminIfMissing(
  adminUserModel: MongoRepository<AdminUserEntity>,
  adminAccountModel: MongoRepository<AdminAccountEntity>,
  options: InitAdminOptions
): Promise<void> {
  const existingSuperAdmin = await adminUserModel.findOne({
    where: {
      roles: 'admin',
    } as unknown as Partial<AdminUserEntity>,
  });

  if (existingSuperAdmin) {
    console.log('超级管理员已存在，跳过初始化。');
    return;
  }

  const existingAccount = await adminAccountModel.findOne({
    where: {
      account: options.account,
    },
  });

  if (existingAccount) {
    throw new Error(`管理员账号已存在但不是超级管理员：${options.account}`);
  }

  const now = new Date();
  let adminUser = new AdminUserEntity();
  adminUser.name = options.name;
  adminUser.avatar = '';
  adminUser.roles = ['admin'];
  adminUser.createdAt = now;
  adminUser.updatedAt = now;
  adminUser = await adminUserModel.save(adminUser);

  const adminAccount = new AdminAccountEntity();
  adminAccount.adminUserId = adminUser.id as MongoObjectId;
  adminAccount.account = options.account;
  adminAccount.password = hashAdminPassword(options.password);
  adminAccount.createdAt = now;
  adminAccount.updatedAt = now;
  await adminAccountModel.save(adminAccount);

  console.log(`超级管理员已创建：${options.account}`);

  if (options.generatedPassword) {
    console.log(`初始密码：${options.password}`);
    console.log('请登录后立即修改或重置为正式强密码。');
  }
}

function readInitAdminOptions(): InitAdminOptions {
  const password = readStringFrom(['ADMIN_INIT_PASSWORD'], '').trim();
  const generatedPassword = !password;
  const options = {
    name: readStringFrom(['ADMIN_INIT_NAME'], '超级管理员').trim(),
    account: readStringFrom(
      ['ADMIN_INIT_ACCOUNT', 'ADMIN_API_ACCOUNT'],
      'admin'
    ).trim(),
    password: password || generatePassword(),
    generatedPassword,
  };

  validateInitAdminOptions(options);

  return options;
}

function generatePassword(): string {
  return randomBytes(12).toString('hex');
}

function validateInitAdminOptions(options: InitAdminOptions): void {
  if (!options.name) {
    throw new Error('ADMIN_INIT_NAME 不能为空');
  }

  if (options.name.length > 50) {
    throw new Error('ADMIN_INIT_NAME 不能超过 50 个字符');
  }

  if (!options.account) {
    throw new Error('ADMIN_INIT_ACCOUNT 不能为空');
  }

  if (options.account.length < 3 || options.account.length > 50) {
    throw new Error('ADMIN_INIT_ACCOUNT 长度需要在 3 到 50 个字符之间');
  }

  if (options.password.length < 6 || options.password.length > 128) {
    throw new Error('ADMIN_INIT_PASSWORD 长度需要在 6 到 128 个字符之间');
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
