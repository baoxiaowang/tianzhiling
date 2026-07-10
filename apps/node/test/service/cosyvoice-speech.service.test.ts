import { CosyVoiceSpeechService } from '../../src/service/cosyvoice-speech.service';

describe('CosyVoiceSpeechService', () => {
  it('uses the model inferred from voice id when the stored model is mismatched', async () => {
    const service = new CosyVoiceSpeechService();
    const audioData = Buffer.from('mp3-data').toString('base64');

    service.config = {
      enabled: true,
      apiKey: 'dashscope-api-key',
      baseURL: 'https://dashscope.example.com',
      defaultSpeechModel: 'cosyvoice-v3.5-plus',
      outputFormat: 'mp3',
      sampleRate: 24000,
    };
    service.logger = {
      info: jest.fn(),
      warn: jest.fn(),
    } as any;
    (service as any).requestBinary = jest.fn(async input => {
      const payload = JSON.parse(input.body.toString('utf8'));

      expect(payload).toEqual(
        expect.objectContaining({
          model: 'cosyvoice-v2',
          input: expect.objectContaining({
            text: '你好',
            voice: 'cosyvoice-v2-tzlvoice',
          }),
        })
      );

      return {
        statusCode: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify({
            request_id: 'dashscope-request-001',
            output: {
              audio: {
                data: audioData,
              },
            },
          })
        ),
      };
    });

    const result = await service.synthesize({
      text: '你好',
      voiceId: 'cosyvoice-v2-tzlvoice',
      model: 'cosyvoice-v3.5-plus',
    });

    expect(result.audioBuffer).toEqual(Buffer.from('mp3-data'));
    expect(service.logger.warn).toHaveBeenCalledWith(
      '[cosyvoice-speech] model mismatch, inputModel=%s, voiceModel=%s, voiceId=%s',
      'cosyvoice-v3.5-plus',
      'cosyvoice-v2',
      'cosyvoice-v2-tzlvoice'
    );
  });
});
