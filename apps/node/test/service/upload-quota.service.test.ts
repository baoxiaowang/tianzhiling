import {
  UploadQuotaService,
  resolveBeijingDayKey,
  resolveQuotaTtlSeconds,
} from '../../src/service/upload-quota.service';

function createFakeRedis() {
  const hashes = new Map<string, Map<string, number>>();
  const ttls = new Map<string, number>();

  const readHash = (key: string) => hashes.get(key) || new Map<string, number>();

  const redis = {
    async hmget(key: string, ...fields: string[]) {
      const hash = hashes.get(key);

      return fields.map(field =>
        hash?.has(field) ? String(hash.get(field)) : null
      );
    },
    multi() {
      const operations: Array<() => void> = [];
      const pipeline = {
        hincrby(key: string, field: string, value: number) {
          operations.push(() => {
            const hash = readHash(key);
            hash.set(field, (hash.get(field) || 0) + value);
            hashes.set(key, hash);
          });

          return pipeline;
        },
        expire(key: string, seconds: number) {
          operations.push(() => {
            ttls.set(key, seconds);
          });

          return pipeline;
        },
        async exec() {
          operations.forEach(operation => operation());

          return [];
        },
      };

      return pipeline;
    },
  };

  return { redis, hashes, ttls };
}

function createService(
  options: {
    config?: Record<string, unknown>;
    redis?: unknown;
  } = {}
) {
  const service = new UploadQuotaService();
  service.quotaConfig = {
    enabled: true,
    dailyFilesPerUser: 50,
    dailyImageFilesPerUser: 30,
    dailyBytesPerUser: 1024 * 1024,
    folderDailyFiles: { 'chat-imports': 2, moments: 27 },
    exemptFolders: ['chat-imports'],
    ...options.config,
  } as never;
  service.redisService = (options.redis ?? null) as never;
  service.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

  return service;
}

function readField(
  hashes: Map<string, Map<string, number>>,
  key: string,
  field: string
): number {
  return hashes.get(key)?.get(field) || 0;
}

const NOW = new Date('2026-09-30T02:00:00.000Z');
const DAY_KEY = resolveBeijingDayKey(NOW);

describe('上传配额日窗口', () => {
  it('按北京时间切日', () => {
    expect(resolveBeijingDayKey(new Date('2026-09-30T15:59:59.000Z'))).toBe(
      '20260930'
    );
    expect(resolveBeijingDayKey(new Date('2026-09-30T16:00:00.000Z'))).toBe(
      '20261001'
    );
  });

  it('TTL 覆盖到当日结束并留出边界余量', () => {
    expect(resolveQuotaTtlSeconds(new Date('2026-09-30T15:59:59.000Z'))).toBe(
      61
    );
    expect(resolveQuotaTtlSeconds(new Date('2026-09-30T16:00:00.000Z'))).toBe(
      86460
    );
  });
});

