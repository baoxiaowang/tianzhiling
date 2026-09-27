import { TencentVrsVoiceService } from '../../src/service/tencent-vrs-voice.service';

function createService(
  overrides: Record<string, unknown> = {}
): TencentVrsVoiceService {
  const service = new TencentVrsVoiceService();
  service.config = {
    enabled: true,
    secretId: 'unit-test-secret-id-not-a-real-credential',
    secretKey: 'unit-test-secret-key-not-a-real-credential',
    region: 'ap-guangzhou',
    vrsEndpoint: 'https://vrs.tencentcloudapi.com',
    ttsEndpoint: 'https://tts.tencentcloudapi.com',
    vrsVersion: '2020-08-24',
    ttsVersion: '2019-08-23',
    singleSentenceVoiceType: '200000000',
    defaultVoiceGender: '2',
    defaultSampleRate: '16000',
    timeoutMs: 120000,
    ...overrides,
  };
  service.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
  return service;
}

/** 让私有 postJson 可见。 */
function expose(service: TencentVrsVoiceService) {
  return service as unknown as {
    postJson: jest.Mock;
    request: jest.Mock;
    buildTc3Signature?: (input: {
      action: string;
      service: 'vrs' | 'tts';
      endpoint: string;
      region?: string;
      version: string;
      payload: Record<string, unknown>;
    }) => { authorization: string; timestamp: number; date: string };
  };
}

