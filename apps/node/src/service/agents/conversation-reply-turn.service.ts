import { InjectEntityModel } from '@midwayjs/typeorm';
import { Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import {
  ConversationReplyTurnEntity,
  ConversationReplyTurnMode,
  ConversationTurnBoundaryHint,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

export const NORMAL_REPLY_SETTLE_MS = 2500;
export const NORMAL_REPLY_MAX_DEBOUNCE_MS = 8000;
export const LISTENING_BOUNDARY_FIRST_CHECK_MS = 12000;
export const LISTENING_BOUNDARY_UNCERTAIN_WAIT_MS = 22000;
export const LISTENING_BOUNDARY_CONTINUE_WAIT_MS = 12000;
export const LISTENING_LATEST_INPUT_ABSOLUTE_MS = 75000;
export const LISTENING_TURN_MAX_LIFETIME_MS = 5 * 60 * 1000;
export const LISTENING_TURN_MAX_MESSAGES = 12;
export const LISTENING_TURN_MAX_VISIBLE_CHARACTERS = 1200;
export const REPLY_TURN_GENERATION_LEASE_MS = 2 * 60 * 1000;
export const REPLY_TURN_RECOVERY_REQUEUE_MS = 20 * 1000;
export const REPLY_TURN_RECOVERY_BATCH_SIZE = 100;

export interface RegisterConversationReplyInputOptions {
  conversationId: MongoObjectId;
  userId: MongoObjectId;
  agentId: MongoObjectId;
  messageId: string;
  occurredAt: Date;
  searchableText?: string;
  createIfMissing: boolean;
}

export interface RegisterConversationReplyInputResult {
  turn?: ConversationReplyTurnEntity;
  action: 'created' | 'appended' | 'duplicate' | 'ignored';
  shouldSchedule: boolean;
  invalidatedGeneration: boolean;
}

export interface ConversationReplyTurnClientState {
  turnId: string;
  phase: 'collecting' | 'listening' | 'generating';
  waitingForUser: boolean;
  updatedAt: string;
}

@Provide()
export class ConversationReplyTurnService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(ConversationReplyTurnEntity)
  turnModel: MongoRepository<ConversationReplyTurnEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  async registerInput(
    options: RegisterConversationReplyInputOptions
  ): Promise<RegisterConversationReplyInputResult> {
    const activeKey = String(options.conversationId);
    let active = await this.findActiveByKey(activeKey);
    if (active && this.isTerminal(active)) {
      active = undefined;
    }
    if (
      active &&
      active.expiresAt <= options.occurredAt &&
      active.inputEpoch <= active.acknowledgedEpoch
    ) {
      await this.closeSatisfiedTurn(active, options.occurredAt);
      active = await this.findActiveByKey(activeKey);
    }

    if (!active) {
      if (!options.createIfMissing) {
        return {
          action: 'ignored',
          shouldSchedule: false,
          invalidatedGeneration: false,
        };
      }
      return this.createTurn(options, activeKey);
    }

    if (active.sourceMessageIds.includes(options.messageId)) {
      return {
        turn: active,
        action: 'duplicate',
        shouldSchedule: active.inputEpoch > active.acknowledgedEpoch,
        invalidatedGeneration: false,
      };
    }

    const invalidatedGeneration =
      active.status === 'generating' || active.status === 'delivering';
    const timing = this.resolveCollectionTiming({
      mode: active.mode,
      firstInputAt: active.firstInputAt,
      latestInputAt: options.occurredAt,
      searchableText: options.searchableText,
      messageCount: active.sourceMessageIds.length + 1,
      visibleCharacters:
        (active.sourceVisibleCharacters || 0) +
        this.countVisibleCharacters(options.searchableText),
    });
    const result = await this.turnModel.updateOne(
      {
        _id: active.id,
        activeKey,
        sourceMessageIds: { $ne: options.messageId },
      } as never,
      {
        $addToSet: { sourceMessageIds: options.messageId },
        $inc: {
          inputEpoch: 1,
          sourceVisibleCharacters: this.countVisibleCharacters(
            options.searchableText
          ),
        },
        $set: {
          status: 'collecting',
          latestInputAt: options.occurredAt,
          collectNotBeforeAt: timing.collectNotBeforeAt,
          absoluteReplyAt: timing.absoluteReplyAt,
          boundaryCheckCount: 0,
          updatedAt: options.occurredAt,
        },
        $unset: {
          generationEpoch: '',
          generationStartedAt: '',
          deliveryStartedAt: '',
          recoveryQueuedAt: '',
          lastError: '',
          lastBoundaryHint: '',
          lastBoundaryCheckedAt: '',
        },
      } as never
    );

    if (!Number(result?.modifiedCount || 0)) {
      const raced = await this.findActiveByKey(activeKey);
      if (raced?.sourceMessageIds.includes(options.messageId)) {
        return {
          turn: raced,
          action: 'duplicate',
          shouldSchedule: raced.inputEpoch > raced.acknowledgedEpoch,
          invalidatedGeneration,
        };
      }
      if (!raced && options.createIfMissing) {
        return this.createTurn(options, activeKey);
      }
      throw new Error('CONVERSATION_REPLY_TURN_APPEND_FAILED');
    }

    const verified = await this.requireReadback(active.id);
    if (!verified.sourceMessageIds.includes(options.messageId)) {
      throw new Error('CONVERSATION_REPLY_TURN_APPEND_READBACK_FAILED');
    }
    return {
      turn: verified,
      action: 'appended',
      shouldSchedule: true,
      invalidatedGeneration,
    };
  }

  async findActive(
    conversationId: MongoObjectId | string
  ): Promise<ConversationReplyTurnEntity | undefined> {
    const activeKey = String(conversationId);
    let turn = await this.findActiveByKey(activeKey);
    const now = new Date();
    if (
      turn &&
      turn.expiresAt <= now &&
      turn.inputEpoch <= turn.acknowledgedEpoch
    ) {
      await this.closeSatisfiedTurn(turn, now);
      turn = await this.findActiveByKey(activeKey);
    }
    return turn && !this.isTerminal(turn) ? turn : undefined;
  }

  async findByTurnId(
    turnId: string
  ): Promise<ConversationReplyTurnEntity | undefined> {
    return (await this.turnModel.findOne({ where: { turnId } })) || undefined;
  }

  async getClientState(
    conversationId: MongoObjectId | string
  ): Promise<ConversationReplyTurnClientState | undefined> {
    const turn = await this.findActive(conversationId);
    if (!turn) return undefined;
    const waitingForUser = turn.inputEpoch <= turn.acknowledgedEpoch;
    const phase =
      turn.status === 'generating' || turn.status === 'delivering'
        ? 'generating'
        : turn.mode === 'listening'
        ? 'listening'
        : 'collecting';
    return {
      turnId: turn.turnId,
      phase,
      waitingForUser,
      updatedAt: turn.updatedAt.toISOString(),
    };
  }

  async claimForGeneration(options: {
    turnId: string;
    expectedInputEpoch: number;
    now?: Date;
  }): Promise<ConversationReplyTurnEntity | undefined> {
    const now = options.now ?? new Date();
    const result = await this.turnModel.updateOne(
      {
        turnId: options.turnId,
        activeKey: { $exists: true },
        status: 'collecting',
        inputEpoch: options.expectedInputEpoch,
        acknowledgedEpoch: { $lt: options.expectedInputEpoch },
        collectNotBeforeAt: { $lte: now },
      } as never,
      {
        $set: {
          status: 'generating',
          generationEpoch: options.expectedInputEpoch,
          generationStartedAt: now,
          updatedAt: now,
        },
        $unset: { recoveryQueuedAt: '', lastError: '' },
      } as never
    );
    if (!Number(result?.modifiedCount || 0)) return undefined;
    return this.findByTurnId(options.turnId);
  }

  async releaseToCollecting(options: {
    turnId: string;
    generationEpoch: number;
    collectNotBeforeAt: Date;
    hint?: ConversationTurnBoundaryHint;
    error?: unknown;
    incrementBoundaryCheck?: boolean;
    now?: Date;
  }): Promise<ConversationReplyTurnEntity | undefined> {
    const now = options.now ?? new Date();
    const update: Record<string, unknown> = {
      $set: {
        status: 'collecting',
        collectNotBeforeAt: options.collectNotBeforeAt,
        updatedAt: now,
        ...(options.hint ? { lastBoundaryHint: options.hint } : {}),
        ...(options.hint ? { lastBoundaryCheckedAt: now } : {}),
        ...(options.error
          ? { lastError: this.describeError(options.error).slice(0, 500) }
          : {}),
      },
      $unset: {
        generationEpoch: '',
        generationStartedAt: '',
        deliveryStartedAt: '',
      },
    };
    if (options.incrementBoundaryCheck) {
      update.$inc = { boundaryCheckCount: 1 };
    }
    await this.turnModel.updateOne(
      {
        turnId: options.turnId,
        activeKey: { $exists: true },
        status: { $in: ['generating', 'delivering'] },
        generationEpoch: options.generationEpoch,
      } as never,
      update as never
    );
    return this.findByTurnId(options.turnId);
  }

  async deferCollecting(options: {
    turnId: string;
    expectedInputEpoch: number;
    collectNotBeforeAt: Date;
    hint?: ConversationTurnBoundaryHint;
    incrementBoundaryCheck?: boolean;
    now?: Date;
  }): Promise<ConversationReplyTurnEntity | undefined> {
    const now = options.now ?? new Date();
    const update: Record<string, unknown> = {
      $set: {
        collectNotBeforeAt: options.collectNotBeforeAt,
        updatedAt: now,
        ...(options.hint ? { lastBoundaryHint: options.hint } : {}),
        ...(options.hint ? { lastBoundaryCheckedAt: now } : {}),
      },
    };
    if (options.incrementBoundaryCheck) {
      update.$inc = { boundaryCheckCount: 1 };
    }
    await this.turnModel.updateOne(
      {
        turnId: options.turnId,
        activeKey: { $exists: true },
        status: 'collecting',
        inputEpoch: options.expectedInputEpoch,
      } as never,
      update as never
    );
    return this.findByTurnId(options.turnId);
  }

  async markDelivering(options: {
    turnId: string;
    generationEpoch: number;
    now?: Date;
  }): Promise<boolean> {
    const now = options.now ?? new Date();
    const result = await this.turnModel.updateOne(
      {
        turnId: options.turnId,
        activeKey: { $exists: true },
        status: 'generating',
        inputEpoch: options.generationEpoch,
        generationEpoch: options.generationEpoch,
      } as never,
      {
        $set: {
          status: 'delivering',
          deliveryStartedAt: now,
          updatedAt: now,
        },
      } as never
    );
    return Number(result?.modifiedCount || 0) > 0;
  }

  async cancelTurn(options: {
    turnId: string;
    reason: string;
    now?: Date;
  }): Promise<ConversationReplyTurnEntity | undefined> {
    const now = options.now ?? new Date();
    await this.turnModel.updateOne(
      {
        turnId: options.turnId,
        activeKey: { $exists: true },
        status: { $in: ['collecting', 'generating', 'delivering'] },
      } as never,
      {
        $set: {
          status: 'cancelled',
          cancellationReason: options.reason.slice(0, 120),
          cancelledAt: now,
          updatedAt: now,
        },
        $unset: {
          activeKey: '',
          generationEpoch: '',
          generationStartedAt: '',
          deliveryStartedAt: '',
          recoveryQueuedAt: '',
        },
      } as never
    );
    return this.findByTurnId(options.turnId);
  }

  async recordVisibleReply(options: {
    turnId: string;
    generationEpoch: number;
    messageIds: string[];
    nextMode: ConversationReplyTurnMode;
    now?: Date;
  }): Promise<ConversationReplyTurnEntity> {
    const now = options.now ?? new Date();
    const messageIds = Array.from(new Set(options.messageIds.filter(Boolean)));
    await this.verifyVisibleReplyMessages(options.turnId, messageIds);

    let modifiedCount = 0;
    if (options.nextMode === 'listening') {
      const result = await this.turnModel.updateOne(
        {
          turnId: options.turnId,
          activeKey: { $exists: true },
          status: 'delivering',
          generationEpoch: options.generationEpoch,
        } as never,
        {
          $set: {
            status: 'collecting',
            mode: 'listening',
            acknowledgedEpoch: options.generationEpoch,
            collectNotBeforeAt: now,
            updatedAt: now,
          },
          $addToSet: {
            acknowledgementMessageIds: { $each: messageIds },
          },
          $inc: { acknowledgementCount: 1 },
          $unset: {
            generationEpoch: '',
            generationStartedAt: '',
            deliveryStartedAt: '',
            recoveryQueuedAt: '',
            lastError: '',
          },
        } as never
      );
      modifiedCount = Number(result?.modifiedCount || 0);
    } else {
      const result = await this.turnModel.updateOne(
        {
          turnId: options.turnId,
          activeKey: { $exists: true },
          status: 'delivering',
          generationEpoch: options.generationEpoch,
        } as never,
        {
          $set: {
            status: 'answered',
            mode: 'normal',
            acknowledgedEpoch: options.generationEpoch,
            replyMessageIds: messageIds,
            answeredAt: now,
            updatedAt: now,
          },
          $unset: {
            activeKey: '',
            generationEpoch: '',
            generationStartedAt: '',
            deliveryStartedAt: '',
            recoveryQueuedAt: '',
            lastError: '',
          },
        } as never
      );
      modifiedCount = Number(result?.modifiedCount || 0);
    }

    // A new user message may arrive after the visible reply is persisted but
    // before this state transition. Keep the newer input active while recording
    // exactly which earlier epoch the already-visible reply covered.
    if (!modifiedCount) {
      const current = await this.requireTurnIdReadback(options.turnId);
      if (
        current.activeKey &&
        current.inputEpoch > options.generationEpoch &&
        current.acknowledgedEpoch < options.generationEpoch
      ) {
        const result = await this.turnModel.updateOne(
          {
            turnId: options.turnId,
            activeKey: { $exists: true },
            inputEpoch: { $gt: options.generationEpoch },
            acknowledgedEpoch: { $lt: options.generationEpoch },
          } as never,
          {
            $max: { acknowledgedEpoch: options.generationEpoch },
            $addToSet:
              options.nextMode === 'listening'
                ? {
                    acknowledgementMessageIds: { $each: messageIds },
                  }
                : { replyMessageIds: { $each: messageIds } },
            ...(options.nextMode === 'listening'
              ? { $inc: { acknowledgementCount: 1 } }
              : {}),
            $set: {
              ...(options.nextMode === 'listening'
                ? { mode: 'listening' }
                : {}),
              updatedAt: now,
            },
          } as never
        );
        modifiedCount = Number(result?.modifiedCount || 0);
      }
    }

    const verified = await this.requireTurnIdReadback(options.turnId);
    const recordedIds =
      options.nextMode === 'listening'
        ? verified.acknowledgementMessageIds
        : verified.replyMessageIds;
    const coveredByNewerActiveTurn =
      Boolean(verified.activeKey) &&
      verified.inputEpoch > options.generationEpoch &&
      verified.acknowledgedEpoch >= options.generationEpoch;
    const completedNormally =
      options.nextMode === 'listening'
        ? verified.acknowledgedEpoch >= options.generationEpoch
        : verified.status === 'answered';
    if (
      (!completedNormally && !coveredByNewerActiveTurn) ||
      !messageIds.every(id => recordedIds.includes(id))
    ) {
      throw new Error('CONVERSATION_REPLY_TURN_VISIBLE_READBACK_FAILED');
    }
    return verified;
  }

  /**
   * Reconcile the narrow crash window after assistant messages are persisted
   * but before the durable turn transition is recorded. A visible reply wins:
   * recovery must finalize it instead of generating a duplicate.
   */
  async reconcileVisibleDelivery(
    turn: ConversationReplyTurnEntity
  ): Promise<ConversationReplyTurnEntity | undefined> {
    if (this.isTerminal(turn)) return turn;
    if (turn.status !== 'delivering' || turn.generationEpoch === undefined) {
      return undefined;
    }
    const messages = await this.messageModel.find({
      where: {
        role: MessageRole.assistant,
        status: { $in: [MessageStatus.sent, MessageStatus.failed] },
        replyTurnId: turn.turnId,
      } as never,
      order: { createdAt: 'ASC' },
    });
    if (!messages.length) return undefined;

    const hasFinalEffect = messages.some(
      message =>
        message.replyTurnEffect === 'final_reply' ||
        message.replyTurnEffect === 'failure_reply'
    );
    const onlyListeningAcknowledgements =
      !hasFinalEffect &&
      messages.every(message => message.replyTurnEffect === 'listening_ack');
    return this.recordVisibleReply({
      turnId: turn.turnId,
      generationEpoch: turn.generationEpoch,
      messageIds: messages.map(message => String(message.id)),
      nextMode: onlyListeningAcknowledgements ? 'listening' : 'normal',
    });
  }

  async recoverDueTurns(
    now = new Date()
  ): Promise<ConversationReplyTurnEntity[]> {
    const staleGenerationAt = new Date(
      now.getTime() - REPLY_TURN_GENERATION_LEASE_MS
    );
    const staleGenerating = await this.turnModel.find({
      where: {
        activeKey: { $exists: true },
        status: { $in: ['generating', 'delivering'] },
        generationStartedAt: { $lte: staleGenerationAt },
      } as never,
      take: REPLY_TURN_RECOVERY_BATCH_SIZE,
    });
    for (const turn of staleGenerating) {
      if (turn.status === 'delivering') {
        try {
          const reconciled = await this.reconcileVisibleDelivery(turn);
          if (reconciled) continue;
        } catch (error) {
          // Do not reopen a turn when delivery may already be visible. Retrying
          // reconciliation is safer than producing a duplicate reply.
          this.logger?.error?.(
            '[conversation-reply-turn] delivery reconciliation failed, turnId=%s, reason=%s',
            turn.turnId,
            this.describeError(error)
          );
          continue;
        }
      }
      await this.turnModel.updateOne(
        {
          _id: turn.id,
          status: turn.status,
          generationStartedAt: turn.generationStartedAt,
        } as never,
        {
          $set: {
            status: 'collecting',
            collectNotBeforeAt: now,
            updatedAt: now,
            lastError: 'STALE_GENERATION_RECOVERED',
          },
          $inc: { recoveryCount: 1 },
          $unset: {
            generationEpoch: '',
            generationStartedAt: '',
            deliveryStartedAt: '',
          },
        } as never
      );
    }

    await this.closeIdleListeningTurns(now);
    const requeueBefore = new Date(
      now.getTime() - REPLY_TURN_RECOVERY_REQUEUE_MS
    );
    const due = await this.turnModel.find({
      where: {
        activeKey: { $exists: true },
        status: 'collecting',
        collectNotBeforeAt: { $lte: now },
        $or: [
          { recoveryQueuedAt: { $exists: false } },
          { recoveryQueuedAt: { $lte: requeueBefore } },
        ],
      } as never,
      order: { collectNotBeforeAt: 'ASC' },
      take: REPLY_TURN_RECOVERY_BATCH_SIZE,
    });
    const claimed: ConversationReplyTurnEntity[] = [];
    for (const turn of due) {
      if (turn.inputEpoch <= turn.acknowledgedEpoch) continue;
      const result = await this.turnModel.updateOne(
        {
          _id: turn.id,
          status: 'collecting',
          inputEpoch: turn.inputEpoch,
          $or: [
            { recoveryQueuedAt: { $exists: false } },
            { recoveryQueuedAt: { $lte: requeueBefore } },
          ],
        } as never,
        {
          $set: { recoveryQueuedAt: now, updatedAt: now },
        } as never
      );
      if (Number(result?.modifiedCount || 0)) {
        claimed.push((await this.requireReadback(turn.id)) || turn);
      }
    }
    return claimed;
  }

  isExplicitTurnHandoff(text = ''): boolean {
    const normalized = text.replace(/\s/gu, '');
    return /(?:我说完了|就这些|说完了|你说吧|你讲吧|该你了|你可以回了|现在回吧|听我说完了)/u.test(
      normalized
    );
  }

  private async createTurn(
    options: RegisterConversationReplyInputOptions,
    activeKey: string
  ): Promise<RegisterConversationReplyInputResult> {
    const timing = this.resolveCollectionTiming({
      mode: 'normal',
      firstInputAt: options.occurredAt,
      latestInputAt: options.occurredAt,
      searchableText: options.searchableText,
      messageCount: 1,
      visibleCharacters: this.countVisibleCharacters(options.searchableText),
    });
    const turn = new ConversationReplyTurnEntity();
    turn.schemaVersion = 'conversation_reply_turn_v1';
    turn.turnId = new MongoObjectId().toHexString();
    turn.activeKey = activeKey;
    turn.conversationId = options.conversationId;
    turn.userId = options.userId;
    turn.agentId = options.agentId;
    turn.status = 'collecting';
    turn.mode = 'normal';
    turn.sourceMessageIds = [options.messageId];
    turn.sourceVisibleCharacters = this.countVisibleCharacters(
      options.searchableText
    );
    turn.inputEpoch = 1;
    turn.acknowledgedEpoch = 0;
    turn.acknowledgementMessageIds = [];
    turn.replyMessageIds = [];
    turn.firstInputAt = options.occurredAt;
    turn.latestInputAt = options.occurredAt;
    turn.collectNotBeforeAt = timing.collectNotBeforeAt;
    turn.absoluteReplyAt = timing.absoluteReplyAt;
    turn.expiresAt = new Date(
      options.occurredAt.getTime() + LISTENING_TURN_MAX_LIFETIME_MS
    );
    turn.boundaryCheckCount = 0;
    turn.acknowledgementCount = 0;
    turn.recoveryCount = 0;
    turn.createdAt = options.occurredAt;
    turn.updatedAt = options.occurredAt;

    try {
      const saved = await this.turnModel.save(turn);
      const verified = await this.requireReadback(saved.id);
      return {
        turn: verified,
        action: 'created',
        shouldSchedule: true,
        invalidatedGeneration: false,
      };
    } catch (error) {
      const raced = await this.findActiveByKey(activeKey);
      if (!raced) throw error;
      return this.registerInput(options);
    }
  }

  private resolveCollectionTiming(options: {
    mode: ConversationReplyTurnMode;
    firstInputAt: Date;
    latestInputAt: Date;
    searchableText?: string;
    messageCount: number;
    visibleCharacters: number;
  }): { collectNotBeforeAt: Date; absoluteReplyAt: Date } {
    if (
      options.messageCount >= LISTENING_TURN_MAX_MESSAGES ||
      options.visibleCharacters >= LISTENING_TURN_MAX_VISIBLE_CHARACTERS
    ) {
      const forcedAt = new Date(options.latestInputAt.getTime() + 250);
      return { collectNotBeforeAt: forcedAt, absoluteReplyAt: forcedAt };
    }
    if (options.mode !== 'listening') {
      const absoluteReplyAt = new Date(
        options.firstInputAt.getTime() + NORMAL_REPLY_MAX_DEBOUNCE_MS
      );
      return {
        collectNotBeforeAt: new Date(
          Math.min(
            options.latestInputAt.getTime() + NORMAL_REPLY_SETTLE_MS,
            absoluteReplyAt.getTime()
          )
        ),
        absoluteReplyAt,
      };
    }

    const expiresAt =
      options.firstInputAt.getTime() + LISTENING_TURN_MAX_LIFETIME_MS;
    const absoluteAt = Math.min(
      options.latestInputAt.getTime() + LISTENING_LATEST_INPUT_ABSOLUTE_MS,
      expiresAt
    );
    const collectAt = this.isExplicitTurnHandoff(options.searchableText)
      ? options.latestInputAt.getTime() + 250
      : options.latestInputAt.getTime() + LISTENING_BOUNDARY_FIRST_CHECK_MS;
    return {
      collectNotBeforeAt: new Date(Math.min(collectAt, absoluteAt)),
      absoluteReplyAt: new Date(absoluteAt),
    };
  }

  private async closeIdleListeningTurns(now: Date): Promise<void> {
    const expired = await this.turnModel.find({
      where: {
        activeKey: { $exists: true },
        status: 'collecting',
        mode: 'listening',
        expiresAt: { $lte: now },
      } as never,
      take: REPLY_TURN_RECOVERY_BATCH_SIZE,
    });
    for (const turn of expired) {
      if (turn.inputEpoch > turn.acknowledgedEpoch) continue;
      await this.closeSatisfiedTurn(turn, now);
    }
  }

  private async closeSatisfiedTurn(
    turn: ConversationReplyTurnEntity,
    now: Date
  ): Promise<void> {
    await this.turnModel.updateOne(
      {
        _id: turn.id,
        activeKey: { $exists: true },
        status: 'collecting',
        inputEpoch: turn.inputEpoch,
        acknowledgedEpoch: turn.acknowledgedEpoch,
      } as never,
      {
        $set: {
          status: 'answered',
          replyMessageIds: Array.from(
            new Set([
              ...turn.replyMessageIds,
              ...turn.acknowledgementMessageIds,
            ])
          ),
          answeredAt: now,
          updatedAt: now,
        },
        $unset: { activeKey: '', recoveryQueuedAt: '' },
      } as never
    );
  }

  private async verifyVisibleReplyMessages(
    turnId: string,
    messageIds: string[]
  ): Promise<void> {
    if (!messageIds.length) {
      throw new Error('CONVERSATION_REPLY_TURN_VISIBLE_MESSAGE_REQUIRED');
    }
    const objectIds = messageIds.map(id => new MongoObjectId(id));
    const messages = await this.messageModel.find({
      where: {
        _id: { $in: objectIds },
        role: MessageRole.assistant,
        status: { $in: [MessageStatus.sent, MessageStatus.failed] },
        replyTurnId: turnId,
      } as never,
    });
    const readbackIds = new Set(messages.map(message => String(message.id)));
    if (!messageIds.every(id => readbackIds.has(id))) {
      throw new Error('CONVERSATION_REPLY_TURN_MESSAGE_READBACK_FAILED');
    }
  }

  private async findActiveByKey(
    activeKey: string
  ): Promise<ConversationReplyTurnEntity | undefined> {
    return (
      (await this.turnModel.findOne({ where: { activeKey } })) || undefined
    );
  }

  private async requireReadback(
    id: MongoObjectId
  ): Promise<ConversationReplyTurnEntity> {
    // MongoRepository raw filters address the ObjectId column as `_id`.
    // Using the entity property name `id` can save successfully and then miss
    // the independent readback, falsely turning a first create into a race.
    const turn = await this.turnModel.findOne({
      where: { _id: id } as never,
    });
    if (!turn) throw new Error('CONVERSATION_REPLY_TURN_READBACK_FAILED');
    return turn;
  }

  private async requireTurnIdReadback(
    turnId: string
  ): Promise<ConversationReplyTurnEntity> {
    const turn = await this.findByTurnId(turnId);
    if (!turn) throw new Error('CONVERSATION_REPLY_TURN_READBACK_FAILED');
    return turn;
  }

  private isTerminal(turn: ConversationReplyTurnEntity): boolean {
    return turn.status === 'answered' || turn.status === 'cancelled';
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private countVisibleCharacters(value = ''): number {
    return Array.from(value.replace(/\s/gu, '')).length;
  }
}
