import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  VoiceServiceClipReviewStatus,
  VoiceServiceSessionEntity,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { VOICE_SERVICE_MAX_TRAINING_SECONDS } from '@tzl/shared';
import { randomBytes } from 'crypto';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { QwenVoiceEnrollmentService } from './qwen-voice-enrollment.service';
import { QwenVoiceSpeechService } from './qwen-voice-speech.service';
import { TencentCosService } from './tencent-cos.service';
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
