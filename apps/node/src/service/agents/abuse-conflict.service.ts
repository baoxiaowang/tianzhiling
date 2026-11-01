import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import {
  AbuseConflictLevel,
  buildAbuseConflictPrompt,
  detectAbuseTargeting,
  isCalmingText,
  isSelfCrisisText,
} from './abuse-targeting';

interface ConflictModeState {
  level: AbuseConflictLevel;
  updatedAt: number;
}

const MODE_TTL_MS = 30 * 60 * 1000;
const SIGNAL_TTL_MS = 10 * 60 * 1000;

/**
 * 会话级“冲突边界模式”。
 *
 * - 第一次强辱骂只记信号，不立刻回怼；
 * - 同一条含两个强辱骂，或 10 分钟内第二次强辱骂，才进入；
 * - 进入后只作用于连续冲突轮；用户冷静/道歉/转移话题立即退出；
 * - 用户出现自伤/自杀表达时立即退出，交给安全链路。
 */
@Provide()
export class AbuseConflictService {
  @Logger()
  logger: ILogger;

  @Inject()
  redisService: RedisService;

  async observe(options: {
    conversationId: string;
    text: string;
  }): Promise<{ active: boolean; level?: AbuseConflictLevel }> {
    const conversationId = options.conversationId?.trim();
    if (!conversationId) return { active: false };
    const text = (options.text || '').trim();
    if (!text) return { active: false };

    try {
      if (isSelfCrisisText(text)) {
        await this.clear(conversationId);
        return { active: false };
      }

      const existing = await this.readMode(conversationId);
      if (existing && isCalmingText(text)) {
        await this.clear(conversationId);
        return { active: false };
      }

      const signal = detectAbuseTargeting(text);
      if (!signal.strong) {
        // 用户已经不再辱骂：不把上一轮的怒气延续到正常聊天。
        if (existing) await this.clear(conversationId);
        return { active: false };
      }

      const signalKey = this.signalKey(conversationId);
      const previousSignals = Number(await this.redisService.get(signalKey)) || 0;
      const nextSignals = previousSignals + signal.matches.length;
      await this.redisService.set(
        signalKey,
        String(nextSignals),
        'PX',
        SIGNAL_TTL_MS
      );

      if (!existing && nextSignals < 2) {
        return { active: false };
      }

      const level = existing
        ? (Math.min(3, existing.level + 1) as AbuseConflictLevel)
        : 1;
      const next: ConflictModeState = { level, updatedAt: Date.now() };
      await this.redisService.set(
        this.modeKey(conversationId),
        JSON.stringify(next),
        'PX',
        MODE_TTL_MS
      );
      this.logger?.info?.(
        '[abuse-conflict] enter, conversationId=%s level=%s matches=%s',
        conversationId,
        level,
        signal.matches.join('|')
      );
      return { active: true, level };
    } catch (error) {
      this.logger?.warn?.(
        '[abuse-conflict] observe skipped, conversationId=%s reason=%s',
        conversationId,
        error instanceof Error ? error.message : String(error)
      );
      return { active: false };
    }
  }

  async buildPrompt(conversationId: string): Promise<string | undefined> {
    const mode = await this.readMode(conversationId);
    return mode ? buildAbuseConflictPrompt(mode.level) : undefined;
  }

  async clear(conversationId: string): Promise<void> {
    if (!conversationId) return;
    try {
      await this.redisService.del(
        this.modeKey(conversationId),
        this.signalKey(conversationId)
      );
    } catch {
      // 清理失败不影响正常回复；模式有 TTL 自动过期。
    }
  }

  private async readMode(
    conversationId: string
  ): Promise<ConflictModeState | undefined> {
    try {
      const raw = await this.redisService.get(this.modeKey(conversationId));
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as ConflictModeState;
      const level = Number(parsed?.level);
      if (level !== 1 && level !== 2 && level !== 3) return undefined;
      return { level, updatedAt: Number(parsed.updatedAt) || Date.now() };
    } catch {
      return undefined;
    }
  }

  private modeKey(conversationId: string): string {
    return `abuse-conflict:mode:${conversationId}`;
  }

  private signalKey(conversationId: string): string {
    return `abuse-conflict:signal:${conversationId}`;
  }
}
