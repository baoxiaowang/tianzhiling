import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  ConversationEmotionStateEntity,
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';
import { AgentProfileFactService } from './agent-profile-fact.service';
import {
  extractSharedFamilyMemberDeclarations,
  stripKnownFamilyMemberEmotionClauses,
} from './shared-family-member';

export interface RecognizeEmotionStateOptions {
  message: MessageEntity;
  searchableText: string;
  recentMessages?: MessageEntity[];
  now?: Date;
}

export interface GetCurrentEmotionStateOptions {
  conversationId: MongoObjectId;
  userId: MongoObjectId;
  agentId: MongoObjectId;
  now?: Date;
}

export interface ConversationEmotionStateSummary {
  primaryEmotion: ConversationEmotionPrimary;
  riskLevel: ConversationEmotionRiskLevel;
  signals: string[];
  expiresAt: Date;
  sourceMessageId?: MongoObjectId;
}

interface EmotionRule {
  emotion: ConversationEmotionPrimary;
  riskLevel: ConversationEmotionRiskLevel;
  signal: string;
  priority: number;
  ttlMs: number;
  patterns: RegExp[];
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const EMOTION_RULES: EmotionRule[] = [
  {
    emotion: ConversationEmotionPrimary.crisisRisk,
    riskLevel: ConversationEmotionRiskLevel.high,
    signal: 'crisis_risk.high',
    priority: 100,
    ttlMs: 24 * HOUR_MS,
    patterns: [
      /不想活|想死|去死|死了算了|活不下去|撑不住|撑不下去|想去陪你|去陪你|过去陪你|下去陪你|来陪你|想去找你|想陪你走|我也走|结束生命|自杀|轻生|想不开/,
      /怕我想不开|不让我靠近殡仪馆|怕我.*(?:自杀|轻生|出事)/,
    ],
  },
  {
    emotion: ConversationEmotionPrimary.fear,
    riskLevel: ConversationEmotionRiskLevel.low,
    signal: 'presence.fear',
    priority: 88,
    ttlMs: 2 * HOUR_MS,
    patterns: [
      /(?:吓|怕|害怕|恐怖|发毛|不敢).{0,18}(?:摸我|碰我|你来了|你在|刚才|床边|房间)/,
    ],
  },
  {
    emotion: ConversationEmotionPrimary.expectingPresence,
    riskLevel: ConversationEmotionRiskLevel.none,
    signal: 'presence.expecting',
    priority: 86,
    ttlMs: 2 * HOUR_MS,
    patterns: [
      /(?:刚才|刚刚|是不是|是不是你|是你)?[^，。！？!?]{0,12}(?:你)?(?:摸我|碰我|抱我|亲我|拉我|拍我|碰到我|摸到我|抱到我|亲到我)/,
      /(?:你在|你是不是在|你是不是来了|你来过).{0,12}(?:我身边|旁边|房间|床边|这里|这儿)/,
    ],
  },
  {
    emotion: ConversationEmotionPrimary.angerBlame,
    riskLevel: ConversationEmotionRiskLevel.none,
    signal: 'grief.anger_blame',
    priority: 78,
    ttlMs: 2 * HOUR_MS,
    patterns: [
      /为什么.{0,8}(?:走|离开|丢下|不要我们)|怎么.{0,8}(?:说走就走|就走了|突然走|突然没了|离开)/,
    ],
  },
  {
    emotion: ConversationEmotionPrimary.guilt,
    riskLevel: ConversationEmotionRiskLevel.none,
    signal: 'grief.guilt',
    priority: 70,
    ttlMs: 2 * HOUR_MS,
    patterns: [/对不起|抱歉|怪我|都是我|都怪我|是我不好|我不好|亏欠|原谅我/],
  },
  {
    emotion: ConversationEmotionPrimary.attachment,
    riskLevel: ConversationEmotionRiskLevel.none,
    signal: 'grief.attachment',
    priority: 64,
    ttlMs: 2 * HOUR_MS,
    patterns: [
      /(?:背着|戴着|带着|留着|收着|抱着|保存|珍藏).{0,16}(?:你|您|他|她|TA).{0,8}(?:给我|送我|留下|留给我)/,
      /(?:你|您|他|她|TA).{0,8}(?:给我|送我|留下|留给我).{0,20}(?:包|衣服|戒指|项链|手链|手表|照片|相片|物件|东西|礼物|娃娃|玩偶|钥匙|信|书|围巾)/,
    ],
  },
  {
    emotion: ConversationEmotionPrimary.missing,
    riskLevel: ConversationEmotionRiskLevel.none,
    signal: 'grief.missing',
    priority: 60,
    ttlMs: 2 * HOUR_MS,
    patterns: [
      /想你|想您|好想|特别想|梦见|梦到|思念|舍不得|念你|没你|没有你|你不在/,
      /(?:来|到|进|回|见|找|陪|抱).{0,10}梦里|梦里.{0,10}(?:来|到|见|找|陪|抱)|托梦/,
    ],
  },
  {
    emotion: ConversationEmotionPrimary.sadness,
    riskLevel: ConversationEmotionRiskLevel.low,
    signal: 'grief.sadness',
    priority: 50,
    ttlMs: 6 * HOUR_MS,
    patterns: [
      /难过|崩溃|哭|心疼|难熬|受不了|痛苦|孤独|孤单|没底气|没有底气|没依靠|没有依靠|无依无靠|心里发慌|心慌/,
    ],
  },
];

@Provide()
export class AgentEmotionStateService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationEmotionStateEntity)
  stateModel: MongoRepository<ConversationEmotionStateEntity>;

  @Inject()
  agentProfileFactService: AgentProfileFactService;

  async recognizeAndUpsertFromUserMessage(
    options: RecognizeEmotionStateOptions
  ): Promise<ConversationEmotionStateSummary | null> {
    const now = options.now ?? new Date();
    const familyMemberNames = await this.resolveSharedFamilyMemberNames(options);
    const text = this.buildRecognitionText(options, familyMemberNames);
    const matches = this.matchRules(text);

    if (!matches.length) {
      return null;
    }

    const primary = matches[0];
    const existing = await this.stateModel.findOne({
      where: {
        conversationId: options.message.conversationId,
        userId: options.message.userId,
        agentId: options.message.agentId,
      },
    });
    const state = existing ?? new ConversationEmotionStateEntity();

    state.conversationId = options.message.conversationId;
    state.userId = options.message.userId;
    state.agentId = options.message.agentId;
    state.primaryEmotion = primary.emotion;
    state.riskLevel = primary.riskLevel;
    state.signals = Array.from(new Set(matches.map(match => match.signal)));
    state.sourceMessageId = options.message.id;
    state.expiresAt = new Date(now.getTime() + primary.ttlMs);
    state.createdAt = existing?.createdAt ?? now;
    state.updatedAt = now;

    await this.stateModel.save(state);

    return this.toSummary(state);
  }

  async getCurrentState(
    options: GetCurrentEmotionStateOptions
  ): Promise<ConversationEmotionStateSummary | null> {
    const now = options.now ?? new Date();
    const state = await this.stateModel.findOne({
      where: {
        conversationId: options.conversationId,
        userId: options.userId,
        agentId: options.agentId,
      },
    });

    if (!state || state.expiresAt.getTime() <= now.getTime()) {
      return null;
    }

    return this.toSummary(state);
  }

  private buildRecognitionText(
    options: RecognizeEmotionStateOptions,
    familyMemberNames: string[]
  ): string {
    const recent = (options.recentMessages || [])
      .slice(-4)
      .map(message =>
        message.role === MessageRole.user
          ? stripKnownFamilyMemberEmotionClauses(
              message.content?.trim() || '',
              familyMemberNames
            )
          : ''
      )
      .filter(Boolean)
      .join('\n');
    const current = stripKnownFamilyMemberEmotionClauses(
      options.searchableText.trim(),
      familyMemberNames
    );

    return [recent, current].filter(Boolean).join('\n').slice(-1200);
  }

  private async resolveSharedFamilyMemberNames(
    options: RecognizeEmotionStateOptions
  ): Promise<string[]> {
    const declaredNames = extractSharedFamilyMemberDeclarations(
      options.searchableText
    ).map(member => member.name);

    if (!this.agentProfileFactService) {
      return declaredNames;
    }

    try {
      const storedNames =
        await this.agentProfileFactService.listSharedFamilyMemberNames({
          userId: options.message.userId,
          agentId: options.message.agentId,
        });

      return Array.from(new Set([...storedNames, ...declaredNames]));
    } catch (error) {
      this.logger?.warn?.(
        '[agent-emotion-state] shared family lookup failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return declaredNames;
    }
  }

  private matchRules(text: string): EmotionRule[] {
    return EMOTION_RULES.filter(rule =>
      rule.patterns.some(pattern => pattern.test(text))
    ).sort((left, right) => right.priority - left.priority);
  }

  private toSummary(
    state: ConversationEmotionStateEntity
  ): ConversationEmotionStateSummary {
    return {
      primaryEmotion: state.primaryEmotion,
      riskLevel: state.riskLevel,
      signals: state.signals || [],
      expiresAt: state.expiresAt,
      sourceMessageId: state.sourceMessageId,
    };
  }
}
