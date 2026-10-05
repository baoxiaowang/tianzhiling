import {
  ImageModerationService,
  parseImageAuditResponse,
  shouldSampleAudit,
} from '../../src/service/image-moderation.service';

function createService(
  options: {
    config?: Record<string, unknown>;
    audit?: jest.Mock;
  } = {}
) {
  const service = new ImageModerationService();
  service.moderationConfig = {
    enabled: true,
    bizType: 'biz-public',
    restrictedBizType: 'biz-restricted',
    restrictedFolders: ['conversation-images', 'chat-imports'],
    restrictedSampleRate: 1,
    folders: ['moments', 'chat-imports', 'avatars', 'conversation-images'],
    reviewAction: 'allow',
    failureAction: 'allow',
    logRawResponse: false,
    timeoutMs: 1000,
    ...options.config,
  } as never;
  const auditImageByObjectKey = options.audit || jest.fn();
  service.tencentCosService = { auditImageByObjectKey } as never;
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never;

  return { service, auditImageByObjectKey };
}

const normalResponse = {
  Status: 'Success',
  JobId: 'job-normal',
  RecognitionResult: {
    Result: 0,
    Label: 'Normal',
    PornInfo: { Code: 0, HitFlag: 0, Score: 5, Label: 'Normal' },
  },
};

const violationResponse = {
  Status: 'Success',
  JobId: 'job-block',
  RecognitionResult: {
    Result: 1,
    Label: 'Porn',
    Score: 99,
    PornInfo: { Code: 0, HitFlag: 1, Score: 99, Label: 'Porn' },
  },
};

const suspectedResponse = {
  Status: 'Success',
  JobId: 'job-review',
  RecognitionResult: {
    Result: 2,
    Label: 'Porn',
    Score: 75,
    PornInfo: { Code: 0, HitFlag: 2, Score: 75, Label: 'Porn' },
  },
};

describe('ImageModerationService.shouldModerate', () => {
  it('未开启审核时一律不审', () => {
    const { service } = createService({ config: { enabled: false } });

    expect(
      service.shouldModerate({ folder: 'moments', contentType: 'image/jpeg' })
    ).toBe(false);
  });

  it('只审图片，音频视频不审', () => {
    const { service } = createService();

    expect(
      service.shouldModerate({ folder: 'moments', contentType: 'image/jpeg' })
    ).toBe(true);
    expect(
      service.shouldModerate({
        folder: 'voice-training-materials',
        contentType: 'audio/mpeg',
      })
    ).toBe(false);
    expect(
      service.shouldModerate({
        folder: 'voice-training-materials',
        contentType: 'video/mp4',
      })
    ).toBe(false);
  });

  it('没有 content-type 时按后缀判断图片', () => {
    const { service } = createService();

    expect(
      service.shouldModerate({ folder: 'moments', fileName: '照片.JPG' })
    ).toBe(true);
    expect(
      service.shouldModerate({ folder: 'moments', fileName: '录音.mp3' })
    ).toBe(false);
  });

  it('运营与服务端目录不在审核范围内', () => {
    const { service } = createService();

    expect(
      service.shouldModerate({
        folder: 'admin/messenger-message',
        contentType: 'image/png',
      })
    ).toBe(false);
    expect(
      service.shouldModerate({
        folder: 'memorial-photos',
        contentType: 'image/png',
      })
    ).toBe(false);
  });

  it('未传目录时按范围内处理，避免旧客户端绕过审核', () => {
    const { service } = createService();

    expect(service.shouldModerate({ contentType: 'image/png' })).toBe(true);
  });
});

