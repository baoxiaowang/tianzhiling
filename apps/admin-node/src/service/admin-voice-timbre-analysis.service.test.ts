import { AdminVoiceTimbreAnalysisService } from './admin-voice-timbre-analysis.service';

describe('AdminVoiceTimbreAnalysisService', () => {
  const createService = () => {
    const service = new AdminVoiceTimbreAnalysisService();
    service.config = {
      apiKey: 'test-key',
      model: 'qwen3.5-omni-plus',
    };
    service.logger = { info: jest.fn() } as never;
    service.storageFileService = {
      resolve: jest.fn(objectKey => `https://audio.example.com/${objectKey}`),
    } as never;
    return service;
  };

  it('analyzes selected clips and returns a normalized description', async () => {
    const service = createService();
    const requestJson = jest.fn().mockResolvedValue({
      id: 'request-1',
      choices: [
        {
          message: {
            content:
              '```json\n{"description":"声音温暖偏低，语速舒缓，停顿自然，整体听感亲切平和。","instruction":"请保持温暖偏低、舒缓亲切的声音和自然停顿"}\n```',
          },
        },
      ],
    });
    (service as unknown as { requestJson: typeof requestJson }).requestJson =
      requestJson;

    await expect(
      service.analyze({
        objectKeys: [
          'voice-service-clips/first.mp3',
          'voice-service-clips/second.wav',
        ],
        transcripts: ['你好', '最近好吗'],
      })
    ).resolves.toEqual({
      description: '声音温暖偏低，语速舒缓，停顿自然，整体听感亲切平和。',
      instruction: '请保持温暖偏低、舒缓亲切的声音和自然停顿',
      model: 'qwen3.5-omni-plus',
      requestId: 'request-1',
    });

    expect(requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen3.5-omni-plus',
        modalities: ['text'],
        stream: true,
      })
    );
    const requestBody = requestJson.mock.calls[0][0];
    expect(requestBody.messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input_audio: expect.objectContaining({ format: 'mp3' }),
        }),
        expect.objectContaining({
          input_audio: expect.objectContaining({ format: 'wav' }),
        }),
      ])
    );
  });

  it('derives an executable instruction when the model omits it', async () => {
    const service = createService();
    const requestJson = jest.fn().mockResolvedValue({
      id: 'request-fallback',
      choices: [
        {
          message: {
            content: '{"description":"声音清亮，节奏自然。"}',
          },
        },
      ],
    });
    (service as unknown as { requestJson: typeof requestJson }).requestJson =
      requestJson;

    await expect(
      service.analyze({ objectKeys: ['voice-service-clips/first.mp3'] })
    ).resolves.toMatchObject({
      description: '声音清亮，节奏自然。',
      instruction: '请保持声音清亮，节奏自然',
    });
  });

  it('rejects object keys outside managed voice directories', async () => {
    const service = createService();

    await expect(
      service.analyze({ objectKeys: ['other/private.mp3'] })
    ).rejects.toMatchObject({ code: 'VOICE_TIMBRE_ANALYSIS_AUDIO_INVALID' });
  });

  it('combines streamed text chunks from the Omni API', () => {
    const service = createService();
    const parse = (
      service as unknown as {
        parseCompletionResponse: (raw: string) => {
          choices?: Array<{ message?: { content?: string } }>;
        };
      }
    ).parseCompletionResponse.bind(service);

    const response = parse(
      [
        'data: {"id":"request-2","choices":[{"delta":{"content":"{\\"description\\":\\"声音温暖"}}]}',
        'data: {"id":"request-2","choices":[{"delta":{"content":"舒缓\\"}"}}]}',
        'data: [DONE]',
      ].join('\n')
    );

    expect(response.choices?.[0]?.message?.content).toBe(
      '{"description":"声音温暖舒缓"}'
    );
  });
});
