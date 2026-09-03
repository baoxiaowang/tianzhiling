import { TencentCosService } from '../../src/service/tencent-cos.service';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

describe('TencentCosService cache headers', () => {
  function createService() {
    const putObject = jest.fn().mockResolvedValue({});
    const uploadFile = jest.fn().mockResolvedValue({});
    const deleteObject = jest.fn().mockResolvedValue({});
    const logError = jest.fn();
    const getObjectUrl = jest
      .fn()
      .mockReturnValue('https://upload.example.com/signed');
    const service = new TencentCosService();
    service.cosConfig = {
      enabled: true,
      bucket: 'bucket-1',
      region: 'ap-shanghai',
      secretId: 'secret-id',
      secretKey: 'secret-key',
      publicBaseUrl: 'https://oss.tianzhiling.chat',
    };
    service.logger = { info: jest.fn(), error: logError } as never;
    (service as any).client = {
      putObject,
      uploadFile,
      deleteObject,
      getObjectUrl,
    };
    return {
      service,
      putObject,
      uploadFile,
      deleteObject,
      getObjectUrl,
      logError,
    };
  }

  it('marks server-side uploads as immutable', async () => {
    const { service, putObject } = createService();

    await service.putBuffer(Buffer.from('image'), {
      objectKey: 'moments/photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: 'moments/photo.jpg',
        ContentType: 'image/jpeg',
        CacheControl: CACHE_CONTROL,
      })
    );
  });

  it('requires immutable cache headers on signed uploads', () => {
    const { service, getObjectUrl } = createService();

    const result = service.createSignedUpload({
      objectKey: 'moments/photo.jpg',
      contentType: 'image/jpeg',
    });

    expect(result.headers).toEqual({
      'Cache-Control': CACHE_CONTROL,
      'Content-Type': 'image/jpeg',
    });
    expect(getObjectUrl).toHaveBeenCalledWith(
      expect.objectContaining({ Headers: result.headers })
    );
  });

  it('physically deletes an object from the configured bucket', async () => {
    const { service, deleteObject } = createService();

    await service.deleteObject('voice-training-materials/2026/sample.mp3');

    expect(deleteObject).toHaveBeenCalledWith({
      Bucket: 'bucket-1',
      Region: 'ap-shanghai',
      Key: 'voice-training-materials/2026/sample.mp3',
    });
  });

  it('logs provider details when a file upload fails', async () => {
    const { service, uploadFile, logError } = createService();
    const providerError = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      statusCode: 502,
      requestId: 'request-1',
    });
    uploadFile.mockRejectedValue(providerError);

    await expect(
      service.putFile('/dev/null', {
        objectKey: 'voice-training-materials/sample.mp4',
        contentType: 'video/mp4',
      })
    ).rejects.toBe(providerError);

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('file upload failed'),
      'voice-training-materials/sample.mp4',
      expect.any(Number),
      expect.objectContaining({
        code: 'ECONNRESET',
        statusCode: 502,
        message: 'socket hang up',
        requestId: 'request-1',
      })
    );
  });

  it('uses resumable multipart-capable uploads for local files', async () => {
    const { service, uploadFile } = createService();

    await service.putFile('/dev/null', {
      objectKey: 'voice-training-materials/sample.mp4',
      contentType: 'video/mp4',
    });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        FilePath: '/dev/null',
        SliceSize: 5 * 1024 * 1024,
        ChunkSize: 5 * 1024 * 1024,
        CacheControl: CACHE_CONTROL,
      })
    );
  });

  it('only resolves deletion keys from the configured public origin', () => {
    const { service } = createService();

    expect(
      service.resolveObjectKeyFromPublicUrl(
        'https://oss.tianzhiling.chat/voice-timbre-previews/sample.wav',
        ['voice-timbre-previews']
      )
    ).toBe('voice-timbre-previews/sample.wav');
    expect(
      service.resolveObjectKeyFromPublicUrl(
        'https://untrusted.example/voice-timbre-previews/sample.wav',
        ['voice-timbre-previews']
      )
    ).toBeUndefined();
  });
});