describe('ImageModerationService.moderate', () => {
  it('Result=0 放行并返回正常原因', async () => {
    const audit = jest.fn().mockResolvedValue(normalResponse);
    const { service } = createService({ audit });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/a.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
      userId: 'u1',
    });

    expect(result).toMatchObject({ decision: 'pass', reason: 'normal' });
    expect(audit).toHaveBeenCalledWith({
      objectKey: 'moments/2026/09/30/a.jpg',
      bizType: 'biz-public',
      largeImageDetect: undefined,
    });
  });

  it('Result=1 拦截', async () => {
    const audit = jest.fn().mockResolvedValue(violationResponse);
    const { service } = createService({ audit });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/b.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: 'violation',
      label: 'Porn',
      score: 99,
    });
  });

  it('Result=2 默认放行但标记疑似', async () => {
    const audit = jest.fn().mockResolvedValue(suspectedResponse);
    const { service } = createService({ audit });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/c.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(result).toMatchObject({ decision: 'pass', reason: 'suspected' });
  });

  it('Result=2 且 reviewAction=block 时拦截', async () => {
    const audit = jest.fn().mockResolvedValue(suspectedResponse);
    const { service } = createService({
      audit,
      config: { reviewAction: 'block' },
    });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/d.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(result).toMatchObject({ decision: 'block', reason: 'suspected' });
  });

  it('审核调用失败且 failureAction=allow 时放行', async () => {
    const audit = jest.fn().mockRejectedValue(new Error('read ECONNRESET'));
    const { service } = createService({ audit });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/e.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(result).toMatchObject({
      decision: 'pass',
      reason: 'unavailable',
    });
  });

  it('审核调用失败且 failureAction=block 时拦截', async () => {
    const audit = jest.fn().mockRejectedValue(new Error('timeout'));
    const { service } = createService({
      audit,
      config: { failureAction: 'block' },
    });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/f.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: 'unavailable',
    });
  });

  it('返回结构无法识别时按失败策略处理', async () => {
    const audit = jest
      .fn()
      .mockResolvedValue({ Status: 'Failed', Message: 'no permission' });
    const { service } = createService({
      audit,
      config: { failureAction: 'block' },
    });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/g.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: 'unavailable',
    });
  });

  it('审核超时按失败策略处理', async () => {
    const audit = jest.fn().mockImplementation(
      () => new Promise(() => undefined)
    );
    const { service } = createService({
      audit,
      config: { timeoutMs: 20, failureAction: 'block' },
    });

    const result = await service.moderate({
      objectKey: 'moments/2026/09/30/h.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(result).toMatchObject({
      decision: 'block',
      reason: 'unavailable',
    });
  });

  it('不需要审核的对象不调用审核接口', async () => {
    const audit = jest.fn();
    const { service } = createService({ audit });

    const result = await service.moderate({
      objectKey: 'admin/messenger-message/2026/09/30/x.png',
      folder: 'admin/messenger-message',
      contentType: 'image/png',
    });

    expect(result).toMatchObject({ decision: 'pass', reason: 'skipped' });
    expect(audit).not.toHaveBeenCalled();
  });

  it('透传审计策略与大图参数', async () => {
    const audit = jest.fn().mockResolvedValue(normalResponse);
    const { service } = createService({
      audit,
      config: { bizType: 'biz-123', largeImageDetect: true },
    });

    await service.moderate({
      objectKey: 'moments/2026/09/30/i.jpg',
      folder: 'moments',
      contentType: 'image/jpeg',
    });

    expect(audit).toHaveBeenCalledWith({
      objectKey: 'moments/2026/09/30/i.jpg',
      bizType: 'biz-123',
      largeImageDetect: true,
    });
  });
});

