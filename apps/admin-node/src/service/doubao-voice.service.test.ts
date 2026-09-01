import { DoubaoVoiceService } from './doubao-voice.service';

function createService() {
  const service = new DoubaoVoiceService();
  service.config = {
    enabled: true,
    apiKey: 'test-api-key',
    appId: 'test-app-id',
    trainingTimeoutMs: 1000,
    pollIntervalMs: 1,
  };
  service.logger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as any;
  jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

  return service;
}

describe('DoubaoVoiceService cloneVoice', () => {
  it('does not accept the previous active revision as retraining completion', async () => {
    const service = createService();
    const statusResponses = [
      {
        BaseResp: { StatusCode: 0 },
        status: 4,
        version: 1,
        create_time: 1000,
        speaker_id: 'S_TEST001',
        request_id: 'baseline-status',
      },
      {
        BaseResp: { StatusCode: 0 },
        status: 4,
        version: 1,
        create_time: 1000,
        speaker_id: 'S_TEST001',
        request_id: 'stale-active-status',
      },
      {
        BaseResp: { StatusCode: 0 },
        status: 1,
        version: 1,
        create_time: 1000,
        speaker_id: 'S_TEST001',
        request_id: 'training-status',
      },
      {
        BaseResp: { StatusCode: 0 },
        status: 2,
        version: 2,
        create_time: 2000,
        speaker_id: 'S_TEST001',
        request_id: 'new-ready-status',
      },
    ];
    const requestTrainingJson = jest
      .spyOn(service as any, 'requestTrainingJson')
      .mockImplementation(async (path: string) => {
        if (path.endsWith('/status')) {
          return statusResponses.shift();
        }
        return {
          BaseResp: { StatusCode: 0 },
          request_id: 'upload-request',
        };
      });

    const result = await service.cloneVoice({
      buffer: Buffer.from('new training audio'),
      fileName: 'training.wav',
      speakerId: 'S_TEST001',
    });

    expect(result).toEqual(
      expect.objectContaining({
        providerVoiceId: 'S_TEST001',
        providerStatus: 'ready',
        version: 2,
        requestId: 'new-ready-status',
      })
    );
    expect(requestTrainingJson.mock.calls.map(call => call[0])).toEqual([
      '/api/v1/mega_tts/status',
      '/api/v1/mega_tts/audio/upload',
      '/api/v1/mega_tts/status',
      '/api/v1/mega_tts/status',
      '/api/v1/mega_tts/status',
    ]);
  });

  it('accepts the first ready revision for an untrained speaker slot', async () => {
    const service = createService();
    const statusResponses = [
      {
        BaseResp: { StatusCode: 0 },
        status: 0,
        speaker_id: 'S_TEST002',
        request_id: 'not-found-status',
      },
      {
        BaseResp: { StatusCode: 0 },
        status: 2,
        version: 1,
        create_time: 2000,
        speaker_id: 'S_TEST002',
        request_id: 'first-ready-status',
      },
    ];
    jest
      .spyOn(service as any, 'requestTrainingJson')
      .mockImplementation(async (path: string) => {
        if (path.endsWith('/status')) {
          return statusResponses.shift();
        }
        return {
          BaseResp: { StatusCode: 0 },
          request_id: 'upload-request',
        };
      });

    const result = await service.cloneVoice({
      buffer: Buffer.from('first training audio'),
      fileName: 'training.wav',
      speakerId: 'S_TEST002',
    });

    expect(result).toEqual(
      expect.objectContaining({
        providerStatus: 'ready',
        version: 1,
      })
    );
  });
});
