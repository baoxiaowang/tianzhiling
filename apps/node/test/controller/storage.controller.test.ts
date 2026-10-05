import { StorageController } from '../../src/controller/storage.controller';

function createController(options: {
  putFile?: jest.Mock;
  deleteObject?: jest.Mock;
  moderate?: jest.Mock;
  shouldModerate?: jest.Mock;
  reserve?: jest.Mock;
  release?: jest.Mock;
  createSignedUpload?: jest.Mock;
} = {}) {
  const controller = new StorageController();
  const putFile = options.putFile || jest.fn();
  const deleteObject = options.deleteObject || jest.fn().mockResolvedValue({});
  const shouldModerate =
    options.shouldModerate || jest.fn().mockReturnValue(true);
  const moderate =
    options.moderate ||
    jest.fn().mockResolvedValue({ decision: 'pass', reason: 'normal' });
  const reserve = options.reserve || jest.fn().mockResolvedValue(null);
  const release = options.release || jest.fn().mockResolvedValue(undefined);
  const createSignedUpload = options.createSignedUpload || jest.fn();

  controller.tencentCosService = {
    putFile,
    deleteObject,
    createSignedUpload,
  } as never;
  controller.imageModerationService = {
    shouldModerate,
    moderate,
  } as never;
  controller.uploadQuotaService = { reserve, release } as never;
  controller.logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as never;

  return {
    controller,
    putFile,
    deleteObject,
    moderate,
    shouldModerate,
    reserve,
    release,
    createSignedUpload,
  };
}

const VOICE_UPLOAD = [
  {
    data: '/tmp/upload.mp4',
    filename: 'upload.mp4',
    mimeType: 'video/mp4',
    fieldName: 'file',
  },
];

const IMAGE_UPLOAD = [
  {
    data: '/tmp/upload.jpg',
    filename: 'upload.jpg',
    mimeType: 'image/jpeg',
    fieldName: 'file',
  },
];

