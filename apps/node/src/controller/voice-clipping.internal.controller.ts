import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import {
  VoiceServiceMaterialItem,
  VoiceServiceProcessingMode,
} from '@tzl/entities';
import { VoiceClippingService } from '../service/voice-clipping.service';

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
      materials.some((item) => !item?.objectKey)
    ) {
      return { ok: false, error: 'MISSING_PARAMS' };
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

    const result = await this.voiceClippingService.createReviewClipsWithMetrics(
      items,
      processingMode
    );

    return {
      ok: true,
      userId,
      clips: result.clips,
      filteredClips: result.filteredClips,
      platformErrors: result.platformErrors,
      metrics: result.metrics,
    };
  }
}
