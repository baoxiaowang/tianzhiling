import { TencentCosService } from '../../src/service/tencent-cos.service';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

describe('TencentCosService cache headers', () => {
  function createService() {
    const putObject = jest.fn().mockResolvedValue({});
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
    service.logger = { info: jest.fn() } as never;
    (service as any).client = { putObject, getObjectUrl };
    return { service, putObject, getObjectUrl };
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
});
