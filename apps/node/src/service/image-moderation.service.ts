import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import {
  isFolderInModerationScope,
  isFolderWithin,
  isImageUpload,
} from '../common/upload-policy';
import { TencentCosService } from './tencent-cos.service';

export type ImageModerationDecision = 'pass' | 'block';

export type ImageModerationReason =
  | 'normal'
  | 'violation'
  | 'suspected'
  | 'unavailable'
  | 'sampled_out'
  | 'skipped';

export interface ImageModerationConfig {
  enabled?: boolean;
  /** 公开目录（可传播内容）使用的策略，默认全量审核。 */
  bizType?: string;
  folders?: string[];
  /** 私密目录：改用红线策略 + 抽样，用来压缩成本。 */
  restrictedFolders?: string[];
  /** 私密目录使用的审核策略；留空则退回 bizType（仍然会审，只是不省钱）。 */
  restrictedBizType?: string;
  /** 私密目录抽样比例：1 全量，0.05 为 5%。 */
  restrictedSampleRate?: number;
  /** 按目录覆盖抽样比例，优先于 restrictedSampleRate。 */
  folderSampleRates?: Record<string, number>;
  /** 疑似违规（Result=2）的处理：block 拦截，其余值放行并记日志。 */
  reviewAction?: string;
  /** 审核服务不可用（超时/报错/无法解析）的处理：block 拦截，其余值放行并记日志。 */
  failureAction?: string;
  largeImageDetect?: boolean;
  timeoutMs?: number;
  logRawResponse?: boolean;
}

export interface ImageModerationInput {
  objectKey: string;
  folder?: string;
  contentType?: string;
  fileName?: string;
  userId?: string;
}

export interface ImageModerationSceneResult {
  hitFlag: number;
  score: number;
  label?: string;
}

export interface ParsedImageAudit {
  /** 0 正常，1 违规，2 疑似。 */
  resultCode: 0 | 1 | 2;
  label?: string;
  score?: number;
  scenes: Record<string, ImageModerationSceneResult>;
}

export interface ImageModerationResult {
  decision: ImageModerationDecision;
  reason: ImageModerationReason;
  label?: string;
  score?: number;
}

/** 会判定违规的场景；QualityInfo（低质量）不属于不安全内容，不参与拦截。 */
const UNSAFE_SCENE_KEYS = [
  'PornInfo',
  'AdsInfo',
  'IllegalInfo',
  'PoliticsInfo',
  'TerroristInfo',
];

const ALL_SCENE_KEYS = [...UNSAFE_SCENE_KEYS, 'QualityInfo'];

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_RESTRICTED_SAMPLE_RATE = 0.05;

/**
 * 抽样判定：对对象键做确定性哈希，同一张图结论稳定、可复现，也便于按日志核对覆盖率。
 * 对象键里已含随机片段，因此哈希在整体上是均匀的。
 */
export function shouldSampleAudit(
  objectKey: string,
  sampleRate: number
): boolean {
  if (!Number.isFinite(sampleRate) || sampleRate >= 1) {
    return true;
  }

  if (sampleRate <= 0) {
    return false;
  }

  return hashToUnitInterval(objectKey) < sampleRate;
}

function hashToUnitInterval(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash / 0x100000000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }

  return undefined;
}

