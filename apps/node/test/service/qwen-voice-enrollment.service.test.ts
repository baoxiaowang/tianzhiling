import { QwenVoiceEnrollmentService } from '../../src/service/qwen-voice-enrollment.service';

describe('QwenVoiceEnrollmentService', () => {
  it('uses the provider delete action for a cloned voice', async () => {
    const service = new QwenVoiceEnrollmentService();
    service.config = { enabled: true, apiKey: 'test-key' };
    service.logger = { info: jest.fn() } as never;
    const requestJson = jest
      .spyOn(service as never, 'requestJson' as never)
      .mockResolvedValue({ request_id: 'request-delete-1' } as never);

    const result = await service.deleteVoice('qwen_voice_123');

    const [path, body] = requestJson.mock.calls[0] as unknown as [
      string,
      Buffer
    ];
    expect(path).toBe('/api/v1/services/audio/tts/customization');
    expect(JSON.parse(body.toString('utf8'))).toEqual({
      model: 'qwen-voice-enrollment',
      input: { action: 'delete', voice: 'qwen_voice_123' },
    });
    expect(result).toEqual({ requestId: 'request-delete-1' });
  });
});
