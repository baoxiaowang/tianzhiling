import { QwenVoiceService } from './qwen-voice.service';

function createService() {
  const service = new QwenVoiceService();
  service.config = {
    enabled: true,
    apiKey: 'test-api-key',
    baseURL: 'https://dashscope.aliyuncs.com',
  };
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as any;
  return service;
}

describe('QwenVoiceService model endpoints', () => {
  it('keeps the existing Qwen3 voice cloning endpoint compatible', () => {
    const service = createService();

    expect(() =>
      service.assertModelConfigured('qwen3-tts-vc-2026-01-22')
    ).not.toThrow();
  });

  it('falls back to the configured DashScope endpoint for Qwen Audio models', () => {
    const service = createService();

    expect(() =>
      service.assertModelConfigured('qwen-audio-3.0-tts-plus')
    ).not.toThrow();
  });

  it.each(['qwen-audio-3.0-tts-plus', 'qwen-audio-3.0-tts-flash'])(
    'accepts configured Qwen Audio model %s',
    model => {
      const service = createService();
      service.config.audioBaseURL =
        'https://workspace.cn-beijing.maas.aliyuncs.com';

      expect(() => service.assertModelConfigured(model)).not.toThrow();
    }
  );
});