describe('UploadQuotaService.reserve', () => {
  it('未启用时不占用配额', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({ redis, config: { enabled: false } });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      now: NOW,
    });

    expect(reservation).toBeNull();
    expect(hashes.size).toBe(0);
  });

  it('缺少用户标识时跳过并告警', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({ redis });

    const reservation = await service.reserve({
      folder: 'moments',
      contentType: 'image/jpeg',
      now: NOW,
    });

    expect(reservation).toBeNull();
    expect(hashes.size).toBe(0);
    expect(service.logger.warn).toHaveBeenCalled();
  });

  it('正常预占时累计文件、图片与字节', async () => {
    const { redis, hashes, ttls } = createFakeRedis();
    const service = createService({ redis });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      now: NOW,
    });

    const key = `tzl:upload-quota:u1:${DAY_KEY}`;

    expect(reservation).toMatchObject({
      userId: 'u1',
      dayKey: DAY_KEY,
      folder: 'moments',
      countedImage: true,
      sizeBytes: 2048,
    });
    expect(readField(hashes, key, 'files')).toBe(1);
    expect(readField(hashes, key, 'images')).toBe(1);
    expect(readField(hashes, key, 'bytes')).toBe(2048);
    expect(ttls.get(key)).toBeGreaterThan(0);
  });

  it('音频只计文件与字节，不计图片', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({ redis });

    await service.reserve({
      userId: 'u1',
      folder: 'voice-training-materials',
      contentType: 'audio/mpeg',
      sizeBytes: 1024,
      now: NOW,
    });

    const key = `tzl:upload-quota:u1:${DAY_KEY}`;

    expect(readField(hashes, key, 'files')).toBe(1);
    expect(readField(hashes, key, 'images')).toBe(0);
  });

  it('超过图片上限时抛出 429 且不计数', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({
      redis,
      config: { dailyImageFilesPerUser: 2, dailyFilesPerUser: 100 },
    });

    for (let index = 0; index < 2; index += 1) {
      await service.reserve({
        userId: 'u1',
        folder: 'moments',
        contentType: 'image/jpeg',
        now: NOW,
      });
    }

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'moments',
        contentType: 'image/jpeg',
        now: NOW,
      })
    ).rejects.toMatchObject({
      code: 'UPLOAD_DAILY_LIMIT_EXCEEDED',
      status: 429,
      data: { reason: 'images', limit: 2, used: 2 },
    });

    const key = `tzl:upload-quota:u1:${DAY_KEY}`;

    expect(readField(hashes, key, 'images')).toBe(2);
  });

  it('超过文件上限时抛出 429', async () => {
    const { redis } = createFakeRedis();
    const service = createService({
      redis,
      config: { dailyFilesPerUser: 1, dailyImageFilesPerUser: 100 },
    });

    await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      now: NOW,
    });

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'moments',
        contentType: 'image/jpeg',
        now: NOW,
      })
    ).rejects.toMatchObject({ data: { reason: 'files', limit: 1 } });
  });

  it('超过字节上限时抛出 429', async () => {
    const { redis } = createFakeRedis();
    const service = createService({
      redis,
      config: { dailyBytesPerUser: 4096 },
    });

    await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'audio/mpeg',
      sizeBytes: 3000,
      now: NOW,
    });

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'moments',
        contentType: 'audio/mpeg',
        sizeBytes: 2000,
        now: NOW,
      })
    ).rejects.toMatchObject({ data: { reason: 'bytes', limit: 4096 } });
  });

  it('目录级上限单独生效', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({ redis });

    await service.reserve({
      userId: 'u1',
      folder: 'chat-imports',
      contentType: 'image/png',
      now: NOW,
    });
    await service.reserve({
      userId: 'u1',
      folder: 'chat-imports',
      contentType: 'image/png',
      now: NOW,
    });

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'chat-imports',
        contentType: 'image/png',
        now: NOW,
      })
    ).rejects.toMatchObject({
      data: { reason: 'folder', folder: 'chat-imports', limit: 2 },
    });

    const key = `tzl:upload-quota:u1:${DAY_KEY}`;

    expect(readField(hashes, key, 'folder:chat-imports')).toBe(2);
  });

  it('不同用户各自计数', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({
      redis,
      config: { dailyImageFilesPerUser: 1 },
    });

    await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      now: NOW,
    });

    await expect(
      service.reserve({
        userId: 'u2',
        folder: 'moments',
        contentType: 'image/jpeg',
        now: NOW,
      })
    ).resolves.toMatchObject({ userId: 'u2' });

    expect(hashes.size).toBe(2);
  });

  it('Redis 不可用时放行并告警', async () => {
    const service = createService({
      redis: {
        hmget: jest.fn().mockRejectedValue(new Error('redis down')),
        multi: jest.fn(),
      },
    });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      now: NOW,
    });

    expect(reservation).toBeNull();
    expect(service.logger.warn).toHaveBeenCalled();
  });
});

describe('UploadQuotaService.release', () => {
  it('上传失败后回补计数', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({ redis });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      sizeBytes: 2048,
      now: NOW,
    });

    await service.release(reservation, NOW);

    const key = `tzl:upload-quota:u1:${DAY_KEY}`;

    expect(readField(hashes, key, 'files')).toBe(0);
    expect(readField(hashes, key, 'images')).toBe(0);
    expect(readField(hashes, key, 'bytes')).toBe(0);
  });

  it('跨天后不回补，避免污染新一天计数', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({ redis });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      now: new Date('2026-09-30T15:59:59.000Z'),
    });

    await service.release(reservation, new Date('2026-09-30T16:30:00.000Z'));

    const key = `tzl:upload-quota:u1:${resolveBeijingDayKey(
      new Date('2026-09-30T15:59:59.000Z')
    )}`;

    expect(readField(hashes, key, 'files')).toBe(1);
  });
});

