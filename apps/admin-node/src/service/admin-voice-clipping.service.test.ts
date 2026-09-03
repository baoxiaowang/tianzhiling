import { AdminVoiceClippingService } from './admin-voice-clipping.service';

describe('AdminVoiceClippingService', () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.INTERNAL_API_SECRET;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = originalSecret;
    }
    jest.restoreAllMocks();
  });

  function createService() {
    const service = new AdminVoiceClippingService();
    service.logger = {
      error: jest.fn(),
      warn: jest.fn(),
    } as never;
    process.env.INTERNAL_API_SECRET = 'test-secret';
    return service;
  }

  it('preserves the downstream 422 reason for a recut request', async () => {
    const service = createService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        success: false,
        code: 'VOICE_SERVICE_RECUT_DURATION_REQUIRED',
        message: '暂时无法读取这个片段的时长，请重新试听后再试',
        data: null,
      }),
    }) as never;

    await expect(service.recutClip({ objectKey: 'clip.mp3' })).rejects.toEqual(
      expect.objectContaining({
        code: 'VOICE_SERVICE_RECUT_DURATION_REQUIRED',
        message: '暂时无法读取这个片段的时长，请重新试听后再试',
        status: 422,
      })
    );
  });

  it('continues to unwrap a successful node response', async () => {
    const service = createService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { ok: true, clip: { objectKey: 'recut.mp3' } },
      }),
    }) as never;

    await expect(service.recutClip({ objectKey: 'clip.mp3' })).resolves.toEqual(
      { ok: true, clip: { objectKey: 'recut.mp3' } }
    );
  });
});
