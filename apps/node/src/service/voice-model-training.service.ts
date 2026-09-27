import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { RedisService } from '@midwayjs/redis';
import {
  MongoObjectId,
  VoiceServiceClipReviewStatus,
  VoiceServiceSessionEntity,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { VOICE_SERVICE_MAX_TRAINING_SECONDS } from '@tzl/shared';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { QwenVoiceEnrollmentService } from './qwen-voice-enrollment.service';
import { QwenVoiceSpeechService } from './qwen-voice-speech.service';
import { TencentCosService } from './tencent-cos.service';
import { TencentVrsVoiceService } from './tencent-vrs-voice.service';
import { VoiceFfmpegService } from './voice-ffmpeg.service';

export const DEFAULT_VOICE_PREVIEW_TEXT =
  '最近过得好吗？有没有好好吃饭，好好睡觉？';

export function buildVoicePreviewText(salutation?: string): string {
  const normalized = String(salutation ?? '')
    .trim()
    .replace(/[，,。！？!?；;：:\s]+$/g, '')
    .slice(0, 24);

  return normalized
    ? `${normalized}，${DEFAULT_VOICE_PREVIEW_TEXT}`
    : DEFAULT_VOICE_PREVIEW_TEXT;
}

export interface VoiceModelTrainingResult {
  voiceTimbreId: string;
  previewAudioUrl: string;
  previewAudioObjectKey: string;
  trainingAudioObjectKey: string;
}

@Provide()
export class VoiceModelTrainingService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  voiceFfmpegService: VoiceFfmpegService;

  @Inject()
  qwenVoiceEnrollmentService: QwenVoiceEnrollmentService;

  @Inject()
  qwenVoiceSpeechService: QwenVoiceSpeechService;

  @Inject()
  tencentVrsVoiceService: TencentVrsVoiceService;

  @Inject()
  redisService: RedisService;

  async train(
    session: VoiceServiceSessionEntity
  ): Promise<VoiceModelTrainingResult> {
    const previewText =
      session.previewText?.trim() || DEFAULT_VOICE_PREVIEW_TEXT;
    const acceptedClips = this.selectTrainingClips(session);
    const downloaded = await Promise.all(
      acceptedClips.map(async clip => ({
        ...(await this.tencentCosService.getBuffer(clip.objectKey)),
        durationSeconds: clip.durationSeconds,
      }))
    );
    const combined = await this.voiceFfmpegService.combineTrainingClips(
      downloaded
    );
    const trainingAudio = await this.tencentCosService.putBuffer(
      combined.buffer,
      {
        folder: 'voice-training-ready',
        fileName: combined.fileName,
        contentType: combined.contentType,
      }
    );
    const now = new Date();
    const timbre = this.voiceTimbreModel.create({
      userId: session.userId,
      name: this.buildTimbreName(now),
      provider: VoiceTimbreProvider.qwen,
      providerVoiceId: `pending_${randomBytes(8).toString('hex')}`,
      voiceServiceSessionId: session.id,
      trainingClipIds: acceptedClips.map(clip => clip.id),
      audioObjectKey: trainingAudio.objectKey,
      audioUrl: trainingAudio.url,
      cloneLanguage: 'zh',
      speechDialect: 'auto',
      previewText,
      previewModel: this.qwenVoiceEnrollmentService.getDefaultModel(),
      speechSpeed: 1,
      speechVolume: 1,
      status: VoiceTimbreStatus.creating,
      providerCreatedAt: now,
      remark: `声音服务会话 ${this.sessionId(session)}，由用户审核通过的 ${
        acceptedClips.length
      } 段声音合成`,
      createdAt: now,
      updatedAt: now,
    });
    await this.voiceTimbreModel.save(timbre);
    let provider = 'qwen';
    let providerOperation = 'voice_enrollment';

    try {
      const enrollment = await this.qwenVoiceEnrollmentService.createVoice({
        audioUrl: trainingAudio.url,
        preferredName: this.buildPreferredName(),
        language: 'zh',
      });
      timbre.providerVoiceId = enrollment.providerVoiceId;
      timbre.previewModel = enrollment.targetModel;
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);
      providerOperation = 'preview_synthesis';
      const preview = await this.qwenVoiceSpeechService.synthesize({
        text: previewText,
        voiceId: enrollment.providerVoiceId,
        model: enrollment.targetModel,
        language: 'Chinese',
        ...(timbre.speechInstruction?.trim()
          ? { instruction: timbre.speechInstruction.trim() }
          : {}),
        ...(timbre.speechDialect && timbre.speechDialect !== 'auto'
          ? { dialect: timbre.speechDialect }
          : {}),
      });
      provider = 'tencent_cos';
      providerOperation = 'preview_upload';
      const previewAudio = await this.tencentCosService.putBuffer(
        preview.audioBuffer,
        {
          folder: 'voice-timbre-previews',
          fileName: `preview.${this.extensionForMimeType(preview.mimeType)}`,
          contentType: preview.mimeType,
        }
      );

      timbre.previewAudioUrl = previewAudio.url;
      timbre.previewAudioObjectKey = previewAudio.objectKey;
      timbre.status = VoiceTimbreStatus.active;
      timbre.providerLastUsedAt = new Date();
      timbre.providerEstimatedCleanupAt = this.addOneYear(
        timbre.providerLastUsedAt
      );
      timbre.retentionStatus = 'protected';
      timbre.retentionLastSucceededAt = timbre.providerLastUsedAt;
      timbre.retentionFailureCode = '';
      timbre.retentionFailureReason = '';
      timbre.errorCode = '';
      timbre.errorMessage = '';
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);

      return {
        voiceTimbreId: this.sessionId(timbre),
        previewAudioUrl: previewAudio.url,
        previewAudioObjectKey: previewAudio.objectKey,
        trainingAudioObjectKey: trainingAudio.objectKey,
      };
    } catch (error) {
      timbre.status = VoiceTimbreStatus.failed;
      timbre.errorCode =
        error instanceof AppError ? error.code : 'VOICE_MODEL_TRAINING_FAILED';
      timbre.errorMessage =
        error instanceof Error ? error.message.slice(0, 1000) : String(error);
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);
      throw this.withProviderContext(error, provider, providerOperation);
    }
  }

  /**
   * 腾讯云声音复刻（一句话版）——按稿录制训练流程。
   * 一句话版必须按腾讯云返回的指定文本录音，并通过音质检测
   * （TextId 与录音绑定，ASR 比对文本一致性），因此这里拒绝把
   * 历史录音直接提交给指定文本接口。
   *
   * 流程：录音（随已鉴权请求上传，避免越权提交他人音频）→ 归一化为
   * wav/16k/单声道/16bit → 音质检测（失败不落库）→ 创建复刻任务 →
   * 记录音色（creating）→ 返回 { timbreId, taskId }。
   * 任务完成后由 pollTencentVrsTraining 轮询并最终化。
   */
  async startTencentVrsTraining(input: {
    userId: unknown;
    audioBuffer: Buffer;
    textId: string;
    voiceGender?: number;
  }): Promise<{ timbreId: string; taskId: string }> {
    const {
      userId,
      audioBuffer,
      textId,
      voiceGender,
    } = input;

    if (!/^[a-f\d]{24}$/i.test(String(userId || '').trim())) {
      throw new AppError('INVALID_TOKEN', 'invalid user id', 401);
    }
    const ownerId = new MongoObjectId(String(userId).trim());

    if (!audioBuffer?.length) {
      throw new AppError(
        'TENCENT_VRS_MISSING_AUDIO_OBJECT_KEY',
        '缺少按稿录制的音频文件',
        400
      );
    }
    if (!textId) {
      throw new AppError(
        'TENCENT_VRS_MISSING_TEXT_ID',
        '缺少复刻训练文本 TextId',
        400
      );
    }

    if (audioBuffer.length > 4 * 1024 * 1024) {
      throw new AppError('TENCENT_VRS_AUDIO_TOO_LARGE', '录音文件过大，请重新录制', 400);
    }
    // 录音直接随已鉴权请求上传，避免客户端提交其他用户的 COS objectKey。
    const normalized = await this.normalizeTencentVrsWav(audioBuffer);

    // 2. 音质检测。失败会抛出带检测原因的 AppError（检测失败 / 文本不一致 / 噪声等）。
    //    检测失败不写入任何音色记录。
    const detection = await this.tencentVrsVoiceService.detectSoundQuality({
      textId,
      audioBuffer: normalized,
      codec: 'wav',
    });

    const trainingAudio = await this.tencentCosService.putBuffer(normalized, {
      folder: 'voice-training-materials',
      fileName: 'tencent-vrs-training.wav',
      contentType: 'audio/wav',
    });

    const now = new Date();
    const timbre = this.voiceTimbreModel.create({
      userId: ownerId,
      name: this.buildTimbreName(now),
      provider: VoiceTimbreProvider.tencent_vrs,
      providerVoiceId: `pending_${randomBytes(8).toString('hex')}`,
      providerVoiceType: this.tencentVrsVoiceService.getSingleSentenceVoiceType(),
      audioObjectKey: trainingAudio.objectKey,
      audioUrl: trainingAudio.url,
      cloneLanguage: 'zh',
      speechDialect: 'auto',
      previewText: DEFAULT_VOICE_PREVIEW_TEXT,
      previewModel: this.tencentVrsVoiceService.getSingleSentenceVoiceType(),
      speechSpeed: 1,
      speechVolume: 1,
      status: VoiceTimbreStatus.creating,
      providerCreatedAt: now,
      remark: `腾讯云声音复刻（一句话版），按指定训练文本录音，音质检测通过后创建`,
      createdAt: now,
      updatedAt: now,
    });
    await this.voiceTimbreModel.save(timbre);

    let providerOperation = 'voice_enrollment';
    try {
      const created = await this.tencentVrsVoiceService.createVrsTask({
        audioId: detection.audioId,
        voiceName: timbre.name,
        voiceGender,
      });
      timbre.providerTaskId = created.taskId;
      timbre.providerFileId = created.taskId;
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);

      return { timbreId: this.sessionId(timbre), taskId: created.taskId };
    } catch (error) {
      timbre.status = VoiceTimbreStatus.failed;
      timbre.errorCode =
        error instanceof AppError ? error.code : 'TENCENT_VRS_CREATE_TASK_FAILED';
      timbre.errorMessage =
        error instanceof Error ? error.message.slice(0, 1000) : String(error);
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);
      throw this.withProviderContext(error, 'tencent_vrs', providerOperation);
    }
  }

  /**
   * 轮询腾讯云复刻任务状态并在成功/失败时最终化音色。
   * 成功：写入 FastVoiceType，合成试听音频并上传 COS，置为 active。
   * 失败：置为 failed 并记录原因。任务仍在执行中时返回 creating。
   * 通过 Redis 锁避免并发轮询重复产生付费试听合成。
   */
  async pollTencentVrsTraining(
    timbreId: string,
    userId: string
  ): Promise<VoiceTimbreEntity | null> {
    const timbre = await this.findTimbreById(timbreId);
    if (!timbre ||
        timbre.provider !== VoiceTimbreProvider.tencent_vrs ||
        String(timbre.userId) !== userId) {
      return null;
    }
    if (timbre.status !== VoiceTimbreStatus.creating || !timbre.providerTaskId) {
      return timbre;
    }

    const status = await this.tencentVrsVoiceService.describeVrsTaskStatus(
      timbre.providerTaskId
    );

    if (status.status === 2 && status.fastVoiceType) {
      if (!this.redisService) {
        throw new AppError('TENCENT_VRS_FINALIZE_UNAVAILABLE', '试听生成暂时繁忙，请稍后重试', 503);
      }
      const lockKey = `voice:timbre:tencent-vrs:finalize:${timbreId}`;
      const lockToken = randomBytes(16).toString('hex');
      const acquired = await this.redisService.set(lockKey, lockToken, 'PX', 240000, 'NX');
      if (acquired !== 'OK') return timbre;
      try {
        const current = await this.findTimbreById(timbreId);
        if (current?.status === VoiceTimbreStatus.creating) {
          await this.finalizeTencentVrsTimbre(current, status.fastVoiceType);
        }
        return current;
      } finally {
        // 只释放自己持有的锁；过期后不删除另一请求的新锁。
        const releaseScript =
          'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
        try {
          await this.redisService.eval(releaseScript, 1, lockKey, lockToken);
        } catch (error) {
          this.logger.warn(
            '[tencent-vrs] finalization lock release failed, timbreId=%s, reason=%s',
            timbreId,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    }

    if (status.status === 3) {
      timbre.status = VoiceTimbreStatus.failed;
      timbre.errorCode = 'TENCENT_VRS_TRAINING_FAILED';
      timbre.errorMessage = (status.errorMsg || '复刻任务失败').slice(0, 1000);
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);
      return timbre;
    }

    return timbre;
  }

  private async finalizeTencentVrsTimbre(
    timbre: VoiceTimbreEntity,
    fastVoiceType: string
  ): Promise<void> {
    const previewText = timbre.previewText?.trim() || DEFAULT_VOICE_PREVIEW_TEXT;

    const preview = await this.tencentVrsVoiceService.synthesize({
      text: previewText,
      fastVoiceType,
      speed: 0,
      volume: 0,
    });
    const previewMimeType = preview.mimeType || 'audio/wav';
    const previewAudio = await this.tencentCosService.putBuffer(
      preview.audioBuffer,
      {
        folder: 'voice-timbre-previews',
        fileName: `preview.${this.extensionForMimeType(previewMimeType)}`,
        contentType: previewMimeType,
      }
    );

    timbre.providerVoiceId = fastVoiceType;
    timbre.providerVoiceType = this.tencentVrsVoiceService.getSingleSentenceVoiceType();
    timbre.previewAudioUrl = previewAudio.url;
    timbre.previewAudioObjectKey = previewAudio.objectKey;
    timbre.status = VoiceTimbreStatus.active;
    timbre.providerLastUsedAt = new Date();
    timbre.retentionStatus = 'protected';
    timbre.retentionLastSucceededAt = timbre.providerLastUsedAt;
    timbre.retentionFailureCode = '';
    timbre.retentionFailureReason = '';
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.updatedAt = new Date();
    await this.voiceTimbreModel.save(timbre);
  }

  /** 把原始录音归一化为腾讯云音质检测要求的 wav/16k/单声道/16bit。 */
  private async normalizeTencentVrsWav(buffer: Buffer): Promise<Buffer> {
    const inputPath = join(
      tmpdir(),
      `tzl-vrs-in-${randomBytes(6).toString('hex')}.bin`
    );
    const outputPath = join(
      tmpdir(),
      `tzl-vrs-out-${randomBytes(6).toString('hex')}.wav`
    );

    await fs.writeFile(inputPath, buffer);
    try {
      await this.tencentVrsVoiceService.normalizeTrainingAudioToWav({
        inputPath,
        outputPath,
      });
      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => undefined);
      await fs.unlink(outputPath).catch(() => undefined);
    }
  }

  private async findTimbreById(
    timbreId: string
  ): Promise<VoiceTimbreEntity | null> {
    let id: MongoObjectId;
    try {
      id = new MongoObjectId(timbreId);
    } catch {
      return null;
    }
    return (
      (await this.voiceTimbreModel.findOne({ where: { id } })) ??
      (await this.voiceTimbreModel.findOne({ where: { _id: id } as never }))
    );
  }

  private selectTrainingClips(session: VoiceServiceSessionEntity) {
    const accepted = (session.reviewClips ?? [])
      .map((clip, index) => ({ clip, index }))
      .filter(
        item => item.clip.reviewStatus === VoiceServiceClipReviewStatus.accepted
      )
      .sort((left, right) => {
        const scoreDifference =
          (Number(right.clip.qualityScore) || 0) -
          (Number(left.clip.qualityScore) || 0);
        return scoreDifference || left.index - right.index;
      });
    const selected = [] as typeof accepted;
    let durationSeconds = 0;

    for (const item of accepted) {
      const clip = item.clip;
      const clipDuration = Math.max(1, clip.durationSeconds || 12);
      const separatorSeconds = selected.length > 0 ? 0.2 : 0;
      if (
        selected.length > 0 &&
        durationSeconds + separatorSeconds + clipDuration >
          VOICE_SERVICE_MAX_TRAINING_SECONDS
      ) {
        continue;
      }
      selected.push(item);
      durationSeconds += separatorSeconds + clipDuration;
      if (durationSeconds >= VOICE_SERVICE_MAX_TRAINING_SECONDS) {
        break;
      }
    }

    if (selected.length === 0) {
      throw new AppError(
        'VOICE_SERVICE_ACCEPTED_CLIP_REQUIRED',
        'at least one accepted voice clip is required',
        400
      );
    }

    return selected
      .sort((left, right) => left.index - right.index)
      .map(item => item.clip);
  }

  private buildPreferredName(): string {
    return `tzl${Date.now().toString(36).slice(-8)}${randomBytes(2).toString(
      'hex'
    )}`.slice(0, 16);
  }

  private buildTimbreName(createdAt: Date): string {
    const month = String(createdAt.getMonth() + 1).padStart(2, '0');
    const day = String(createdAt.getDate()).padStart(2, '0');
    return `我的音色 ${month}月${day}日`;
  }

  private addOneYear(value: Date): Date {
    const result = new Date(value);
    result.setFullYear(result.getFullYear() + 1);
    return result;
  }

  private extensionForMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('mpeg') || normalized.includes('mp3')) {
      return 'mp3';
    }
    if (normalized.includes('ogg')) {
      return 'ogg';
    }

    return 'wav';
  }

  private sessionId(entity: { id?: unknown }): string {
    const id = entity.id as
      | { toHexString?: () => string; toString?: () => string }
      | undefined;

    return id?.toHexString?.() || id?.toString?.() || '';
  }

  private withProviderContext(
    error: unknown,
    provider: string,
    operation: string
  ): AppError {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(
            'VOICE_MODEL_TRAINING_FAILED',
            error instanceof Error ? error.message : String(error),
            500
          );
    const sourceData = this.readRecord(appError.data);
    const requestId = this.readText(
      sourceData?.requestId ?? sourceData?.request_id
    );

    return new AppError(appError.code, appError.message, appError.status, {
      sourceData: appError.data,
      providerError: {
        provider,
        operation,
        code: appError.code,
        message: appError.message,
        ...(requestId ? { requestId } : {}),
        httpStatus: this.readNumber(sourceData?.httpStatus) || appError.status,
      },
    });
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 200) : '';
  }

  private readNumber(value: unknown): number | undefined {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
}
