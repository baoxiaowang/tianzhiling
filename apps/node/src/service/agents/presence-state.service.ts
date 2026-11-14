import { Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  PresenceStateEntity,
  type MongoObjectId,
} from '@tzl/entities';
import {
  derivePresenceState,
  extractPresenceSignals,
  type PresenceStateSummary,
} from './presence-state';

export interface ObservePresenceStateOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  searchableText: string;
  sourceMessageId?: MongoObjectId;
  now?: Date;
}

export interface GetPresenceStateOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  now?: Date;
}

@Provide()
export class PresenceStateService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(PresenceStateEntity)
  stateModel: MongoRepository<PresenceStateEntity>;

  async observeUserMessage(
    options: ObservePresenceStateOptions
  ): Promise<PresenceStateSummary | null> {
    const text = String(options.searchableText || '').trim();
    if (!text) return null;
    const signals = extractPresenceSignals(text);
    if (!signals.length) return null;
    const now = options.now ?? new Date();
    try {
      const existing = await this.stateModel.findOne({
        where: {
          userId: options.userId,
          agentId: options.agentId,
        },
      });
      const previous =
        existing && existing.expiresAt.getTime() > now.getTime()
          ? this.toSummary(existing)
          : null;
      const next = derivePresenceState({
        previous,
        signals,
        sourceMessageId: options.sourceMessageId
          ? String(options.sourceMessageId)
          : undefined,
        now,
      });
      if (!next) return null;
      const state = existing ?? new PresenceStateEntity();
      state.userId = options.userId;
      state.agentId = options.agentId;
      state.physicalExpectation = next.physicalExpectation;
      state.contactChannel = next.contactChannel;
      state.initiation = next.initiation;
      state.realityFraming = next.realityFraming;
      state.confidence = next.confidence;
      state.evidence = next.evidence;
      state.lastSignalAt = next.lastSignalAt;
      state.expiresAt = next.expiresAt;
      state.createdAt = existing?.createdAt ?? now;
      state.updatedAt = now;
      await this.stateModel.save(state);
      return this.toSummary(state);
    } catch (error) {
      this.logger.warn(
        '[presence-state] observe failed, userId=%s agentId=%s reason=%s',
        String(options.userId),
        String(options.agentId),
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  async getCurrentState(
    options: GetPresenceStateOptions
  ): Promise<PresenceStateSummary | null> {
    const now = options.now ?? new Date();
    try {
      const state = await this.stateModel.findOne({
        where: {
          userId: options.userId,
          agentId: options.agentId,
        },
      });
      if (!state || state.expiresAt.getTime() <= now.getTime()) return null;
      return this.toSummary(state);
    } catch (error) {
      this.logger.warn(
        '[presence-state] load failed, userId=%s agentId=%s reason=%s',
        String(options.userId),
        String(options.agentId),
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  private toSummary(state: PresenceStateEntity): PresenceStateSummary {
    return {
      physicalExpectation: state.physicalExpectation,
      contactChannel: state.contactChannel,
      initiation: state.initiation,
      realityFraming: state.realityFraming,
      confidence: state.confidence,
      evidence: state.evidence || [],
      lastSignalAt: state.lastSignalAt,
      expiresAt: state.expiresAt,
    };
  }
}
