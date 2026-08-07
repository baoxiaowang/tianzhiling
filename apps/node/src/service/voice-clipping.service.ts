import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import {
  VoiceServiceProcessingMode,
  type VoiceServiceClipQualityIssue,
  type VoiceServiceClipQualityMetrics,
  type VoiceServiceMaterialItem,
} from '@tzl/entities';
import { AppError } from '../common/errors';
import {
  DashScopeVoiceAnalysisService,
  type VoiceAnalysisSentence,
} from './dashscope-voice-analysis.service';
import { TencentCosService } from './tencent-cos.service';
import {
  VoiceFfmpegService,
  type VoiceFfmpegFilteredClip,
  type VoiceFfmpegQualityBatch,
  type VoiceFfmpegSegment,
} from './voice-ffmpeg.service';

interface VoiceClippingConfig {
  maxTotalClips?: number;
}

export interface VoiceClippingResult {
  sourceMaterialId: string;
  sourceName: string;
  objectKey: string;
  publicUrl: string;
  durationSeconds: number;
  transcript?: string;
  speakerId?: string;
  qualityScore?: number;
  qualityLabel?: string;
  qualityMetrics?: VoiceServiceClipQualityMetrics;
  qualityIssues?: VoiceServiceClipQualityIssue[];
}

export interface VoiceClippingFilteredResult {
  sourceMaterialId: string;
  sourceName: string;
  durationSeconds?: number;
  transcript?: string;
  speakerId?: string;
  qualityMetrics?: VoiceServiceClipQualityMetrics;
  qualityIssues: VoiceServiceClipQualityIssue[];
}

export interface VoiceClippingPlatformError {
  provider: string;
  operation: string;
  code: string;
  message: string;
  requestId?: string;
  httpStatus?: number;
}

export interface VoiceClippingMetrics {
  recognitionStartedAt?: Date;
  recognitionCompletedAt?: Date;
  recognitionDurationMs: number;
  recognitionMaterialCount: number;
  residualAnalysisObjectKeys?: string[];
  filteredClipCount?: number;
  volumeAdjustedClipCount?: number;
}

export interface VoiceClippingBatchResult {
  clips: VoiceClippingResult[];
  filteredClips: VoiceClippingFilteredResult[];
  metrics: VoiceClippingMetrics;
  platformErrors: VoiceClippingPlatformError[];
}

export interface VoiceClipRecutRange {
  startSeconds: number;
  endSeconds: number;
}

export interface VoiceClipRecutResult extends VoiceClippingResult {
  instruction: string;
  range: VoiceClipRecutRange;
}

const RECUT_TIME_TOKEN = '(?:\\d+:)?\\d+(?:\\.\\d+)?';

