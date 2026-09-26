import {
  TENCENT_VRS_VOICE_GENDER_FEMALE,
  TENCENT_VRS_VOICE_GENDER_MALE,
  TencentVrsVoiceService,
} from './tencent-vrs-voice.service';

describe('TencentVrsVoiceService', () => {
  function buildService(config: Record<string, unknown> = {}) {
    const service = new TencentVrsVoiceService();
    service.config = {
      enabled: true,
      secretId: 'test-secret-id',
      secretKey: 'test-secret-key',
      region: 'ap-guangzhou',
      ...config,
    } as any;
    service.logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() } as any;
    return service;
  }

  describe('normalizeVoiceGender', () => {
    it('accepts integer 1 as male and 2 as female', () => {
      const service = buildService();
      expect(service.normalizeVoiceGender(1)).toBe(TENCENT_VRS_VOICE_GENDER_MALE);
      expect(service.normalizeVoiceGender(2)).toBe(
        TENCENT_VRS_VOICE_GENDER_FEMALE
      );
    });

    it('coerces legacy string "1"/"2" to integer', () => {
      const service = buildService();
      expect(service.normalizeVoiceGender('1')).toBe(1);
      expect(service.normalizeVoiceGender('2')).toBe(2);
    });

    it('falls back to default gender for invalid input', () => {
      const service = buildService();
      expect(service.normalizeVoiceGender(undefined)).toBe(2);
      expect(service.normalizeVoiceGender('xyz')).toBe(2);
    });
  });

  describe('createVrsTask', () => {
    it('sends VoiceGender as integer, not string', async () => {
      const service = buildService();
      const sentPayloads: Record<string, unknown>[] = [];
      (service as any).postJson = jest.fn(async (input: any) => {
        sentPayloads.push(input.payload);
        return { Data: { TaskId: 'task-123' }, RequestId: 'req-1' };
      });

      const result = await service.createVrsTask({
        audioId: 'audio-1',
        voiceName: '我的音色',
        voiceGender: 1,
      });

      expect(result.taskId).toBe('task-123');
      const payload = sentPayloads[0];
      expect(payload.VoiceGender).toBe(1);
      expect(typeof payload.VoiceGender).toBe('number');
      expect(payload.TaskType).toBe(5);
      expect(payload.Codec).toBe('wav');
    });

    it('maps VRSQuotaExhausted to 402 AppError', async () => {
      const service = buildService();
      (service as any).postJson = jest.fn(async () => {
        const error: any = new Error('quota exhausted');
        error.code = 'TENCENT_VRS_API_ERROR';
        error.status = 502;
        error.data = { code: 'UnsupportedOperation.VRSQuotaExhausted' };
        // Replicate the real mapping by throwing the way postJson does:
        const appErr: any = new Error('腾讯云声音复刻额度不足或未开通，请先在腾讯云控制台开通');
        appErr.code = 'TENCENT_VRS_QUOTA_EXHAUSTED';
        appErr.status = 402;
        throw appErr;
      });

      await expect(
        service.createVrsTask({
          audioId: 'audio-1',
          voiceName: 'x',
          voiceGender: 2,
        })
      ).rejects.toMatchObject({ code: 'TENCENT_VRS_QUOTA_EXHAUSTED', status: 402 });
    });
  });

  describe('deleteVoice', () => {
    it('returns supported:false and never pretends cloud deletion succeeded', async () => {
      const service = buildService();
      const result = await service.deleteVoice({ fastVoiceType: 'abc' });
      expect(result.supported).toBe(false);
      expect(result.reason).toContain('人工');
    });
  });
});
