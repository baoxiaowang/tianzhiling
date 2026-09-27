import { VoiceTimbreProvider, VoiceTimbreStatus } from '@tzl/entities';
import { AdminTencentVrsService } from './admin-tencent-vrs.service';

/**
 * 模拟跨进程共享的 Redis（SET NX PX + Lua 释放）。
 * 两个 service 实例共享同一个 fakeRedis，模拟两个后台进程。
 */
class FakeRedis {
  store = new Map<string, string>();

  async set(key: string, token: string, _px: string, ttlMs: number, nx: string) {
    if (nx === 'NX' && this.store.has(key)) {
      return null;
    }
    this.store.set(key, token);
    // TTL 不真正过期，测试用例很短；这里仅记录参数避免未使用告警。
    void ttlMs;
    return 'OK';
  }

  async eval(script: string, numKeys: number, key: string, token: string) {
    void script;
    void numKeys;
    if (this.store.get(key) === token) {
      this.store.delete(key);
      return 1;
    }
    return 0;
  }
}

function buildQueue(redis: FakeRedis) {
  return {
    client: Promise.resolve(redis),
  };
}

function buildService(redis: FakeRedis, db: Map<string, any>) {
  const service = new AdminTencentVrsService();
  service.logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as any;

  // 共享内存 DB：两个 service 实例读写同一份 Map，模拟同一个 Mongo。
  service.voiceTimbreModel = {
    findOne: jest.fn(async ({ where }: any) => {
      const id = String(where._id);
      return db.get(id);
    }),
    save: jest.fn(async (timbre: any) => {
      const id = String(timbre.id);
      db.set(id, { ...timbre });
      return timbre;
    }),
  } as any;

  service.tencentVrsVoiceService = {
    ensureConfigured: jest.fn(),
    normalizeVoiceGender: jest.fn((v: number) => v),
    getSingleSentenceVoiceType: jest.fn(() => '200000000'),
    describeVrsTaskStatus: jest.fn(async (taskId: string) => ({
      taskId,
      status: 2,
      statusStr: 'SUCCESS',
      fastVoiceType: 'fast-voice-123',
    })),
    synthesize: jest.fn(async () => ({
      audioBuffer: Buffer.from('mp3-audio'),
      mimeType: 'audio/mpeg',
      requestId: 'req-1',
    })),
    detectSoundQuality: jest.fn(async () => ({
      audioId: 'detected-audio-id',
      detectionCode: 0,
      detectionMsg: 'ok',
      detectionTip: [],
    })),
  } as any;

  service.storageFileService = {
    normalizeForStorage: jest.fn((v: string) => v),
    download: jest.fn(async () => ({
      buffer: Buffer.from('raw-audio'),
      fileName: 'rec.wav',
      contentType: 'audio/wav',
    })),
  } as any;

  service.storageService = {
    uploadCosBuffer: jest.fn(async () => ({
      objectKey: 'voice-timbre-previews/preview.mp3',
      publicUrl: 'https://cdn.example.com/preview.mp3',
      contentType: 'audio/mpeg',
    })),
  } as any;

  service.ffmpegService = {
    extractAudioToWav: jest.fn(async ({ buffer }: any) => ({
      buffer: Buffer.concat([buffer, Buffer.from('-16k')]),
      fileName: 'rec.wav',
      contentType: 'audio/wav',
    })),
  } as any;

  service.bullmqFramework = {
    getQueue: jest.fn(() => buildQueue(redis)),
    createQueue: jest.fn(() => buildQueue(redis)),
  } as any;

  return service;
}

describe('AdminTencentVrsService', () => {
  describe('detectQuality sample-rate consistency', () => {
    it('normalizes audio to 16k with ffmpeg and declares sampleRate=16000 to Tencent', async () => {
      const redis = new FakeRedis();
      const db = new Map<string, any>();
      const service = buildService(redis, db);

      await service.detectQuality({ audioKey: 'voice-timbres/rec.wav', textId: 'txt-1' });

      // ffmpeg 必须收到 sampleRate:16000
      expect(service.ffmpegService.extractAudioToWav).toHaveBeenCalledWith(
        expect.objectContaining({
          buffer: expect.any(Buffer),
          sampleRate: 16000,
        })
      );

      // 发给腾讯云的 sampleRate 必须与实际归一化采样率一致（16000）
      expect(service.tencentVrsVoiceService.detectSoundQuality).toHaveBeenCalledWith(
        expect.objectContaining({
          sampleRate: 16000,
          codec: 'wav',
          textId: 'txt-1',
        })
      );
    });
  });

  describe('getTrainStatus cross-process distributed lock', () => {
    it('synthesizes paid preview only once when two processes poll concurrently', async () => {
      const redis = new FakeRedis();
      const db = new Map<string, any>();

      const timbreId = '65f1a2b3c4d5e6f7a8b9c0d1';
      // 初始状态：creating，providerTaskId 已就绪，尚未合成试听。
      db.set(timbreId, {
        id: timbreId,
        userId: '65f1a2b3c4d5e6f7a8b9c0d2',
        name: '爸爸的声音',
        provider: VoiceTimbreProvider.tencent_vrs,
        providerVoiceId: 'pending_task-1',
        providerTaskId: 'task-1',
        providerVoiceType: '',
        audioObjectKey: 'voice-timbres/rec.wav',
        cloneLanguage: 'zh',
        previewText: '测试试听文本',
        previewModel: 'tencent-vrs-single-sentence',
        previewAudioUrl: '',
        status: VoiceTimbreStatus.creating,
        errorCode: '',
        errorMessage: '',
      });

      // 两个独立 service 实例模拟两个后台进程（各自有独立的进程内 statusLocks）。
      const processA = buildService(redis, db);
      const processB = buildService(redis, db);

      // 让 processB 的 describeVrsTaskStatus 在第一次被调用时稍慢一点，
      // 确保 processA 先拿到锁并完成试听合成；processB 等待锁后进入临界区应读到 active。
      const originalDescribe =
        processB.tencentVrsVoiceService.describeVrsTaskStatus;
      processB.tencentVrsVoiceService.describeVrsTaskStatus = jest.fn(
        async (taskId: string) => {
          // 故意延迟，让 A 先完成
          await new Promise(r => setTimeout(r, 50));
          return originalDescribe(taskId);
        }
      );

      // 并发触发两个进程的状态查询。
      const [resA, resB] = (await Promise.all([
        processA.getTrainStatus(timbreId),
        processB.getTrainStatus(timbreId),
      ])) as any[];

      // 两个调用都应返回成功。
      expect(resA.phase).toBe('success');
      expect(resB.phase).toBe('success');

      // 关键断言：付费试听合成只发生一次。
      expect(processA.tencentVrsVoiceService.synthesize).toHaveBeenCalledTimes(1);
      expect(processB.tencentVrsVoiceService.synthesize).toHaveBeenCalledTimes(0);

      // 最终 DB 记录是 active 且 previewAudioUrl 已写入。
      const final = db.get(timbreId);
      expect(final.status).toBe(VoiceTimbreStatus.active);
      expect(final.previewAudioUrl).toBeTruthy();
      expect(final.providerVoiceId).toBe('fast-voice-123');
    });
  });
});