export function resolveVoiceClipRecutRange(
  instruction: string,
  durationSeconds: number
): VoiceClipRecutRange {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new AppError(
      'VOICE_SERVICE_RECUT_DURATION_REQUIRED',
      '暂时无法读取这个片段的时长，请重新试听后再试',
      422
    );
  }

  const text = normalizeRecutInstruction(instruction);
  if (!text) {
    throw new AppError(
      'VOICE_SERVICE_RECUT_INSTRUCTION_REQUIRED',
      '请填写要怎么剪',
      400
    );
  }

  const rangePattern = new RegExp(
    `(${RECUT_TIME_TOKEN})(?:秒)?(?:到|至|~|～|-|—|－)(${RECUT_TIME_TOKEN})(?:秒)?`
  );
  const rangeMatch = text.match(rangePattern);
  if (rangeMatch) {
    return validateRecutRange(
      parseRecutTime(rangeMatch[1]),
      parseRecutTime(rangeMatch[2]),
      duration
    );
  }

  const keepFirst = text.match(
    new RegExp(`(?:只保留|只要|保留)(?:开头|前面|前)(${RECUT_TIME_TOKEN})秒`)
  );
  if (keepFirst) {
    return validateRecutRange(0, parseRecutTime(keepFirst[1]), duration);
  }

  const keepLast = text.match(
    new RegExp(`(?:只保留|只要|保留)(?:结尾|末尾|后面|后|最后)(${RECUT_TIME_TOKEN})秒`)
  );
  if (keepLast) {
    const keepSeconds = parseRecutTime(keepLast[1]);
    return validateRecutRange(duration - keepSeconds, duration, duration);
  }

  let startSeconds = 0;
  let endSeconds = duration;
  let matched = false;
  const trimStart = text.match(
    new RegExp(`(?:去掉|剪掉|删除)(?:开头|前面|前)(${RECUT_TIME_TOKEN})秒`)
  );
  if (trimStart) {
    startSeconds = parseRecutTime(trimStart[1]);
    matched = true;
  }
  const trimEnd =
    text.match(
      new RegExp(
        `(?:去掉|剪掉|删除)(?:结尾|末尾|后面|后|最后)(${RECUT_TIME_TOKEN})秒`
      )
    ) ??
    (matched
      ? text.match(
          new RegExp(
            `(?:和|以及)?(?:结尾|末尾|后面|后|最后)(${RECUT_TIME_TOKEN})秒`
          )
        )
      : null);
  if (trimEnd) {
    endSeconds = duration - parseRecutTime(trimEnd[1]);
    matched = true;
  }
  const startAt = text.match(
    new RegExp(`(?:从)?(${RECUT_TIME_TOKEN})秒(?:开始|起)`)
  );
  if (startAt) {
    startSeconds = parseRecutTime(startAt[1]);
    matched = true;
  }
  const endAt = text.match(
    new RegExp(`(?:保留)?到(${RECUT_TIME_TOKEN})秒(?:结束|为止)?`)
  );
  if (endAt) {
    endSeconds = parseRecutTime(endAt[1]);
    matched = true;
  }

  if (!matched) {
    throw new AppError(
      'VOICE_SERVICE_RECUT_INSTRUCTION_UNCLEAR',
      '没有看懂剪法，请写成“去掉开头 2 秒”或“只保留 3 秒到 8 秒”',
      422
    );
  }

  return validateRecutRange(startSeconds, endSeconds, duration);
}

function normalizeRecutInstruction(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/半秒/g, '0.5秒')
    .replace(/[零一二两三四五六七八九十]+/g, item =>
      String(parseChineseNumber(item))
    )
    .replace(/\s+/g, '');
}

function parseChineseNumber(value: string): number {
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (!value.includes('十')) {
    return Number(
      [...value].map(item => String(digits[item] ?? '')).join('') || 0
    );
  }
  const [tensText, onesText] = value.split('十');
  const tens = tensText ? digits[tensText] ?? 0 : 1;
  const ones = onesText ? digits[onesText] ?? 0 : 0;
  return tens * 10 + ones;
}

function parseRecutTime(value: string): number {
  const parts = value.split(':').map(item => Number(item));
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}

function validateRecutRange(
  startSeconds: number,
  endSeconds: number,
  durationSeconds: number
): VoiceClipRecutRange {
  const start = Math.max(0, Math.min(durationSeconds, startSeconds));
  const end = Math.max(0, Math.min(durationSeconds, endSeconds));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start < 2
  ) {
    throw new AppError(
      'VOICE_SERVICE_RECUT_RANGE_INVALID',
      '重新剪辑后至少要保留 2 秒，请调整时间后再试',
      422
    );
  }

  return {
    startSeconds: Math.round(start * 1000) / 1000,
    endSeconds: Math.round(end * 1000) / 1000,
  };
}

@Provide()
export class VoiceClippingService {
  @Logger()
  logger: ILogger;

  @Config('voiceClipping')
  config: VoiceClippingConfig;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  voiceFfmpegService: VoiceFfmpegService;

  @Inject()
  dashScopeVoiceAnalysisService: DashScopeVoiceAnalysisService;

  async createReviewClips(
    materials: VoiceServiceMaterialItem[],
    processingMode: VoiceServiceProcessingMode = VoiceServiceProcessingMode.assisted
  ): Promise<VoiceClippingResult[]> {
    const result = await this.createReviewClipsWithMetrics(
      materials,
      processingMode
    );

    return result.clips;
  }

