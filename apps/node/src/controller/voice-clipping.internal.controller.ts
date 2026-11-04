import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  VoiceServiceMaterialItem,
  VoiceServiceProcessingMode,
} from '@tzl/entities';
import { VoiceClippingService } from '../service/voice-clipping.service';

/**
 * 同一批素材的剪辑在进程内做去重：
 * - 并发重复请求（双击/重试）复用同一个 Promise，不再各跑一遍；
 * - 10 分钟内的重复请求直接返回上次结果，避免重复生成片段。
 */
const CLIP_CACHE_TTL_MS = 10 * 60 * 1000;
const clipInFlight = new Map<string, Promise<unknown>>();
const clipRecent = new Map<string, { at: number; result: unknown }>();

function clipCacheKey(userId: string, materials: { objectKey?: string }[], mode?: string) {
  const keys = materials.map(item => item?.objectKey || '').sort().join('|');
  return `${userId}::${mode || 'assisted'}::${keys}`;
}

/**
 * 内部接口：供管理后台触发底层声音剪辑工作流。
 * 需携带与 .env INTERNAL_API_SECRET 一致的 x-internal-secret 请求头。
 */
@Controller('/system')
export class VoiceClippingInternalController {
  @Inject()
  ctx: Context;

  @Inject()
  voiceClippingService: VoiceClippingService;

  @Post('/voice-clipping')
  async clip(
    @Body()
    body: {
      userId?: string;
      materials?: {
        id?: string;
        name?: string;
        objectKey?: string;
        publicUrl?: string;
        durationSeconds?: number;
      }[];
      mode?: string;
    }
  ) {
    const secret = this.ctx.get('x-internal-secret');
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || secret !== expected) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }

    const { userId, materials, mode } = body ?? {};
    if (
      !userId ||
      !Array.isArray(materials) ||
      !materials.length ||
      materials.some(item => !item?.objectKey)
    ) {
      return { ok: false, error: 'MISSING_PARAMS' };
    }

    const cacheKey = clipCacheKey(userId, materials, mode);
    const cached = clipRecent.get(cacheKey);
    if (cached && Date.now() - cached.at < CLIP_CACHE_TTL_MS) {
      return { ...(cached.result as Record<string, unknown>), cached: true };
    }
    const running = clipInFlight.get(cacheKey);
    if (running) {
      return (await running) as Record<string, unknown>;
    }

    const items: VoiceServiceMaterialItem[] = materials.map((item, index) => ({
      id: item.id || `material-${index}`,
      name: item.name || '未命名素材',
      objectKey: item.objectKey,
      publicUrl: item.publicUrl,
      durationSeconds: item.durationSeconds,
      createdAt: new Date(),
    }));

    const processingMode =
      mode === VoiceServiceProcessingMode.readyToUse
        ? VoiceServiceProcessingMode.readyToUse
        : VoiceServiceProcessingMode.assisted;

    const task = this.voiceClippingService.createReviewClipsWithMetrics(
      items,
      processingMode
    );
    clipInFlight.set(cacheKey, task);
    let result: Awaited<typeof task>;
    try {
      result = await task;
    } finally {
      clipInFlight.delete(cacheKey);
    }

    const payload = {
      ok: true,
      userId,
      clips: result.clips,
      filteredClips: result.filteredClips,
      platformErrors: result.platformErrors,
      metrics: result.metrics,
    };
    clipRecent.set(cacheKey, { at: Date.now(), result: payload });
    return payload;
  }

  @Post('/voice-clipping/recut')
  async recut(
    @Body()
    body: {
      objectKey?: string;
      fileName?: string;
      durationSeconds?: number;
      instruction?: string;
      sourceMaterialId?: string;
      sourceName?: string;
      speakerId?: string;
    }
  ) {
    const secret = this.ctx.get('x-internal-secret');
    const expected = process.env.INTERNAL_API_SECRET;
    if (!expected || secret !== expected) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    if (
      !body?.objectKey ||
      !body.fileName ||
      !body.instruction ||
      !Number.isFinite(Number(body.durationSeconds))
    ) {
      return { ok: false, error: 'MISSING_PARAMS' };
    }

    const clip = await this.voiceClippingService.recutReviewClip({
      objectKey: body.objectKey,
      fileName: body.fileName,
      durationSeconds: Number(body.durationSeconds),
      instruction: body.instruction,
      sourceMaterialId: body.sourceMaterialId,
      sourceName: body.sourceName,
      speakerId: body.speakerId,
    });
    return { ok: true, clip };
  }
}
