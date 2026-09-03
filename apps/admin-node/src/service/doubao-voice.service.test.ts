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
        if (path.endsWith('/get_voice')) {
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
      '/api/v3/tts/get_voice',
      '/api/v3/tts/voice_clone',
      '/api/v3/tts/get_voice',
      '/api/v3/tts/get_voice',
      '/api/v3/tts/get_voice',
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
        if (path.endsWith('/get_voice')) {
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

describe('DoubaoVoiceService fixed slot remaining times', () => {
  it('derives remaining training times from the provider version without OpenAPI', async () => {
    const service = createService();
    service.config.knownSpeakerIds = 'S_TEST003';
    service.config.maxTrainingTimes = 15;
    jest.spyOn(service, 'queryVoice').mockResolvedValue({
      voiceId: 'S_TEST003',
      status: 'ready',
      statusCode: 2,
      version: 4,
    });

    const result = await service.listSlots();

    expect(result.openApiSyncAttempted).toBe(false);
    expect(result.items).toEqual([
      expect.objectContaining({
        speakerId: 'S_TEST003',
        availableTrainingTimes: 11,
      }),
    ]);
  });

  it('treats an untrained fixed slot as having the full configured allowance', async () => {
    const service = createService();
    service.config.knownSpeakerIds = 'S_TEST004';
    service.config.maxTrainingTimes = 15;
    jest.spyOn(service, 'queryVoice').mockResolvedValue({
      voiceId: 'S_TEST004',
      status: 'not_found',
      statusCode: 0,
    });

    const result = await service.listSlots();

    expect(result.items[0].availableTrainingTimes).toBe(15);
  });
});
