import { Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MessageEntity, MessageRole, MessageType } from '@tzl/entities';
import { MongoRepository } from 'typeorm';

export interface ChatStatsQuery {
  since?: string;
  sampleSize?: number;
}

export interface ChatStatsResult {
  since: string;
  generatedAt: string;
  totals: {
    assistantMessages: number;
    userMessages: number;
    voiceReplies: number;
  };
  guardrail: {
    rewrittenCount: number;
    rewriteRate: string;
    topReasons: Array<{ reason: string; count: number }>;
  };
  length: {
    avgVisibleChars: number;
    sampledCount: number;
  };
  samples: Array<{
    content: string;
    type: string;
    createdAt: string;
    replyVisibleCharacters?: number;
    replyGuardrailRewritten?: boolean;
    replyGuardrailReason?: string;
    replyIntent?: string;
    replyScene?: string;
    replyBriefMode?: string;
    replyStrategyVersion?: string;
  }>;
}

@Provide()
export class AdminChatStatsService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  async getStats(query: ChatStatsQuery = {}): Promise<ChatStatsResult> {
    const since = query.since
      ? new Date(query.since)
      : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const sampleSize = Math.min(Math.max(query.sampleSize ?? 50, 1), 500);

    const mongoSince = new Date(since.getTime());
    const assistantFilter = {
      role: MessageRole.assistant,
      createdAt: { $gte: mongoSince },
    };
    const userFilter = {
      role: MessageRole.user,
      createdAt: { $gte: mongoSince },
    };

    const [
      assistantCount,
      userCount,
      voiceCount,
      rewrittenCount,
      avgCharsResult,
      reasonRows,
      samples,
    ] = await Promise.all([
      this.messageModel.count(assistantFilter),
      this.messageModel.count(userFilter),
      this.messageModel.count({ ...assistantFilter, type: MessageType.voice }),
      this.messageModel.count({
        ...assistantFilter,
        replyGuardrailRewritten: true,
      }),
      this.messageModel.aggregate([
        { $match: { ...assistantFilter, replyVisibleCharacters: { $exists: true } } },
        { $group: { _id: null, avg: { $avg: '$replyVisibleCharacters' }, count: { $sum: 1 } } },
      ]).toArray(),
      this.messageModel.aggregate([
        { $match: { ...assistantFilter, replyGuardrailRewritten: true, replyGuardrailReason: { $exists: true, $ne: '' } } },
        { $group: { _id: '$replyGuardrailReason', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]).toArray(),
      this.messageModel.aggregate([
        { $match: assistantFilter },
        { $sort: { createdAt: -1 } },
        { $limit: sampleSize },
        { $project: {
          _id: 0,
          content: 1,
          type: 1,
          createdAt: 1,
          replyVisibleCharacters: 1,
          replyGuardrailRewritten: 1,
          replyGuardrailReason: 1,
          replyIntent: 1,
          replyScene: 1,
          replyBriefMode: 1,
          replyStrategyVersion: 1,
        }},
      ]).toArray(),
    ]);

    const avgChars = avgCharsResult[0]?.avg ?? 0;
    const sampledCountForAvg = avgCharsResult[0]?.count ?? 0;

    return {
      since: since.toISOString(),
      generatedAt: new Date().toISOString(),
      totals: {
        assistantMessages: assistantCount,
        userMessages: userCount,
        voiceReplies: voiceCount,
      },
      guardrail: {
        rewrittenCount,
        rewriteRate:
          assistantCount > 0
            ? `${((rewrittenCount / assistantCount) * 100).toFixed(1)}%`
            : '0%',
        topReasons: reasonRows.map((r: { _id: string; count: number }) => ({
          reason: r._id,
          count: r.count,
        })),
      },
      length: {
        avgVisibleChars: avgChars > 0 ? Math.round(avgChars * 10) / 10 : 0,
        sampledCount: sampledCountForAvg,
      },
      samples,
    };
  }

  async getFailureStats(since?: string): Promise<{
    since: string;
    generatedAt: string;
    totalFailures: number;
    byStage: Array<{ stage: string; count: number }>;
    byModel: Array<{ model: string; count: number; avgTokens: number }>;
    byScene: Array<{ scene: string; count: number }>;
    byFallbackSource: Array<{ source: string; count: number }>;
    recentFailures: Array<{
      createdAt: string;
      stage?: string;
      code?: string;
      model?: string;
      scene?: string;
      fallbackSource?: string;
      visibleChars?: number;
      content: string;
    }>;
  }> {
    const sinceDate = since
      ? new Date(since)
      : new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const mongoSince = new Date(sinceDate.getTime());
    const failureFilter = {
      role: MessageRole.assistant,
      createdAt: { $gte: mongoSince },
      $or: [
        { replyGenerationFailureStage: { $exists: true, $ne: null } },
        { replyGuardrailReason: '模型回复不可用，采用场景安全兜底气泡' },
      ],
    };

    const [
      total,
      byStage,
      byScene,
      byFallback,
      recentFailures,
    ] = await Promise.all([
      this.messageModel.count(failureFilter),
      this.messageModel.aggregate([
        { $match: failureFilter },
        { $group: { _id: '$replyGenerationFailureStage', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      this.messageModel.aggregate([
        { $match: failureFilter },
        { $group: { _id: '$replyScene', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      this.messageModel.aggregate([
        { $match: failureFilter },
        { $group: { _id: '$replyFallbackSource', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      this.messageModel.aggregate([
        { $match: failureFilter },
        { $sort: { createdAt: -1 } },
        { $limit: 40 },
        { $project: {
          _id: 0,
          createdAt: 1,
          replyGenerationFailureStage: 1,
          replyGenerationFailureCode: 1,
          model: 1,
          replyScene: 1,
          replyFallbackSource: 1,
          replyVisibleCharacters: 1,
          content: 1,
        }},
      ]).toArray(),
    ]);

    return {
      since: sinceDate.toISOString(),
      generatedAt: new Date().toISOString(),
      totalFailures: total,
      byStage: byStage.map((r: { _id: string; count: number }) => ({
        stage: r._id || 'unknown',
        count: r.count,
      })),
      byModel: [],
      byScene: byScene.map((r: { _id: string; count: number }) => ({
        scene: r._id || 'unknown',
        count: r.count,
      })),
      byFallbackSource: byFallback.map((r: { _id: string; count: number }) => ({
        source: r._id || 'unknown',
        count: r.count,
      })),
      recentFailures,
    };
  }
}
