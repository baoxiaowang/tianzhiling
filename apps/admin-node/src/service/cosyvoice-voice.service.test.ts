import { CosyVoiceVoiceService } from './cosyvoice-voice.service';

describe('CosyVoiceVoiceService', () => {
  it('uses the model inferred from voice id when preview model is mismatched', async () => {
    const service = new CosyVoiceVoiceService();
    const audioData = Buffer.from('preview-data').toString('base64');

    service.config = {
      enabled: true,
      apiKey: 'dashscope-api-key',
      baseURL: 'https://dashscope.example.com',
      defaultPreviewModel: 'cosyvoice-v3.5-plus',
      defaultLanguageHint: 'zh',
    };
    service.logger = {
      warn: jest.fn(),
    } as any;
    (service as any).requestJson = jest.fn(async input => {
      const payload = JSON.parse(input.body.toString('utf8'));

      expect(payload).toEqual(
        expect.objectContaining({
          model: 'cosyvoice-v1',
          input: expect.objectContaining({
            text: '试听文本',
            voice: 'cosyvoice-v1-tzlvoice',
          }),
        })
      );

      return {
        request_id: 'dashscope-preview-001',
        output: {
          audio: {
            data: audioData,
          },
        },
      };
    });

    const result = await service.synthesizePreview({
      text: '试听文本',
      voiceId: 'cosyvoice-v1-tzlvoice',
      model: 'cosyvoice-v3.5-plus',
    });

    expect(result.audioBuffer).toEqual(Buffer.from('preview-data'));
    expect(service.logger.warn).toHaveBeenCalledWith(
      '[cosyvoice] preview model mismatch, inputModel=%s, voiceModel=%s, voiceId=%s',
      'cosyvoice-v3.5-plus',
      'cosyvoice-v1',
      'cosyvoice-v1-tzlvoice'
    );
  });
});