describe('UploadQuotaService 豁免目录（聊天导入）', () => {
  it('不占用全局文件与图片额度', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({
      redis,
      config: {
        dailyImageFilesPerUser: 2,
        dailyFilesPerUser: 2,
        folderDailyFiles: { 'chat-imports': 30, moments: 27 },
      },
    });

    await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      now: NOW,
    });
    await service.reserve({
      userId: 'u1',
      folder: 'moments',
      contentType: 'image/jpeg',
      now: NOW,
    });

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'moments',
        contentType: 'image/jpeg',
        now: NOW,
      })
    ).rejects.toMatchObject({ data: { reason: 'images' } });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'chat-imports',
      contentType: 'image/png',
      now: NOW,
    });

    const key = `tzl:upload-quota:u1:${DAY_KEY}`;

    expect(reservation).toMatchObject({
      countedGlobals: false,
      countedImage: false,
      countedFolder: true,
    });
    expect(readField(hashes, key, 'images')).toBe(2);
    expect(readField(hashes, key, 'files')).toBe(2);
    expect(readField(hashes, key, 'folder:chat-imports')).toBe(1);
  });

  it('仍受自己的目录上限约束（一天一批 30 张）', async () => {
    const { redis } = createFakeRedis();
    const service = createService({
      redis,
      config: { folderDailyFiles: { 'chat-imports': 2 } },
    });

    for (let index = 0; index < 2; index += 1) {
      await service.reserve({
        userId: 'u1',
        folder: 'chat-imports',
        contentType: 'image/png',
        now: NOW,
      });
    }

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'chat-imports',
        contentType: 'image/png',
        now: NOW,
      })
    ).rejects.toMatchObject({
      data: { reason: 'folder', folder: 'chat-imports', limit: 2 },
    });
  });

  it('仍计入全局总字节，避免大文件绕过体积上限', async () => {
    const { redis } = createFakeRedis();
    const service = createService({
      redis,
      config: {
        dailyBytesPerUser: 4096,
        folderDailyFiles: { 'chat-imports': 30 },
      },
    });

    await service.reserve({
      userId: 'u1',
      folder: 'chat-imports',
      contentType: 'image/png',
      sizeBytes: 3000,
      now: NOW,
    });

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'chat-imports',
        contentType: 'image/png',
        sizeBytes: 2000,
        now: NOW,
      })
    ).rejects.toMatchObject({ data: { reason: 'bytes', limit: 4096 } });
  });

  it('未配置目录上限的豁免目录按普通目录处理', async () => {
    const { redis } = createFakeRedis();
    const service = createService({
      redis,
      config: {
        dailyImageFilesPerUser: 1,
        folderDailyFiles: {},
        exemptFolders: ['chat-imports'],
      },
    });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'chat-imports',
      contentType: 'image/png',
      now: NOW,
    });

    expect(reservation).toMatchObject({ countedGlobals: true });

    await expect(
      service.reserve({
        userId: 'u1',
        folder: 'chat-imports',
        contentType: 'image/png',
        now: NOW,
      })
    ).rejects.toMatchObject({ data: { reason: 'images', limit: 1 } });
  });

  it('上传失败回补时不动全局计数', async () => {
    const { redis, hashes } = createFakeRedis();
    const service = createService({ redis });

    const reservation = await service.reserve({
      userId: 'u1',
      folder: 'chat-imports',
      contentType: 'image/png',
      sizeBytes: 2048,
      now: NOW,
    });

    await service.release(reservation, NOW);

    const key = `tzl:upload-quota:u1:${DAY_KEY}`;

    expect(readField(hashes, key, 'files')).toBe(0);
    expect(readField(hashes, key, 'images')).toBe(0);
    expect(readField(hashes, key, 'folder:chat-imports')).toBe(0);
    expect(readField(hashes, key, 'bytes')).toBe(0);
  });
});