function readNumber(
  source: Record<string, unknown>,
  keys: string[]
): number | undefined {
  const value = readValue(source, keys);

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readText(
  source: Record<string, unknown>,
  keys: string[]
): string | undefined {
  const value = readValue(source, keys);

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function deriveResultCode(
  scenes: Record<string, ImageModerationSceneResult>
): 0 | 1 | 2 {
  const flags = UNSAFE_SCENE_KEYS.map(key => scenes[key]?.hitFlag ?? 0);

  if (flags.includes(1)) {
    return 1;
  }

  return flags.includes(2) ? 2 : 0;
}

/**
 * 兼容解析图片审核响应。
 * 同步单次审核返回 `{ Status, JobId, RecognitionResult }`，字段为 PascalCase；
 * 不同 SDK / 版本存在平铺或小写返回，因此这里按结构取值而不是死记字段路径。
 * 无法识别结构时返回 null，由调用方按“审核不可用”策略处理。
 */
export function parseImageAuditResponse(
  input: unknown
): ParsedImageAudit | null {
  const root = asRecord(input);

  if (!root) {
    return null;
  }

  const status = readText(root, ['Status', 'status']);

  if (status && status.toLowerCase() !== 'success') {
    return null;
  }

  const container =
    asRecord(readValue(root, ['RecognitionResult', 'recognitionResult'])) ||
    root;
  const scenes: Record<string, ImageModerationSceneResult> = {};

  for (const sceneKey of ALL_SCENE_KEYS) {
    const scene = asRecord(
      readValue(container, [
        sceneKey,
        `${sceneKey.charAt(0).toLowerCase()}${sceneKey.slice(1)}`,
      ])
    );

    if (!scene) {
      continue;
    }

    scenes[sceneKey] = {
      hitFlag: readNumber(scene, ['HitFlag', 'hitFlag', 'Hit_flag']) ?? 0,
      score: readNumber(scene, ['Score', 'score']) ?? 0,
      label: readText(scene, ['Label', 'label', 'SubLabel', 'subLabel']),
    };
  }

  const explicitCode = readNumber(container, ['Result', 'result']);
  const hasKnownShape =
    explicitCode !== undefined || Object.keys(scenes).length > 0;

  if (!hasKnownShape) {
    return null;
  }

  const resultCode =
    explicitCode === 1 || explicitCode === 2 || explicitCode === 0
      ? (explicitCode as 0 | 1 | 2)
      : deriveResultCode(scenes);

  return {
    resultCode,
    label: readText(container, ['Label', 'label']),
    score: readNumber(container, ['Score', 'score']),
    scenes,
  };
}

@Provide()
export class ImageModerationService {
  @Logger()
  logger: ILogger;

  @Config('imageModeration')
  moderationConfig: ImageModerationConfig;

  @Inject()
  tencentCosService: TencentCosService;

  isEnabled(): boolean {
    return Boolean(this.moderationConfig?.enabled);
  }

  resolveFolders(): string[] {
    return this.moderationConfig?.folders || [];
  }

  resolveRestrictedFolders(): string[] {
    return this.moderationConfig?.restrictedFolders || [];
  }

  /** 私密目录：用红线策略 + 抽样，是成本压缩的唯一降级维度。 */
  isRestrictedFolder(folder?: string): boolean {
    return isFolderWithin(folder, this.resolveRestrictedFolders());
  }

  resolveSampleRate(folder?: string): number {
    if (!this.isRestrictedFolder(folder)) {
      return 1;
    }

    const normalizedFolder = (folder || '').trim().replace(/^\/+|\/+$/g, '');
    const overrides = this.moderationConfig?.folderSampleRates || {};
    const override = normalizedFolder ? overrides[normalizedFolder] : undefined;
    const configured =
      override === undefined
        ? this.moderationConfig?.restrictedSampleRate
        : override;
    const rate =
      typeof configured === 'number' && Number.isFinite(configured)
        ? configured
        : DEFAULT_RESTRICTED_SAMPLE_RATE;

    return Math.min(Math.max(rate, 0), 1);
  }

  resolveBizType(folder?: string): string | undefined {
    if (this.isRestrictedFolder(folder)) {
      // 私密目录优先用红线策略；漏配时退回默认策略，宁可多审也不漏审。
      return (
        this.moderationConfig?.restrictedBizType?.trim() ||
        this.moderationConfig?.bizType
      );
    }

    return this.moderationConfig?.bizType;
  }

  shouldModerate(input: {
    folder?: string;
    contentType?: string;
    fileName?: string;
  }): boolean {
    if (!this.isEnabled()) {
      return false;
    }

    if (!isImageUpload(input)) {
      return false;
    }

    return isFolderInModerationScope(input.folder, this.resolveFolders());
  }

  async moderate(input: ImageModerationInput): Promise<ImageModerationResult> {
    if (!this.shouldModerate(input)) {
      return { decision: 'pass', reason: 'skipped' };
    }

    const sampleRate = this.resolveSampleRate(input.folder);

    if (!shouldSampleAudit(input.objectKey, sampleRate)) {
      this.logger?.info?.(
        '[image-moderation] sampled out, objectKey=%s, folder=%s, userId=%s, sampleRate=%s',
        input.objectKey,
        input.folder || '',
        input.userId || '',
        sampleRate
      );

      return { decision: 'pass', reason: 'sampled_out' };
    }

    const bizType = this.resolveBizType(input.folder);
    const startedAt = Date.now();
    let parsed: ParsedImageAudit | null = null;
    let failure: string | undefined;

    try {
      const raw = await this.withTimeout(
        this.tencentCosService.auditImageByObjectKey({
          objectKey: input.objectKey,
          bizType,
          largeImageDetect: this.moderationConfig?.largeImageDetect,
        }),
        this.resolveTimeoutMs()
      );

      if (this.moderationConfig?.logRawResponse !== false) {
        this.logger?.info?.(
          '[image-moderation] audit response, objectKey=%s, body=%s',
          input.objectKey,
          this.truncateForLog(raw)
        );
      }

      parsed = parseImageAuditResponse(raw);
    } catch (error) {
      failure =
        error instanceof Error ? error.message : String(error ?? 'unknown');
    }

    if (!parsed) {
      const block = this.resolveBlocking(this.moderationConfig?.failureAction);
      const message =
        '[image-moderation] audit unavailable, action=%s, objectKey=%s, folder=%s, userId=%s, elapsedMs=%s, failure=%s';
      const params = [
        block ? 'block' : 'allow',
        input.objectKey,
        input.folder || '',
        input.userId || '',
        Date.now() - startedAt,
        failure || 'unrecognized response',
      ] as const;

      if (block) {
        this.logger?.warn?.(message, ...params);
      } else {
        this.logger?.error?.(message, ...params);
      }

      return {
        decision: block ? 'block' : 'pass',
        reason: 'unavailable',
      };
    }

    const result = this.resolveDecision(parsed, input, startedAt);

    return result;
  }

  private resolveDecision(
    parsed: ParsedImageAudit,
    input: ImageModerationInput,
    startedAt: number
  ): ImageModerationResult {
    if (parsed.resultCode === 1) {
      this.logger?.warn?.(
        '[image-moderation] blocked, objectKey=%s, folder=%s, userId=%s, label=%s, score=%s, elapsedMs=%s',
        input.objectKey,
        input.folder || '',
        input.userId || '',
        parsed.label || '',
        parsed.score ?? '',
        Date.now() - startedAt
      );

      return {
        decision: 'block',
        reason: 'violation',
        label: parsed.label,
        score: parsed.score,
      };
    }

    if (parsed.resultCode === 2) {
      const block = this.resolveBlocking(this.moderationConfig?.reviewAction);
      const message =
        '[image-moderation] suspected, action=%s, objectKey=%s, folder=%s, userId=%s, label=%s, score=%s, elapsedMs=%s';
      const params = [
        block ? 'block' : 'allow',
        input.objectKey,
        input.folder || '',
        input.userId || '',
        parsed.label || '',
        parsed.score ?? '',
        Date.now() - startedAt,
      ] as const;

      if (block) {
        this.logger?.warn?.(message, ...params);
      } else {
        this.logger?.info?.(message, ...params);
      }

      return {
        decision: block ? 'block' : 'pass',
        reason: 'suspected',
        label: parsed.label,
        score: parsed.score,
      };
    }

    this.logger?.info?.(
      '[image-moderation] passed, objectKey=%s, folder=%s, userId=%s, label=%s, elapsedMs=%s',
      input.objectKey,
      input.folder || '',
      input.userId || '',
      parsed.label || '',
      Date.now() - startedAt
    );

    return {
      decision: 'pass',
      reason: 'normal',
      label: parsed.label,
      score: parsed.score,
    };
  }

  private resolveBlocking(action?: string): boolean {
    return action?.trim().toLowerCase() === 'block';
  }

  private resolveTimeoutMs(): number {
    const configured = this.moderationConfig?.timeoutMs;

    if (
      typeof configured !== 'number' ||
      !Number.isFinite(configured) ||
      configured <= 0
    ) {
      return DEFAULT_TIMEOUT_MS;
    }

    return Math.floor(configured);
  }

  private truncateForLog(value: unknown, maxLength = 2000): string {
    let text: string;

    try {
      text = typeof value === 'string' ? value : JSON.stringify(value);
    } catch {
      text = '[unserializable]';
    }

    const normalized = text ?? '';

    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength)}...[truncated]`
      : normalized;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`image moderation timeout ${timeoutMs}ms`)),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
