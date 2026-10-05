const MANAGED_ENV_KEYS = [
  'NODE_IMAGE_MODERATION_ENABLED',
  'NODE_IMAGE_MODERATION_BIZ_TYPE',
  'NODE_IMAGE_MODERATION_FOLDERS',
  'NODE_IMAGE_MODERATION_RESTRICTED_FOLDERS',
  'NODE_IMAGE_MODERATION_RESTRICTED_BIZ_TYPE',
  'NODE_IMAGE_MODERATION_RESTRICTED_SAMPLE_RATE',
  'NODE_IMAGE_MODERATION_FOLDER_SAMPLE_RATES',
  'NODE_IMAGE_MODERATION_REVIEW_ACTION',
  'NODE_IMAGE_MODERATION_FAILURE_ACTION',
  'NODE_IMAGE_MODERATION_LARGE_IMAGE_DETECT',
  'NODE_IMAGE_MODERATION_LOG_RAW',
  'NODE_UPLOAD_QUOTA_ENABLED',
  'NODE_UPLOAD_QUOTA_DAILY_FILES',
  'NODE_UPLOAD_QUOTA_DAILY_IMAGE_FILES',
  'NODE_UPLOAD_QUOTA_DAILY_BYTES',
  'NODE_UPLOAD_QUOTA_FOLDER_LIMITS',
  'NODE_UPLOAD_QUOTA_EXEMPT_FOLDERS',
];

function loadConfig() {
  let config: Record<string, any> | undefined;

  jest.isolateModules(() => {
    config = require('../../src/config/config.default').default;
  });

  return config as Record<string, any>;
}

describe('图片审核与上传配额配置', () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    MANAGED_ENV_KEYS.forEach(key => {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    });
  });

  afterEach(() => {
    MANAGED_ENV_KEYS.forEach(key => {
      const value = originalEnv.get(key);

      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
    originalEnv.clear();
  });

  it('默认关闭图片审核，并保持历史上传行为', () => {
    const config = loadConfig();

    expect(config.imageModeration).toMatchObject({
      enabled: false,
      bizType: '',
      reviewAction: 'allow',
      failureAction: 'allow',
      largeImageDetect: false,
      timeoutMs: 8000,
    });
    expect(config.imageModeration.folders).toEqual([
      'moments',
      'avatars',
      'contact-covers',
      'conversation-images',
      'chat-imports',
      'memorial-source-photos',
    ]);
  });

  it('默认对私密目录启用红线策略与 5% 抽样，亲人素材保持全量', () => {
    const config = loadConfig();

    expect(config.imageModeration).toMatchObject({
      restrictedFolders: [
        'conversation-images',
        'chat-imports',
        'memorial-source-photos',
      ],
      restrictedBizType: '',
      restrictedSampleRate: 0.05,
      folderSampleRates: { 'memorial-source-photos': 1 },
    });
  });

  it('默认配额按单用户收紧，且聊天导入单独设限并豁免全局计数', () => {
    const config = loadConfig();

    expect(config.uploadQuota).toMatchObject({
      enabled: true,
      dailyFilesPerUser: 50,
      dailyImageFilesPerUser: 30,
      dailyBytesPerUser: 256 * 1024 * 1024,
      folderDailyFiles: {
        'chat-imports': 30,
        moments: 27,
        'conversation-images': 15,
        avatars: 5,
        'contact-covers': 5,
        'memorial-source-photos': 10,
      },
      exemptFolders: ['chat-imports'],
    });
  });

  it('支持环境变量覆盖审核范围、分层策略与配额', () => {
    process.env.NODE_IMAGE_MODERATION_ENABLED = 'true';
    process.env.NODE_IMAGE_MODERATION_BIZ_TYPE = 'biz-abc';
    process.env.NODE_IMAGE_MODERATION_FOLDERS = 'moments, chat-imports';
    process.env.NODE_IMAGE_MODERATION_RESTRICTED_FOLDERS = 'chat-imports';
    process.env.NODE_IMAGE_MODERATION_RESTRICTED_BIZ_TYPE = 'biz-redline';
    process.env.NODE_IMAGE_MODERATION_RESTRICTED_SAMPLE_RATE = '0.1';
    process.env.NODE_IMAGE_MODERATION_FOLDER_SAMPLE_RATES =
      '{"chat-imports":0.2,"memorial-source-photos":1}';
    process.env.NODE_IMAGE_MODERATION_REVIEW_ACTION = 'block';
    process.env.NODE_IMAGE_MODERATION_FAILURE_ACTION = 'block';
    process.env.NODE_UPLOAD_QUOTA_DAILY_BYTES = '123456';
    process.env.NODE_UPLOAD_QUOTA_FOLDER_LIMITS =
      '{"chat-imports":5,"moments":"30"}';
    process.env.NODE_UPLOAD_QUOTA_EXEMPT_FOLDERS = 'chat-imports,moments';

    const config = loadConfig();

    expect(config.imageModeration).toMatchObject({
      enabled: true,
      bizType: 'biz-abc',
      folders: ['moments', 'chat-imports'],
      restrictedFolders: ['chat-imports'],
      restrictedBizType: 'biz-redline',
      restrictedSampleRate: 0.1,
      folderSampleRates: { 'chat-imports': 0.2, 'memorial-source-photos': 1 },
      reviewAction: 'block',
      failureAction: 'block',
    });
    expect(config.uploadQuota.dailyBytesPerUser).toBe(123456);
    expect(config.uploadQuota.folderDailyFiles).toEqual({
      'chat-imports': 5,
      moments: 30,
    });
    expect(config.uploadQuota.exemptFolders).toEqual([
      'chat-imports',
      'moments',
    ]);
  });

  it('抽样比例配置越界或非法时回退默认值', () => {
    process.env.NODE_IMAGE_MODERATION_FOLDER_SAMPLE_RATES =
      '{"chat-imports":5,"conversation-images":0}';

    const config = loadConfig();

    expect(config.imageModeration.folderSampleRates).toEqual({
      'memorial-source-photos': 1,
    });
  });

  it('显式清空抽样比例覆盖时保留空表', () => {
    process.env.NODE_IMAGE_MODERATION_FOLDER_SAMPLE_RATES = '{}';

    const config = loadConfig();

    expect(config.imageModeration.folderSampleRates).toEqual({});
  });

  it('目录配额配置为非法 JSON 时回退默认值而不阻塞启动', () => {
    process.env.NODE_UPLOAD_QUOTA_FOLDER_LIMITS = '{not-json';

    const config = loadConfig();

    expect(config.uploadQuota.folderDailyFiles).toEqual({
      'chat-imports': 30,
      moments: 27,
      'conversation-images': 15,
      avatars: 5,
      'contact-covers': 5,
      'memorial-source-photos': 10,
    });
  });
});
