import { PostImageService } from '../../src/service/post-image.service';

describe('PostImageService feed thumbnails', () => {
  function createService() {
    const service = new PostImageService();
    service.tencentCosConfig = {
      enabled: true,
      publicBaseUrl: 'https://oss.tianzhiling.chat',
    };
    service.ossConfig = {};
    service.tencentCosService = {
      isEnabled: jest.fn(() => true),
      getPublicUrl: jest.fn(
        (key: string) => `https://oss.tianzhiling.chat/${key}`
      ),
    } as never;
    service.ossService = {
      isEnabled: jest.fn(() => false),
    } as never;
    return service;
  }

  it('adds a Tencent CI list-image transformation without changing the original URL', () => {
    const service = createService();
    const original = service.resolveForResponse('moments/photo.jpg');
    const thumbnail =
      service.resolveFeedThumbnailForResponse('moments/photo.jpg');

    expect(original).toBe('https://oss.tianzhiling.chat/moments/photo.jpg');
    expect(thumbnail).toBe(
      `${original}?imageMogr2/thumbnail/480x/format/jpg/quality/75`
    );
  });

  it('leaves external images unchanged', () => {
    const service = createService();
    const external = 'https://example.com/photo.jpg';

    expect(service.resolveFeedThumbnailForResponse(external)).toBe(external);
  });
});