describe('TencentVrsVoiceService', () => {
  describe('配置与前置校验', () => {
    it('未启用时抛 TENCENT_VRS_NOT_ENABLED', async () => {
      const service = createService({ enabled: false });
      await expect(service.getTrainingText()).rejects.toMatchObject({
        code: 'TENCENT_VRS_NOT_ENABLED',
      });
    });

    it('缺少凭证时抛 TENCENT_VRS_NOT_CONFIGURED', async () => {
      const service = createService({ secretId: '', secretKey: '' });
      await expect(service.getTrainingText()).rejects.toMatchObject({
        code: 'TENCENT_VRS_NOT_CONFIGURED',
      });
    });

    it('一句话版固定 VoiceType=200000000', () => {
      expect(createService().getSingleSentenceVoiceType()).toBe('200000000');
    });
  });

  describe('TC3 签名结构', () => {
    it('Authorization 使用 TC3-HMAC-SHA256 且 SignedHeaders 正确', async () => {
      const service = createService();
      const api = expose(service);
      api.request = jest.fn().mockResolvedValue({
        statusCode: 200,
        responseBody: Buffer.from(
          JSON.stringify({
            Response: { RequestId: 'r1', Data: { TrainingTextList: [] } },
          }),
          'utf8'
        ),
      }) as never;

      await expect(service.getTrainingText()).rejects.toBeDefined();
      const reqArg = api.request.mock.calls[0][0] as {
        headers: Record<string, string>;
      };
      expect(reqArg.headers['X-TC-Action']).toBe('GetTrainingText');
      expect(reqArg.headers['X-TC-Version']).toBe('2020-08-24');
      expect(reqArg.headers['X-TC-Region']).toBe('ap-guangzhou');
      expect(reqArg.headers['Content-Type']).toBe('application/json; charset=utf-8');
      const auth = reqArg.headers['Authorization'];
      expect(auth).toMatch(/^TC3-HMAC-SHA256 Credential=unit-test-secret-id-not-a-real-credential\/\d{4}-\d{2}-\d{2}\/vrs\/tc3_request/);
      expect(auth).toContain('SignedHeaders=content-type;host;x-tc-action');
      const signature = auth.match(/Signature=([0-9a-f]{64})$/)?.[1];
      expect(signature).toBeTruthy();
      expect(reqArg.headers['X-TC-Timestamp']).toMatch(/^\d{10}$/);
    });

    it('tts 合成使用 tts 服务与对应版本', async () => {
      const service = createService();
      const api = expose(service);
      api.request = jest.fn().mockResolvedValue({
        statusCode: 200,
        responseBody: Buffer.from(
          JSON.stringify({ Response: { RequestId: 'r1', Audio: 'bXNn' } }),
          'utf8'
        ),
      }) as never;

      const result = await service.synthesize({
        text: '你好',
        fastVoiceType: 'WCHN-abc',
      });
      const reqArg = api.request.mock.calls[0][0] as {
        headers: Record<string, string>;
        url: { host: string };
      };
      expect(reqArg.headers['X-TC-Action']).toBe('TextToVoice');
      expect(reqArg.headers['X-TC-Version']).toBe('2019-08-23');
      expect(reqArg.url.host).toBe('tts.tencentcloudapi.com');
      expect(result.audioBuffer.toString()).toBe('msg');
      expect(result.mimeType).toBe('audio/wav');
    });
  });

  describe('GetTrainingText', () => {
    it('携带 TaskType=5 与 TextLanguage=1 并返回训练文本', async () => {
      const service = createService();
      const api = expose(service);
      api.postJson = jest.fn().mockResolvedValue({
        RequestId: 'r1',
        Data: { TrainingTextList: [{ TextId: 'TID-1', Text: '照着这句念' }] },
      }) as never;

      const result = await service.getTrainingText();
      expect(api.postJson.mock.calls[0][0].payload).toEqual({
        TaskType: 5,
        TextLanguage: 1,
      });
      expect(result).toEqual({ textId: 'TID-1', text: '照着这句念' });
    });

    it('腾讯云未返回训练文本时抛错', async () => {
      const service = createService();
      const api = expose(service);
      api.postJson = jest.fn().mockResolvedValue({ Data: {} }) as never;
      await expect(service.getTrainingText()).rejects.toMatchObject({
        code: 'TENCENT_VRS_EMPTY_TRAINING_TEXT',
      });
    });
  });

  describe('DetectEnvAndSoundQuality', () => {
    it('携带 TextId/AudioData/TypeId=2/Codec/SampleRate 并返回 AudioId', async () => {
      const service = createService();
      const api = expose(service);
      api.postJson = jest.fn().mockResolvedValue({
        Data: {
          AudioId: 'AUD-1',
          DetectionCode: 0,
          DetectionMsg: '通过',
          DetectionTip: [{ Word: '你', Tag: 0 }],
        },
      }) as never;

      const result = await service.detectSoundQuality({
        textId: 'TID-1',
        audioBuffer: Buffer.from('RIFF....'),
        codec: 'wav',
      });
      const payload = api.postJson.mock.calls[0][0].payload;
      expect(payload.TextId).toBe('TID-1');
      expect(payload.TypeId).toBe(2);
      expect(payload.Codec).toBe('wav');
      expect(payload.SampleRate).toBe(16000);
      expect(payload.TaskType).toBe(5);
      expect(payload.AudioData).toBe(Buffer.from('RIFF....').toString('base64'));
      expect(result.audioId).toBe('AUD-1');
    });

    it('音频超过 2MB 时抛 TENCENT_VRS_AUDIO_TOO_LARGE', async () => {
      const service = createService();
      await expect(
        service.detectSoundQuality({
          textId: 'TID-1',
          audioBuffer: Buffer.alloc(2 * 1024 * 1024 + 1),
        })
      ).rejects.toMatchObject({ code: 'TENCENT_VRS_AUDIO_TOO_LARGE' });
    });

    it('检测未通过（DetectionCode=-2）时抛检测失败', async () => {
      const service = createService();
      const api = expose(service);
      api.postJson = jest.fn().mockResolvedValue({
        Data: { AudioId: '', DetectionCode: -2, DetectionMsg: '与文本不一致' },
      }) as never;
      await expect(
        service.detectSoundQuality({ textId: 'TID-1', audioBuffer: Buffer.from('x') })
      ).rejects.toMatchObject({
        code: 'TENCENT_VRS_DETECTION_FAILED',
        message: expect.stringContaining('不一致'),
      });
    });
  });

  describe('CreateVRSTask', () => {
    it('携带一句话复刻参数并返回 TaskId', async () => {
      const service = createService();
      const api = expose(service);
      api.postJson = jest.fn().mockResolvedValue({
        Data: { TaskId: 'TASK-1' },
      }) as never;

      const result = await service.createVrsTask({
        audioId: 'AUD-1',
        voiceName: '我的音色',
        voiceGender: 1,
      });
      const payload = api.postJson.mock.calls[0][0].payload;
      expect(payload.VoiceName).toBe('我的音色');
      expect(payload.VoiceGender).toBe(1);
      expect(payload.VoiceGender).not.toBe('1');
      expect(payload.VoiceLanguage).toBe(1);
      expect(payload.AudioIdList).toEqual(['AUD-1']);
      expect(payload.TaskType).toBe(5);
      expect(payload.ModelType).toBe(1);
      expect(result).toEqual({ taskId: 'TASK-1', requestId: undefined });
    });
  });

  describe('DescribeVRSTaskStatus', () => {
    it('解析 Status/FastVoiceType', async () => {
      const service = createService();
      const api = expose(service);
      api.postJson = jest.fn().mockResolvedValue({
        Data: {
          TaskId: 'TASK-1',
          Status: 2,
          StatusStr: '成功',
          VoiceType: 200000000,
          FastVoiceType: 'WCHN-abc123',
        },
      }) as never;

      const result = await service.describeVrsTaskStatus('TASK-1');
      expect(result.status).toBe(2);
      expect(result.voiceType).toBe(200000000);
      expect(result.fastVoiceType).toBe('WCHN-abc123');
    });
  });

  describe('TextToVoice 一句话版合成', () => {
    it('同时传入 VoiceType=200000000 与 FastVoiceType', async () => {
      const service = createService();
      const api = expose(service);
      api.postJson = jest.fn().mockResolvedValue({
        RequestId: 'r1',
        Audio: Buffer.from('wav-data').toString('base64'),
      }) as never;

      const result = await service.synthesize({
        text: '你好呀',
        fastVoiceType: 'WCHN-abc123',
      });
      const payload = api.postJson.mock.calls[0][0].payload;
      expect(payload.VoiceType).toBe(200000000);
      expect(payload.FastVoiceType).toBe('WCHN-abc123');
      expect(payload.Text).toBe('你好呀');
      expect(result.audioBuffer.toString()).toBe('wav-data');
    });

    it('超过 150 字抛 TENCENT_VRS_TEXT_TOO_LONG', async () => {
      const service = createService();
      await expect(
        service.synthesize({ text: '好'.repeat(151), fastVoiceType: 'WCHN-a' })
      ).rejects.toMatchObject({ code: 'TENCENT_VRS_TEXT_TOO_LONG' });
    });
  });

  describe('API 错误映射', () => {
    it('配额不足映射为 TENCENT_VRS_QUOTA_EXHAUSTED', async () => {
      const service = createService();
      const api = expose(service);
      api.request = jest.fn().mockResolvedValue({
        statusCode: 400,
        responseBody: Buffer.from(
          JSON.stringify({
            Response: {
              Error: {
                Code: 'UnsupportedOperation.VRSQuotaExhausted',
                Message: '无声音复刻任务配额',
              },
            },
          }),
          'utf8'
        ),
      }) as never;
      await expect(
        service.createVrsTask({ audioId: 'A', voiceName: 'v' })
      ).rejects.toMatchObject({
        code: 'TENCENT_VRS_QUOTA_EXHAUSTED',
        status: 402,
      });
    });

    it('公共错误映射为 TENCENT_VRS_API_ERROR 并保留 code', async () => {
      const service = createService();
      const api = expose(service);
      api.request = jest.fn().mockResolvedValue({
        statusCode: 400,
        responseBody: Buffer.from(
          JSON.stringify({
            Response: {
              Error: { Code: 'AuthFailure.SignatureFailure', Message: 'sig' },
            },
          }),
          'utf8'
        ),
      }) as never;
      await expect(
        service.getTrainingText()
      ).rejects.toMatchObject({ code: 'TENCENT_VRS_API_ERROR' });
    });
  });

  describe('删除能力限制', () => {
    it('deleteVoice 明确返回 supported:false（VRS 无公开删除接口）', async () => {
      const service = createService();
      const result = await service.deleteVoice({ fastVoiceType: 'WCHN-abc' });
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('无删除音色接口');
    });
  });
});
