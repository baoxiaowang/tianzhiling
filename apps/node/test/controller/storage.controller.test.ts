import { StorageController } from '../../src/controller/storage.controller';

describe('StorageController', () => {
  it('uses multipart fields when storing an uploaded voice material', async () => {
    const controller = new StorageController();
    const putFile = jest.fn().mockResolvedValue({
      objectKey: 'voice-training-materials/2026/08/recording.mp4',
      url: 'https://example.com/recording.mp4',
    });
    controller.tencentCosService = { putFile } as never;

    const result = await controller.uploadFile(
      [
        {
          data: '/tmp/upload.mp4',
          filename: 'upload.mp4',
          mimeType: 'video/mp4',
          fieldName: 'file',
        },
      ],
      {
        folder: 'voice-training-materials',
        fileName: '微信语音录屏.mp4',
        contentType: 'video/mp4',
      }
    );

    expect(putFile).toHaveBeenCalledWith('/tmp/upload.mp4', {
      folder: 'voice-training-materials',
      fileName: '微信语音录屏.mp4',
      contentType: 'video/mp4',
    });
    expect(result.objectKey).toContain('voice-training-materials/');
  });

  it('returns a clear error when COS upload fails', async () => {
    const controller = new StorageController();
    controller.tencentCosService = {
      putFile: jest.fn().mockRejectedValue(new Error('read ECONNRESET')),
    } as never;

    await expect(
      controller.uploadFile(
        [
          {
            data: '/tmp/upload.mp4',
            filename: 'upload.mp4',
            mimeType: 'video/mp4',
          },
        ] as never,
        {
          folder: 'voice-training-materials',
          fileName: '微信语音录屏.mp4',
          contentType: 'video/mp4',
        }
      )
    ).rejects.toMatchObject({
      code: 'TENCENT_COS_UPLOAD_FAILED',
      message: '文件上传失败，请稍后重试',
      status: 502,
    });
  });
});
