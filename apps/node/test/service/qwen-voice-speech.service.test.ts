import { QwenVoiceSpeechService } from '../../src/service/qwen-voice-speech.service';

describe('QwenVoiceSpeechService model endpoints', () => {
  it('keeps Qwen3 TTS VC on the standard DashScope endpoint', () => {
    const service = new QwenVoiceSpeechService();
    service.config = {
      enabled: true,
      apiKey: 'test-key',
      baseURL: 'https://dashscope.aliyuncs.com/',
    };

    expect((service as any).resolveBaseURL('qwen3-tts-vc-2026-01-22')).toBe(
      'https://dashscope.aliyuncs.com'
    );
  });

  it('falls back to the standard DashScope endpoint for Qwen Audio models', () => {
    const service = new QwenVoiceSpeechService();
    service.config = {
      enabled: true,
      apiKey: 'test-key',
      baseURL: 'https://dashscope.aliyuncs.com',
    };

    expect((service as any).resolveBaseURL('qwen-audio-3.0-tts-plus')).toBe(
      'https://dashscope.aliyuncs.com'
    );
  });

  it.each(['qwen-audio-3.0-tts-plus', 'qwen-audio-3.0-tts-flash'])(
    'uses the configured Workspace endpoint for %s',
    model => {
      const service = new QwenVoiceSpeechService();
      service.config = {
        enabled: true,
        apiKey: 'test-key',
        baseURL: 'https://dashscope.aliyuncs.com',
        audioBaseURL: 'https://workspace-id.cn-beijing.maas.aliyuncs.com/',
      };

      expect((service as any).resolveBaseURL(model)).toBe(
        'https://workspace-id.cn-beijing.maas.aliyuncs.com'
      );
    }
  );

  it.each(['qwen-audio-3.0-tts-plus', 'qwen-audio-3.0-tts-flash'])(
    'maps dialect, instruction and rate for %s synthesis',
    async model => {
      const service = new QwenVoiceSpeechService();
      service.config = {
        enabled: true,
        apiKey: 'test-key',
        audioBaseURL: 'https://workspace-id.cn-beijing.maas.aliyuncs.com',
      };
      service.logger = { info: jest.fn() } as never;
      const requestJson = jest
        .spyOn(service as never, 'requestJson' as never)
        .mockResolvedValue({
          request_id: 'request-1',
          output: {
            audio: { data: Buffer.from('wav').toString('base64') },
          },
        } as never);

      const result = await service.synthesize({
        text: '宝贝，我好想你。',
        voiceId: 'qwen-audio-voice-1',
        model,
        language: 'zh',
        dialect: 'sichuan',
        instruction: '语气亲切自然',
        speed: 1.15,
      });

      const request = requestJson.mock.calls[0][0] as unknown as {
        path: string;
        model: string;
        body: Buffer;
      };
      expect(request.path).toBe('/api/v1/services/audio/tts/SpeechSynthesizer');
      expect(request.model).toBe(model);
      expect(JSON.parse(request.body.toString('utf8'))).toEqual({
        model,
        input: expect.objectContaining({
          text: '宝贝，我好想你。',
          voice: 'qwen-audio-voice-1',
          format: 'wav',
          sample_rate: 24000,
          language_hints: ['zh'],
          rate: 1.15,
          instruction: expect.stringContaining('语气亲切自然'),
        }),
      });
      expect(result.nativeSpeechSpeedApplied).toBe(true);
    }
  );
});