  async createReviewClipsWithMetrics(
    materials: VoiceServiceMaterialItem[],
    processingMode: VoiceServiceProcessingMode = VoiceServiceProcessingMode.assisted
  ): Promise<VoiceClippingBatchResult> {
    const results: VoiceClippingResult[] = [];
    const filteredResults: VoiceClippingFilteredResult[] = [];
    const errors: unknown[] = [];
    const metrics: VoiceClippingMetrics = {
      recognitionDurationMs: 0,
      recognitionMaterialCount: 0,
    };
    const platformErrors: VoiceClippingPlatformError[] = [];

    for (
      let materialIndex = 0;
      materialIndex < materials.length;
      materialIndex += 1
    ) {
      if (results.length >= this.maxTotalClips) {
        break;
      }

      const material = materials[materialIndex];

      try {
        const source = await this.tencentCosService.getBuffer(
          material.objectKey
        );
        const qualityBatch: VoiceFfmpegQualityBatch =
          processingMode === VoiceServiceProcessingMode.readyToUse
            ? this.voiceFfmpegService.createReadyReviewClipWithQuality
              ? await this.voiceFfmpegService.createReadyReviewClipWithQuality({
                  buffer: source.buffer,
                  fileName: material.name,
                })
              : {
                  clips: [
                    await this.voiceFfmpegService.createReadyReviewClip({
                      buffer: source.buffer,
                      fileName: material.name,
                    }),
                  ],
                  filteredClips: [],
                }
            : await this.createAssistedClips(
                source.buffer,
                material.name,
                metrics
              );

        for (const filtered of qualityBatch.filteredClips) {
          filteredResults.push(
            this.buildFilteredResult(filtered, material, materialIndex)
          );
        }

        for (const clip of qualityBatch.clips) {
          if (results.length >= this.maxTotalClips) {
            break;
          }

          const uploaded = await this.tencentCosService.putBuffer(clip.buffer, {
            folder: 'voice-service-clips',
            fileName: clip.fileName,
            contentType: clip.contentType,
          });
          const score = this.scoreClip(
            clip.durationSeconds,
            clip.transcript,
            clip.qualityMetrics,
            clip.qualityIssues
          );
          results.push({
            sourceMaterialId: material.id,
            sourceName: material.name,
            objectKey: uploaded.objectKey,
            publicUrl: uploaded.url,
            durationSeconds: clip.durationSeconds,
            transcript: clip.transcript,
            speakerId: clip.speakerId
              ? `${materialIndex + 1}-${clip.speakerId}`
              : undefined,
            qualityScore: score,
            qualityLabel: this.qualityLabel(
              score,
              processingMode,
              clip.transcript,
              clip.qualityIssues
            ),
            qualityMetrics: clip.qualityMetrics,
            qualityIssues: clip.qualityIssues,
          });
        }
      } catch (error) {
        errors.push(error);
        platformErrors.push(this.toPlatformError(error));
        this.logger.warn(
          '[voice-clipping] material skipped, materialId=%s, objectKey=%s, reason=%s',
          material.id,
          material.objectKey,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    metrics.filteredClipCount = filteredResults.length;
    metrics.volumeAdjustedClipCount = results.filter(
      item => item.qualityMetrics?.volumeAdjusted
    ).length;

    if (results.length === 0 && filteredResults.length === 0) {
      if (errors.some(error => this.isAnalysisUnavailable(error))) {
        throw new AppError(
          'VOICE_SERVICE_ANALYSIS_UNAVAILABLE',
          '声音识别服务暂时不可用，素材已经保留，请稍后重试',
          503,
          { voiceClippingMetrics: metrics, platformErrors }
        );
      }
      throw new AppError(
        'VOICE_SERVICE_NO_USABLE_AUDIO',
        '没有从素材中找到可用的声音，请检查视频是否包含声音',
        422,
        { voiceClippingMetrics: metrics, platformErrors }
      );
    }

    return {
      clips: results,
      filteredClips: filteredResults,
      metrics,
      platformErrors,
    };
  }

  async recutReviewClip(input: {
    objectKey: string;
    fileName: string;
    durationSeconds: number;
    instruction: string;
    sourceMaterialId?: string;
    sourceName?: string;
    speakerId?: string;
  }): Promise<VoiceClipRecutResult> {
    const instruction = String(input.instruction ?? '').trim();
    const range = resolveVoiceClipRecutRange(
      instruction,
      input.durationSeconds
    );
    const source = await this.tencentCosService.getBuffer(input.objectKey);
    const qualityBatch =
      await this.voiceFfmpegService.createReviewClipsFromSegmentsWithQuality({
        buffer: source.buffer,
        fileName: input.fileName,
        segments: [
          {
            beginMs: Math.round(range.startSeconds * 1000),
            endMs: Math.round(range.endSeconds * 1000),
            speakerId: input.speakerId,
          },
        ],
        edgePadding: false,
      });
    const clip = qualityBatch.clips[0];
    if (!clip) {
      throw new AppError(
        'VOICE_SERVICE_RECUT_UNUSABLE',
        '按这个范围剪完后，有效声音不足或质量不适合训练，请换一个剪法',
        422,
        { filteredClips: qualityBatch.filteredClips }
      );
    }

    const uploaded = await this.tencentCosService.putBuffer(clip.buffer, {
      folder: 'voice-service-clips',
      fileName: clip.fileName,
      contentType: clip.contentType,
    });
    const score = this.scoreClip(
      clip.durationSeconds,
      undefined,
      clip.qualityMetrics,
      clip.qualityIssues
    );

    return {
      sourceMaterialId: input.sourceMaterialId ?? '',
      sourceName: input.sourceName ?? '',
      objectKey: uploaded.objectKey,
      publicUrl: uploaded.url,
      durationSeconds: clip.durationSeconds,
      speakerId: input.speakerId,
      qualityScore: score,
      qualityLabel: '已按要求重新剪辑，请试听确认',
      qualityMetrics: clip.qualityMetrics,
      qualityIssues: clip.qualityIssues,
      instruction,
      range,
    };
  }

  private async createAssistedClips(
    buffer: Buffer,
    fileName: string,
    metrics: VoiceClippingMetrics
  ): Promise<VoiceFfmpegQualityBatch> {
    if (!this.dashScopeVoiceAnalysisService?.isEnabled()) {
      throw this.withProviderContext(
        new AppError(
          'VOICE_SERVICE_ANALYSIS_UNAVAILABLE',
          'voice analysis service is not configured',
          503
        ),
        'dashscope',
        'recognition'
      );
    }

    try {
      const prepared = await this.voiceFfmpegService.prepareAnalysisAudio({
        buffer,
        fileName,
      });
      const uploaded = await this.tencentCosService.putBuffer(prepared.buffer, {
        folder: 'voice-service-analysis',
        fileName: prepared.fileName,
        contentType: prepared.contentType,
      });
      metrics.residualAnalysisObjectKeys = [
        ...(metrics.residualAnalysisObjectKeys ?? []),
        uploaded.objectKey,
      ];
      const recognitionStartedAt = new Date();
      metrics.recognitionStartedAt ??= recognitionStartedAt;
      metrics.recognitionMaterialCount += 1;
      let sentences: VoiceAnalysisSentence[];

      try {
        sentences = await this.dashScopeVoiceAnalysisService.analyze(
          uploaded.url
        );
      } catch (error) {
        throw this.withProviderContext(error, 'dashscope', 'recognition');
      } finally {
        const recognitionCompletedAt = new Date();
        metrics.recognitionCompletedAt = recognitionCompletedAt;
        metrics.recognitionDurationMs += Math.max(
          0,
          recognitionCompletedAt.getTime() - recognitionStartedAt.getTime()
        );
        if (this.tencentCosService.deleteObject) {
          try {
            await this.tencentCosService.deleteObject(uploaded.objectKey);
            metrics.residualAnalysisObjectKeys = (
              metrics.residualAnalysisObjectKeys ?? []
            ).filter(item => item !== uploaded.objectKey);
          } catch (cleanupError) {
            this.logger.warn(
              '[voice-clipping] analysis object cleanup failed, objectKey=%s, reason=%s',
              uploaded.objectKey,
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError)
            );
          }
        }
      }
      const segments = this.buildSentenceSegments(sentences);

      if (this.voiceFfmpegService.createReviewClipsFromSegmentsWithQuality) {
        return this.voiceFfmpegService.createReviewClipsFromSegmentsWithQuality(
          {
            buffer,
            fileName,
            segments,
          }
        );
      }

      return {
        clips: await this.voiceFfmpegService.createReviewClipsFromSegments({
          buffer: prepared.buffer,
          fileName,
          segments,
        }),
        filteredClips: [],
      };
    } catch (error) {
      this.logger.warn(
        '[voice-clipping] AI analysis failed, reject unverified clips, fileName=%s, reason=%s',
        fileName,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  private buildSentenceSegments(
    sentences: VoiceAnalysisSentence[]
  ): VoiceFfmpegSegment[] {
    const candidates: VoiceFfmpegSegment[] = [];
    let current: VoiceFfmpegSegment | undefined;

    const flush = () => {
      if (!current) {
        return;
      }
      const durationMs = current.endMs - current.beginMs;
      if (durationMs >= 1800 && durationMs <= 20000) {
        candidates.push(current);
      }
      current = undefined;
    };

    for (const sentence of sentences) {
      const durationMs = sentence.endMs - sentence.beginMs;
      if (durationMs <= 0 || durationMs > 20000) {
        flush();
        continue;
      }

      if (!current) {
        current = { ...sentence, transcript: sentence.text };
        continue;
      }

      const sameSpeaker = current.speakerId === sentence.speakerId;
      const gapMs = sentence.beginMs - current.endMs;
      const combinedDurationMs = sentence.endMs - current.beginMs;
      if (
        sameSpeaker &&
        gapMs >= 0 &&
        gapMs <= 1200 &&
        combinedDurationMs <= 18000
      ) {
        current.endMs = sentence.endMs;
        current.transcript = [current.transcript, sentence.text]
          .filter(Boolean)
          .join(' ');
        continue;
      }

      flush();
      current = { ...sentence, transcript: sentence.text };
    }
    flush();

    const firstBySpeaker = new Map<string, VoiceFfmpegSegment>();
    candidates.forEach(item => {
      const speakerId = item.speakerId || '0';
      const existing = firstBySpeaker.get(speakerId);
      if (!existing || this.segmentRank(item) > this.segmentRank(existing)) {
        firstBySpeaker.set(speakerId, item);
      }
    });
    const selected = [...firstBySpeaker.values()];
    const selectedKeys = new Set(
      selected.map(
        item => `${item.beginMs}:${item.endMs}:${item.speakerId || ''}`
      )
    );
    const remaining = candidates
      .filter(
        item =>
          !selectedKeys.has(
            `${item.beginMs}:${item.endMs}:${item.speakerId || ''}`
          )
      )
      .sort((a, b) => this.segmentRank(b) - this.segmentRank(a));

    return [...selected, ...remaining]
      .slice(0, this.maxTotalClips)
      .sort((a, b) => a.beginMs - b.beginMs);
  }

  private segmentRank(segment: VoiceFfmpegSegment): number {
    const durationSeconds = (segment.endMs - segment.beginMs) / 1000;
    const durationScore =
      durationSeconds >= 6 && durationSeconds <= 15
        ? 100
        : durationSeconds >= 3
        ? 80
        : 60;
    const textScore = Math.min(30, (segment.transcript?.length || 0) * 2);

    return durationScore + textScore;
  }

  private buildFilteredResult(
    filtered: VoiceFfmpegFilteredClip,
    material: VoiceServiceMaterialItem,
    materialIndex: number
  ): VoiceClippingFilteredResult {
    return {
      sourceMaterialId: material.id,
      sourceName: material.name,
      durationSeconds: filtered.durationSeconds,
      transcript: filtered.transcript,
      speakerId: filtered.speakerId
        ? `${materialIndex + 1}-${filtered.speakerId}`
        : undefined,
      qualityMetrics: filtered.qualityMetrics,
      qualityIssues: filtered.qualityIssues,
    };
  }

  private scoreClip(
    durationSeconds: number,
    transcript?: string,
    metrics?: VoiceServiceClipQualityMetrics,
    issues: VoiceServiceClipQualityIssue[] = []
  ): number {
    const durationScore =
      durationSeconds >= 6 && durationSeconds <= 15
        ? 70
        : durationSeconds >= 3 && durationSeconds <= 20
        ? 58
        : 45;
    const transcriptScore = transcript
      ? Math.min(30, Math.max(12, transcript.length * 2))
      : 15;

    const silencePenalty = Math.round((metrics?.silenceRatio ?? 0) * 24);
    const clippingPenalty = Math.round(
      Math.min(1, (metrics?.clippingRatio ?? 0) / 0.12) * 20
    );
    const noisePenalty = issues.some(
      item => item.code === 'background_noise_high'
    )
      ? 12
      : 0;
    const volumePenalty = metrics?.volumeAdjusted ? 4 : 0;

    return Math.max(
      0,
      Math.min(
        100,
        durationScore +
          transcriptScore -
          silencePenalty -
          clippingPenalty -
          noisePenalty -
          volumePenalty
      )
    );
  }

  private qualityLabel(
    score: number,
    processingMode: VoiceServiceProcessingMode,
    transcript?: string,
    issues: VoiceServiceClipQualityIssue[] = []
  ): string {
    if (issues.some(item => item.code === 'volume_adjusted')) {
      return '音量已自动调高，请试听确认';
    }
    if (issues.some(item => item.code === 'background_noise_high')) {
      return '背景噪声偏多，请重点试听';
    }
    if (issues.some(item => item.code === 'clipping_detected')) {
      return '检测到轻微削波，请重点试听';
    }
    if (issues.some(item => item.code === 'silence_high')) {
      return '静音偏多，请重点试听';
    }
    if (processingMode === VoiceServiceProcessingMode.readyToUse) {
      return '已按原素材整理，请试听确认';
    }
    if (!transcript) {
      return '自动切片，请重点试听完整性';
    }
    if (score >= 90) {
      return '语句完整，时长合适';
    }

    return '语句完整，请试听确认';
  }

  private isAnalysisUnavailable(error: unknown): boolean {
    if (!(error instanceof AppError)) {
      return false;
    }

    return (
      error.code === 'VOICE_SERVICE_ANALYSIS_UNAVAILABLE' ||
      error.code === 'VOICE_ANALYSIS_DISABLED' ||
      error.code === 'VOICE_ANALYSIS_TIMEOUT' ||
      error.code === 'VOICE_ANALYSIS_HTTP_ERROR' ||
      error.code === 'VOICE_ANALYSIS_REQUEST_FAILED' ||
      error.code === 'VOICE_ANALYSIS_TASK_FAILED'
    );
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
            'VOICE_SERVICE_CLIPPING_FAILED',
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

  private toPlatformError(error: unknown): VoiceClippingPlatformError {
    const appError = error instanceof AppError ? error : undefined;
    const data = this.readRecord(appError?.data);
    const providerError = this.readRecord(data?.providerError);

    return {
      provider: this.readText(providerError?.provider) || 'internal',
      operation: this.readText(providerError?.operation) || 'clipping',
      code:
        this.readText(providerError?.code) ||
        appError?.code ||
        'VOICE_SERVICE_CLIPPING_FAILED',
      message:
        this.readText(providerError?.message) ||
        (error instanceof Error ? error.message : String(error)),
      requestId: this.readText(providerError?.requestId) || undefined,
      httpStatus:
        this.readNumber(providerError?.httpStatus) || appError?.status || 500,
    };
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 1000) : '';
  }

  private readNumber(value: unknown): number | undefined {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  private get maxTotalClips(): number {
    const parsed = Number(this.config?.maxTotalClips);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : 8;
  }
}