describe('ImageModerationService 分层审核', () => {
  it('公开目录用默认策略，私密目录用红线策略', () => {
    const { service } = createService();

    expect(service.resolveBizType('moments')).toBe('biz-public');
    expect(service.resolveBizType('avatars')).toBe('biz-public');
    expect(service.resolveBizType('conversation-images')).toBe(
      'biz-restricted'
    );
    expect(service.resolveBizType('chat-imports')).toBe('biz-restricted');
  });

  it('未配红线策略时私密目录退回默认策略，宁可多审不漏审', () => {
    const { service } = createService({
      config: { restrictedBizType: '' },
    });

    expect(service.resolveBizType('chat-imports')).toBe('biz-public');
  });

  it('未传目录时不判为私密', () => {
    const { service } = createService();

    expect(service.isRestrictedFolder(undefined)).toBe(false);
    expect(service.resolveBizType(undefined)).toBe('biz-public');
  });

  it('公开目录恒为全量，私密目录按抽样比例', () => {
    const { service } = createService({
      config: { restrictedSampleRate: 0.05 },
    });

    expect(service.resolveSampleRate('moments')).toBe(1);
    expect(service.resolveSampleRate('chat-imports')).toBe(0.05);
  });

  it('目录级抽样比例优先于全局私密比例', () => {
    const { service } = createService({
      config: {
        restrictedSampleRate: 0.05,
        folderSampleRates: { 'memorial-source-photos': 1 },
      },
    });

    expect(service.resolveSampleRate('memorial-source-photos')).toBe(1);
    expect(service.resolveSampleRate('chat-imports')).toBe(0.05);
  });

  it('抽样比例越界时收敛到 [0, 1]', () => {
    const { service } = createService({
      config: { restrictedSampleRate: 3 },
    });

    expect(service.resolveSampleRate('chat-imports')).toBe(1);

    const { service: negative } = createService({
      config: { restrictedSampleRate: -1 },
    });

    expect(negative.resolveSampleRate('chat-imports')).toBe(0);
  });

  it('未抽中的上传不调用审核也不拦截', async () => {
    const audit = jest.fn().mockResolvedValue(violationResponse);
    const { service } = createService({
      audit,
      config: { restrictedSampleRate: 0 },
    });

    const result = await service.moderate({
      objectKey: 'chat-imports/2026/09/30/a.png',
      folder: 'chat-imports',
      contentType: 'image/png',
    });

    expect(result).toMatchObject({ decision: 'pass', reason: 'sampled_out' });
    expect(audit).not.toHaveBeenCalled();
  });

  it('抽中的上传照常按策略审核', async () => {
    const audit = jest.fn().mockResolvedValue(violationResponse);
    const { service } = createService({
      audit,
      config: { restrictedSampleRate: 1 },
    });

    const result = await service.moderate({
      objectKey: 'chat-imports/2026/09/30/b.png',
      folder: 'chat-imports',
      contentType: 'image/png',
    });

    expect(result).toMatchObject({ decision: 'block', reason: 'violation' });
    expect(audit).toHaveBeenCalledWith({
      objectKey: 'chat-imports/2026/09/30/b.png',
      bizType: 'biz-restricted',
      largeImageDetect: undefined,
    });
  });
});

describe('shouldSampleAudit', () => {
  it('比例为 1 时全量、为 0 时全不抽', () => {
    expect(shouldSampleAudit('moments/2026/09/30/a.jpg', 1)).toBe(true);
    expect(shouldSampleAudit('moments/2026/09/30/a.jpg', 0)).toBe(false);
  });

  it('非法比例按全量处理', () => {
    expect(shouldSampleAudit('moments/2026/09/30/a.jpg', Number.NaN)).toBe(
      true
    );
  });

  it('同一对象键结论稳定，可复现', () => {
    const key = 'chat-imports/2026/09/30/c.png';

    expect(shouldSampleAudit(key, 0.05)).toBe(shouldSampleAudit(key, 0.05));
  });

  it('抽样比例与实际覆盖率一致（5% 目标，2000 个键）', () => {
    const keys = Array.from(
      { length: 2000 },
      (_value, index) => `chat-imports/2026/09/30/shot-${index}.png`
    );

    const sampled = keys.filter(key => shouldSampleAudit(key, 0.05)).length;

    expect(sampled).toBeGreaterThan(60);
    expect(sampled).toBeLessThan(140);
  });
});

describe('parseImageAuditResponse', () => {
  it('解析标准 RecognitionResult 结构', () => {
    expect(parseImageAuditResponse(violationResponse)).toMatchObject({
      resultCode: 1,
      label: 'Porn',
      score: 99,
    });
  });

  it('兼容平铺与小写字段、字符串数字', () => {
    expect(
      parseImageAuditResponse({
        status: 'success',
        result: '2',
        label: 'Ads',
        score: '70',
        pornInfo: { hitFlag: '2', score: '70' },
      })
    ).toMatchObject({ resultCode: 2, label: 'Ads', score: 70 });
  });

  it('缺少 Result 时按不安全场景的命中标记推导', () => {
    expect(
      parseImageAuditResponse({
        Status: 'Success',
        RecognitionResult: {
          PornInfo: { HitFlag: 1, Score: 91 },
        },
      })
    ).toMatchObject({ resultCode: 1 });
  });

  it('低质量场景不参与违规推导', () => {
    expect(
      parseImageAuditResponse({
        Status: 'Success',
        RecognitionResult: {
          QualityInfo: { HitFlag: 1, Score: 95 },
          PornInfo: { HitFlag: 0, Score: 3 },
        },
      })
    ).toMatchObject({ resultCode: 0 });
  });

  it('无法识别的结构返回 null', () => {
    expect(parseImageAuditResponse({ Message: 'forbidden' })).toBeNull();
    expect(parseImageAuditResponse('not-json')).toBeNull();
  });
});