describe('StorageController 上传链路', () => {
  it('uses multipart fields when storing an uploaded voice material', async () => {
    const { controller, putFile } = createController({
      putFile: jest.fn().mockResolvedValue({
        objectKey: 'voice-training-materials/2026/08/recording.mp4',
        url: 'https://example.com/recording.mp4',
      }),
    });

    const result = await controller.uploadFile(VOICE_UPLOAD as never, {
      folder: 'voice-training-materials',
      fileName: '微信语音录屏.mp4',
      contentType: 'video/mp4',
    });

    expect(putFile).toHaveBeenCalledWith('/tmp/upload.mp4', {
      folder: 'voice-training-materials',
      fileName: '微信语音录屏.mp4',
      contentType: 'video/mp4',
    });
    expect(result.objectKey).toContain('voice-training-materials/');
  });

  it('returns a clear error when COS upload fails', async () => {
    const { controller, release } = createController({
      putFile: jest.fn().mockRejectedValue(new Error('read ECONNRESET')),
    });

    await expect(
      controller.uploadFile(VOICE_UPLOAD as never, {
        folder: 'voice-training-materials',
        fileName: '微信语音录屏.mp4',
        contentType: 'video/mp4',
      })
    ).rejects.toMatchObject({
      code: 'TENCENT_COS_UPLOAD_FAILED',
      message: '文件上传失败，请稍后重试',
      status: 502,
    });
    expect(release).toHaveBeenCalled();
  });

  it('审核通过时正常返回地址', async () => {
    const { controller, deleteObject } = createController({
      putFile: jest.fn().mockResolvedValue({
        objectKey: 'moments/2026/09/30/a.jpg',
        url: 'https://oss.example.com/moments/2026/09/30/a.jpg',
      }),
    });

    const result = await controller.uploadFile(IMAGE_UPLOAD as never, {
      folder: 'moments',
      fileName: '照片.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.publicUrl).toBe(
      'https://oss.example.com/moments/2026/09/30/a.jpg'
    );
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('判定违规时删除对象并拒绝返回地址', async () => {
    const { controller, deleteObject } = createController({
      putFile: jest.fn().mockResolvedValue({
        objectKey: 'moments/2026/09/30/b.jpg',
        url: 'https://oss.example.com/moments/2026/09/30/b.jpg',
      }),
      moderate: jest
        .fn()
        .mockResolvedValue({ decision: 'block', reason: 'violation' }),
    });

    await expect(
      controller.uploadFile(IMAGE_UPLOAD as never, {
        folder: 'moments',
        fileName: '照片.jpg',
        contentType: 'image/jpeg',
      })
    ).rejects.toMatchObject({
      code: 'IMAGE_MODERATION_BLOCKED',
      status: 400,
    });
    expect(deleteObject).toHaveBeenCalledWith('moments/2026/09/30/b.jpg');
  });

  it('疑似违规按策略拦截时返回人工复核提示', async () => {
    const { controller } = createController({
      putFile: jest.fn().mockResolvedValue({
        objectKey: 'moments/2026/09/30/c.jpg',
        url: 'https://oss.example.com/moments/2026/09/30/c.jpg',
      }),
      moderate: jest
        .fn()
        .mockResolvedValue({ decision: 'block', reason: 'suspected' }),
    });

    await expect(
      controller.uploadFile(IMAGE_UPLOAD as never, {
        folder: 'moments',
        contentType: 'image/jpeg',
      })
    ).rejects.toMatchObject({
      code: 'IMAGE_MODERATION_REVIEW_REQUIRED',
      status: 400,
    });
  });

  it('审核服务不可用按策略拦截时返回 503', async () => {
    const { controller } = createController({
      putFile: jest.fn().mockResolvedValue({
        objectKey: 'moments/2026/09/30/d.jpg',
        url: 'https://oss.example.com/moments/2026/09/30/d.jpg',
      }),
      moderate: jest
        .fn()
        .mockResolvedValue({ decision: 'block', reason: 'unavailable' }),
    });

    await expect(
      controller.uploadFile(IMAGE_UPLOAD as never, {
        folder: 'moments',
        contentType: 'image/jpeg',
      })
    ).rejects.toMatchObject({
      code: 'IMAGE_MODERATION_UNAVAILABLE',
      status: 503,
    });
  });

  it('审核服务抛未知异常时不阻塞上传', async () => {
    const { controller } = createController({
      putFile: jest.fn().mockResolvedValue({
        objectKey: 'moments/2026/09/30/e.jpg',
        url: 'https://oss.example.com/moments/2026/09/30/e.jpg',
      }),
      moderate: jest.fn().mockRejectedValue(new Error('unexpected')),
    });

    await expect(
      controller.uploadFile(IMAGE_UPLOAD as never, {
        folder: 'moments',
        contentType: 'image/jpeg',
      })
    ).resolves.toMatchObject({ objectKey: 'moments/2026/09/30/e.jpg' });
  });

  it('超出配额时在上传前拒绝', async () => {
    const { controller, putFile } = createController({
      reserve: jest.fn().mockRejectedValue(
        Object.assign(new Error('今日上传图片数量已达上限（150 张），请明天再试'), {
          code: 'UPLOAD_DAILY_LIMIT_EXCEEDED',
          status: 429,
        })
      ),
    });

    await expect(
      controller.uploadFile(IMAGE_UPLOAD as never, {
        folder: 'moments',
        contentType: 'image/jpeg',
      })
    ).rejects.toMatchObject({ code: 'UPLOAD_DAILY_LIMIT_EXCEEDED' });
    expect(putFile).not.toHaveBeenCalled();
  });

  it('需要审核的图片拒绝客户端直传签名', async () => {
    const { controller, createSignedUpload } = createController();

    await expect(
      controller.createTencentCosSignedUpload({
        folder: 'moments',
        fileName: '照片.jpg',
        contentType: 'image/jpeg',
      } as never)
    ).rejects.toMatchObject({
      code: 'IMAGE_UPLOAD_REQUIRES_SERVER_RELAY',
      status: 400,
    });
    expect(createSignedUpload).not.toHaveBeenCalled();
  });

  it('不在审核范围的直传继续放行', async () => {
    const { controller, createSignedUpload } = createController({
      shouldModerate: jest.fn().mockReturnValue(false),
      createSignedUpload: jest.fn().mockResolvedValue({
        objectKey: 'voice-training-materials/2026/09/30/a.mp3',
      }),
    });

    await expect(
      controller.createTencentCosSignedUpload({
        folder: 'voice-training-materials',
        fileName: '录音.mp3',
        contentType: 'audio/mpeg',
      } as never)
    ).resolves.toMatchObject({
      objectKey: 'voice-training-materials/2026/09/30/a.mp3',
    });
    expect(createSignedUpload).toHaveBeenCalled();
  });
});
