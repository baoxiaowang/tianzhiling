import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { AppError } from '@tzl/shared';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import * as bullmq from '@midwayjs/bullmq';
import { randomUUID } from 'crypto';
import { TencentVrsVoiceService } from './tencent-vrs-voice.service';
import { AdminStorageFileService } from './admin-storage-file.service';
import { AdminStorageService } from './admin-storage.service';
import { AdminFfmpegService } from './admin-ffmpeg.service';

/**
 * 录音要求（与前端展示一致）：5~15 秒、单声道、wav/mp3/aac/m4a、<=2MB。
 */
const RECORDING_REQUIREMENTS = [
  '必须朗读接口返回的指定文案（不能上传历史录音合并冒充）',
  '时长 5~15 秒',
  '单声道、清晰无噪音',
  '格式支持 wav / mp3 / aac / m4a',
  '文件大小不超过 2MB',
];

/** 试听合成默认文本。 */
const DEFAULT_AUDITION_TEXT = '我好想你，最近过得好吗，有没有好好吃饭';

@Provide()
export class AdminTencentVrsService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @Inject()
  tencentVrsVoiceService: TencentVrsVoiceService;

  @Inject()
  storageFileService: AdminStorageFileService;

  @Inject()
  storageService: AdminStorageService;

  @Inject()
  ffmpegService: AdminFfmpegService;

  @Inject()
  bullmqFramework: bullmq.Framework;

  /**
   * 状态查询并发锁：避免多个管理员/多个前端标签页同时轮询同一个 timbre，
   * 在训练刚成功时重复触发付费试听合成。
   * key = timbreId，value = 正在进行的刷新 Promise。
   */
  private statusLocks = new Map<string, Promise<unknown>>();

  /** 获取指定训练文案 + 性别提示 + 录音要求。 */
  async getTrainingText() {
    const result = await this.tencentVrsVoiceService.getTrainingText({
      textLanguage: 1,
    });
    return {
      textId: result.textId,
      text: result.text,
      genderOptions: [
        { value: 1, label: '男（VoiceGender=1）' },
        { value: 2, label: '女（VoiceGender=2）' },
      ],
      requirements: RECORDING_REQUIREMENTS,
    };
  }

  /**
   * 音质检测：服务端按 audioKey 从 COS 拉取训练音频 → ffmpeg 归一化为
   * wav/单声道/16k → 调用腾讯云 detectEnvAndSoundQuality。
   * 前端绝不接触 SecretId/SecretKey。
   */
  async detectQuality(input: { audioKey: string; textId: string }) {
    this.tencentVrsVoiceService.ensureConfigured();
    const audioKey = this.normalizeCosObjectKey(input.audioKey);
    const textId = input.textId?.trim();
    if (!textId) {
      throw new AppError('TENCENT_VRS_MISSING_TEXT_ID', '缺少 TextId', 400);
    }

    // 下载 COS 音频（会校验是否为本服务 COS 桶下的对象）。
    const downloaded = await this.storageFileService.download(audioKey);
    if (!downloaded.buffer || !downloaded.buffer.length) {
      throw new AppError(
        'TENCENT_VRS_AUDIO_EMPTY',
        '训练音频为空，请重新上传',
        400
      );
    }

    // 归一化为腾讯云要求的 wav/单声道/16k（与训练 SampleRate:16000 一致）。
    const normalized = await this.ffmpegService.extractAudioToWav({
      buffer: downloaded.buffer,
      fileName: downloaded.fileName || 'vrs-input.wav',
      sampleRate: 16000,
    });

    // 音频实际已被 ffmpeg 重采样到 16k，声明的 sampleRate 与真实采样率一致。
    const result = await this.tencentVrsVoiceService.detectSoundQuality({
      textId,
      audioBuffer: normalized.buffer,
      codec: 'wav',
      sampleRate: 16000,
    });

    return {
      audioId: result.audioId,
      detectionCode: result.detectionCode,
      detectionMsg: result.detectionMsg,
      detectionTip: result.detectionTip,
    };
  }

  /**
   * 创建训练任务：调用腾讯云 CreateVRSTask，并在本地创建 VoiceTimbreEntity
   * 记录（provider=tencent_vrs, status=creating, providerTaskId）。
   */
  async train(input: {
    audioId: string;
    voiceName: string;
    voiceGender: number;
    textId: string;
    userId: string;
    audioKey: string;
    voiceDescription?: string;
    remark?: string;
  }) {
    this.tencentVrsVoiceService.ensureConfigured();

    const userId = this.parseRequiredUserObjectId(input.userId);
    const audioKey = this.normalizeCosObjectKey(input.audioKey);
    const voiceGender = this.tencentVrsVoiceService.normalizeVoiceGender(
      input.voiceGender
    );

    const created = await this.tencentVrsVoiceService.createVrsTask({
      audioId: input.audioId,
      voiceName: input.voiceName,
      voiceGender,
    });

    const now = new Date();
    const timbre = new VoiceTimbreEntity();
    timbre.userId = userId;
    timbre.name = input.voiceName.trim();
    timbre.provider = VoiceTimbreProvider.tencent_vrs;
    // 训练未完成前用 taskId 占位作为 providerVoiceId（唯一索引要求非空）。
    timbre.providerVoiceId = `pending_${created.taskId}`;
    timbre.providerTaskId = created.taskId;
    timbre.providerVoiceType = this.tencentVrsVoiceService.getSingleSentenceVoiceType();
    timbre.audioObjectKey = audioKey;
    timbre.cloneLanguage = 'zh';
    timbre.voiceDescription = input.voiceDescription?.trim() || undefined;
    timbre.previewText = DEFAULT_AUDITION_TEXT;
    timbre.previewModel = 'tencent-vrs-single-sentence';
    timbre.previewAudioUrl = '';
    timbre.status = VoiceTimbreStatus.creating;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.remark = input.remark?.trim() || undefined;
    timbre.createdAt = now;
    timbre.updatedAt = now;

    const saved = await this.voiceTimbreModel.save(timbre);

    return {
      timbreId: this.stringifyObjectId(saved.id),
      providerTaskId: created.taskId,
      voiceGender,
      status: saved.status,
    };
  }

  /**
   * 查询训练状态。必须加锁防止并发轮询重复产生付费试听：
   * - 若本地已是 active/failed，直接返回，不再调用腾讯云试听合成。
   * - 若腾讯云返回成功，在锁内再次确认本地尚未写过 providerVoiceType/试听，
   *   才合成试听并落 COS。
   */
  async getTrainStatus(timbreId: string) {
    const id = this.parseTimbreObjectId(timbreId);
    const cacheKey = this.stringifyObjectId(id);

    // 进程内快速路径：同进程并发轮询复用同一个 in-flight Promise。
    const existing = this.statusLocks.get(cacheKey);
    if (existing) {
      return existing;
    }

    const task = this.refreshWithDistributedLock(id, cacheKey).finally(() => {
      this.statusLocks.delete(cacheKey);
    });
    this.statusLocks.set(cacheKey, task);
    return task;
  }

  /**
   * 跨进程分布式锁（Redis SET NX PX）。进程内 statusLocks 只能合并同进程并发，
   * 多后台进程同时轮询同一 timbre 在训练刚成功时仍可能重复付费试听；这里用
   * Redis 锁串行化跨进程临界区。锁内仍会重新拉取 timbre 并 double-check 是否已
   * active / 已写过 previewAudioUrl，锁竞争失败的进程在等待后进入临界区会直接
   * 读到 active 状态而跳过试听合成。
   */
  private async refreshWithDistributedLock(
    id: MongoObjectId,
    cacheKey: string
  ) {
    const lockKey = `lock:tencent-vrs:train-status:${cacheKey}`;
    const ttlMs = 10000;
    // 锁被占用时最多等待 5s，让持锁进程完成试听合成后再进入临界区重查。
    const maxWaitMs = 5000;
    const retryDelayMs = 200;

    const token = await this.acquireLockWithRetry(lockKey, ttlMs, maxWaitMs, retryDelayMs);
    try {
      return await this.refreshTrainStatusUnderLock(id, cacheKey);
    } finally {
      if (token) {
        await this.releaseLock(lockKey, token);
      }
    }
  }

  private async acquireLockWithRetry(
    key: string,
    ttlMs: number,
    maxWaitMs: number,
    retryDelayMs: number
  ): Promise<string | null> {
    const start = Date.now();
    let token = await this.tryAcquireLock(key, ttlMs);
    while (!token && Date.now() - start < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      token = await this.tryAcquireLock(key, ttlMs);
    }
    return token;
  }

  private async tryAcquireLock(key: string, ttlMs: number): Promise<string | null> {
    try {
      const client = await this.getRedisClient();
      const token = randomUUID();
      // SET key token NX PX ttl：仅当 key 不存在时设置成功。
      const result = await client.set(key, token, 'PX', ttlMs, 'NX');
      return result === 'OK' ? token : null;
    } catch (error) {
      // Redis 不可用时降级：不阻塞主流程，依赖锁内 DB double-check 兜底。
      this.logger?.warn?.(
        '[tencent-vrs] distributed lock acquire failed, falling back to db double-check: %s',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    try {
      const client = await this.getRedisClient();
      // 仅当 value 仍是自己持有的 token 时才 DEL，避免误删他人锁。
      await client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token
      );
    } catch (error) {
      this.logger?.warn?.(
        '[tencent-vrs] distributed lock release failed: %s',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * 复用 BullMQ 框架的 Redis 连接获取底层 Redis 客户端（ioredis）。
   * BullMQ 已在 defaultConnection 配置好 host/port/password/db。
   */
  private async getRedisClient(): Promise<{
    set: (...args: unknown[]) => Promise<unknown>;
    eval: (...args: unknown[]) => Promise<unknown>;
  }> {
    const queue = this.bullmqFramework?.getQueue('tencent-vrs-lock')
      ?? this.bullmqFramework?.createQueue('tencent-vrs-lock');
    const client = await (queue as { client: Promise<{
      set: (...args: unknown[]) => Promise<unknown>;
      eval: (...args: unknown[]) => Promise<unknown>;
    }> }).client;
    return client;
  }

  private async refreshTrainStatusUnderLock(
    id: MongoObjectId,
    cacheKey: string
  ) {
    const timbre = await this.voiceTimbreModel.findOne({ where: { _id: id } as never });
    if (!timbre) {
      throw new AppError('TENCENT_VRS_TIMBRE_NOT_FOUND', '音色记录不存在', 404);
    }
    if (timbre.provider !== VoiceTimbreProvider.tencent_vrs) {
      throw new AppError(
        'TENCENT_VRS_NOT_TENCENT_TIMBRE',
        '该音色不是腾讯云声音复刻音色',
        400
      );
    }

    // 已终态：直接返回，避免重复付费试听。
    if (timbre.status === VoiceTimbreStatus.active) {
      return this.buildStatusView(timbre, 'success');
    }
    if (timbre.status === VoiceTimbreStatus.failed) {
      return this.buildStatusView(timbre, 'failed');
    }

    const taskId = timbre.providerTaskId?.trim();
    if (!taskId) {
      throw new AppError(
        'TENCENT_VRS_MISSING_TASK_ID',
        '该音色缺少复刻任务 TaskId',
        400
      );
    }

    const remote = await this.tencentVrsVoiceService.describeVrsTaskStatus(taskId);
    const now = new Date();

    if (remote.status === 2) {
      // 训练成功。在锁内 double-check，避免重复合成试听。
      const fresh = await this.voiceTimbreModel.findOne({ where: { _id: id } as never });
      if (!fresh) {
        throw new AppError('TENCENT_VRS_TIMBRE_NOT_FOUND', '音色记录不存在', 404);
      }
      if (fresh.status !== VoiceTimbreStatus.active) {
        const fastVoiceType = remote.fastVoiceType?.trim();
        if (!fastVoiceType) {
          fresh.status = VoiceTimbreStatus.failed;
          fresh.errorCode = 'TENCENT_VRS_SUCCESS_NO_FAST_VOICE_TYPE';
          fresh.errorMessage = '腾讯云训练成功但未返回 FastVoiceType';
          fresh.updatedAt = now;
          await this.voiceTimbreModel.save(fresh);
          return this.buildStatusView(fresh, 'failed');
        }

        // 合成试听并落 COS（仅在首次成功时执行一次）。
        let previewAudioUrl = fresh.previewAudioUrl || '';
        if (!previewAudioUrl) {
          previewAudioUrl = await this.synthesizePreviewToCos(
            fresh,
            fastVoiceType,
            fresh.previewText || DEFAULT_AUDITION_TEXT
          );
        }

        fresh.providerVoiceId = fastVoiceType;
        fresh.providerVoiceType =
          this.tencentVrsVoiceService.getSingleSentenceVoiceType();
        fresh.previewAudioUrl = previewAudioUrl;
        fresh.status = VoiceTimbreStatus.active;
        fresh.errorCode = '';
        fresh.errorMessage = '';
        fresh.providerCreatedAt = now;
        fresh.updatedAt = now;
        await this.voiceTimbreModel.save(fresh);
      }

      const finalTimbre = await this.voiceTimbreModel.findOne({ where: { _id: id } as never });
      return this.buildStatusView(finalTimbre ?? timbre, 'success');
    }

    if (remote.status === 3) {
      timbre.status = VoiceTimbreStatus.failed;
      timbre.errorCode = 'TENCENT_VRS_TRAIN_FAILED';
      timbre.errorMessage =
        remote.errorMsg || remote.statusStr || '腾讯云复刻训练失败';
      timbre.updatedAt = now;
      await this.voiceTimbreModel.save(timbre);
      return this.buildStatusView(timbre, 'failed');
    }

    // 0 等待 / 1 执行中
    timbre.status = VoiceTimbreStatus.creating;
    timbre.updatedAt = now;
    await this.voiceTimbreModel.save(timbre);
    return this.buildStatusView(
      timbre,
      remote.status === 0 ? 'waiting' : 'running',
      remote.statusStr
    );
  }

  /** 列出色音（GetVRSVoiceTypes，腾讯云限频 1 次/秒）。 */
  async listVoices() {
    this.tencentVrsVoiceService.ensureConfigured();
    const voices = await this.tencentVrsVoiceService.listVoices();
    return { items: voices };
  }

  /** 试听合成：调用腾讯云 TextToVoice，落 COS 后返回公开 URL。 */
  async audition(input: { timbreId: string; text: string }) {
    this.tencentVrsVoiceService.ensureConfigured();
    const id = this.parseTimbreObjectId(input.timbreId);
    const timbre = await this.voiceTimbreModel.findOne({ where: { _id: id } as never });
    if (!timbre) {
      throw new AppError('TENCENT_VRS_TIMBRE_NOT_FOUND', '音色记录不存在', 404);
    }
    if (timbre.provider !== VoiceTimbreProvider.tencent_vrs) {
      throw new AppError(
        'TENCENT_VRS_NOT_TENCENT_TIMBRE',
        '该音色不是腾讯云声音复刻音色',
        400
      );
    }
    if (timbre.status !== VoiceTimbreStatus.active) {
      throw new AppError(
        'TENCENT_VRS_NOT_ACTIVE',
        '音色尚未训练成功，无法试听',
        400
      );
    }
    const fastVoiceType = timbre.providerVoiceId?.trim();
    if (!fastVoiceType || fastVoiceType.startsWith('pending_')) {
      throw new AppError(
        'TENCENT_VRS_MISSING_FAST_VOICE_TYPE',
        '音色尚未生成 FastVoiceType，无法试听',
        400
      );
    }

    const audioUrl = await this.synthesizePreviewToCos(
      timbre,
      fastVoiceType,
      input.text,
      'voice-timbre-audition'
    );
    return { audioUrl };
  }

  /** 用腾讯云合成音频并上传到 COS，返回公开 URL。 */
  private async synthesizePreviewToCos(
    timbre: VoiceTimbreEntity,
    fastVoiceType: string,
    text: string,
    folder = 'voice-timbre-previews'
  ): Promise<string> {
    const synthesized = await this.tencentVrsVoiceService.synthesize({
      text: text || DEFAULT_AUDITION_TEXT,
      fastVoiceType,
      codec: 'mp3',
    });

    const uploaded = await this.storageService.uploadCosBuffer({
      buffer: synthesized.audioBuffer,
      fileName: `vrs-${randomUUID()}.mp3`,
      contentType: synthesized.mimeType,
      folder,
    });
    return uploaded.publicUrl;
  }

  private buildStatusView(
    timbre: VoiceTimbreEntity,
    phase: 'waiting' | 'running' | 'success' | 'failed',
    statusStr?: string
  ) {
    return {
      timbreId: this.stringifyObjectId(timbre.id as MongoObjectId),
      providerTaskId: timbre.providerTaskId || '',
      providerVoiceId: timbre.providerVoiceId || '',
      providerVoiceType: timbre.providerVoiceType || '',
      status: timbre.status,
      phase,
      statusStr: statusStr || '',
      errorCode: timbre.errorCode || '',
      errorMessage: timbre.errorMessage || '',
      previewAudioUrl: timbre.previewAudioUrl || '',
    };
  }

  private normalizeCosObjectKey(value: string): string {
    const normalized = this.storageFileService.normalizeForStorage(value);
    if (!normalized) {
      throw new AppError('TENCENT_VRS_INVALID_AUDIO_KEY', 'audioKey 不能为空', 400);
    }
    return normalized;
  }

  private parseRequiredUserObjectId(value: string): MongoObjectId {
    const trimmed = value?.trim();
    if (!trimmed || !MongoObjectId.isValid(trimmed)) {
      throw new AppError('TENCENT_VRS_INVALID_USER_ID', 'userId 不合法', 400);
    }
    return new MongoObjectId(trimmed);
  }

  private parseTimbreObjectId(value: string): MongoObjectId {
    const trimmed = value?.trim();
    if (!trimmed || !MongoObjectId.isValid(trimmed)) {
      throw new AppError('TENCENT_VRS_INVALID_TIMBRE_ID', 'timbreId 不合法', 400);
    }
    return new MongoObjectId(trimmed);
  }

  private stringifyObjectId(value: MongoObjectId | undefined): string {
    if (!value) return '';
    return String(value);
  }
}
