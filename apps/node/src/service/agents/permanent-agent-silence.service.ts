import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  assessPermanentAgentSilence,
  parsePermanentAgentSilenceState,
  getPermanentAgentSilenceDeclaration,
  PermanentAgentSilenceState,
  serializePermanentAgentSilenceState,
} from './permanent-agent-silence';

const ACTIVATION_LOCK_TTL_MS = 10 * 1000;
const ACTIVE_CACHE_TTL_SECONDS = 24 * 60 * 60;
const NEGATIVE_CACHE_TTL_SECONDS = 30;

export interface PermanentAgentSilenceActivation {
  declaration?: MessageEntity;
}

@Provide()
export class PermanentAgentSilenceService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @Inject()
  redisService: RedisService;

  async isPermanentlySilent(agent?: AgentEntity | null): Promise<boolean> {
    if (!agent || agent.messengerOfAgentId) {
      return false;
    }

    const agentId = this.idOf(agent.id);
    const cacheKey = this.stateCacheKey(agentId);
    try {
      const cached = await this.redisService?.get(cacheKey);
      if (cached === 'active') return true;
      if (cached === 'none') return false;
    } catch (error) {
      this.logger.warn(
        '[permanent-agent-silence] cache read failed, agentId=%s, reason=%s',
        agentId,
        this.describeError(error)
      );
    }

    const stored = await this.findState(agent);
    await this.cacheState(agentId, Boolean(stored));
    return Boolean(stored);
  }

  async suppressReplyIfPermanentlySilent(
    agent: AgentEntity | null,
    messages: MessageEntity[]
  ): Promise<boolean> {
    if (!(await this.isPermanentlySilent(agent))) {
      return false;
    }

    await this.markMessagesPermanentlySilent(messages);
    return true;
  }

  async findDeclarationForDuplicate(options: {
    agent?: AgentEntity | null;
    conversationId: MongoObjectId;
    userMessageId: MongoObjectId;
  }): Promise<MessageEntity | undefined> {
    if (!options.agent || options.agent.messengerOfAgentId) {
      return undefined;
    }

    const stored = await this.findState(options.agent);
    if (
      !stored?.state.declarationMessageId ||
      stored.state.triggerConversationId !==
        this.idOf(options.conversationId) ||
      stored.state.triggerMessageId !== this.idOf(options.userMessageId)
    ) {
      return undefined;
    }

    const declarationId = this.toObjectId(stored.state.declarationMessageId);
    if (!declarationId) {
      return undefined;
    }

    const declaration = await this.findVisibleMessageById(
      declarationId,
      options.conversationId
    );
    return declaration?.role === MessageRole.assistant
      ? declaration
      : undefined;
  }

  async assessAndActivate(options: {
    conversation: ConversationEntity;
    agent?: AgentEntity | null;
    currentUserMessage: MessageEntity;
  }): Promise<PermanentAgentSilenceActivation | undefined> {
    const { agent, conversation, currentUserMessage } = options;
    if (
      !agent ||
      agent.messengerOfAgentId ||
      currentUserMessage.type !== MessageType.text ||
      this.idOf(agent.createdUserId) !== this.idOf(conversation.userId)
    ) {
      return undefined;
    }

    const recentMessages = await this.messageModel.find({
      where: {
        conversationId: conversation.id,
        userId: conversation.userId,
        role: MessageRole.user,
        type: MessageType.text,
        status: MessageStatus.sent,
        isArchived: { $ne: true },
      } as never,
      order: {
        createdAt: 'DESC',
      },
      take: 6,
    });
    const assessment = assessPermanentAgentSilence(
      recentMessages
        .filter(
          message => this.idOf(message.id) !== this.idOf(currentUserMessage.id)
        )
        .slice(0, 5)
        .reverse()
        .map(message => message.content)
        .concat(currentUserMessage.content)
    );
    if (!assessment.shouldSilence) {
      return undefined;
    }

    const agentId = this.idOf(agent.id);
    const lock = await this.acquireLock(agentId);
    if (!lock.acquired) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (await this.findState(agent)) {
        await this.markMessagesPermanentlySilent([currentUserMessage]);
        return {};
      }

      this.logger.warn(
        '[permanent-agent-silence] activation deferred because lock is busy, agentId=%s',
        agentId
      );
      return undefined;
    }

    try {
      if (await this.findState(agent)) {
        await this.markMessagesPermanentlySilent([currentUserMessage]);
        return {};
      }

      const now = new Date();
      const state: PermanentAgentSilenceState = {
        version: 'permanent_agent_silence_v1',
        status: 'pending',
        reason: 'malicious_hateful_abuse',
        triggeredAt: now,
        triggerConversationId: this.idOf(conversation.id),
        triggerMessageId: this.idOf(currentUserMessage.id),
      };
      const stateMessage = this.buildStateMessage({
        conversation,
        agent,
        state,
        now,
      });
      await this.messageModel.save(stateMessage);
      await this.cacheState(agentId, true);

      await this.markMessagesPermanentlySilent([currentUserMessage]);
      const declarationTime = new Date(now.getTime() + 1);
      const declaration = new MessageEntity();
      declaration.conversationId = conversation.id;
      declaration.userId = conversation.userId;
      declaration.agentId = conversation.agentId;
      declaration.role = MessageRole.assistant;
      declaration.type = MessageType.text;
      declaration.content = getPermanentAgentSilenceDeclaration();
      declaration.status = MessageStatus.sent;
      declaration.quotaExempt = true;
      declaration.replyTrigger = false;
      declaration.replyGroupId = new MongoObjectId().toHexString();
      declaration.replySegmentIndex = 0;
      declaration.replyPlanningMode = 'permanent_agent_silence';
      declaration.replyPlanningReason = assessment.reason;
      declaration.createdAt = declarationTime;
      declaration.updatedAt = declarationTime;
      await this.messageModel.save(declaration);

      state.status = 'active';
      state.declarationMessageId = this.idOf(declaration.id);
      stateMessage.content = serializePermanentAgentSilenceState(state);
      stateMessage.updatedAt = declarationTime;
      await this.messageModel.save(stateMessage);
      conversation.updatedAt = declarationTime;
      await this.conversationModel.save(conversation);

      this.logger.warn(
        '[permanent-agent-silence] owner-created agent stopped after high-confidence malicious abuse, agentId=%s, conversationId=%s, assessment=%s, evidenceTurns=%s/%s',
        agentId,
        this.idOf(conversation.id),
        assessment.reason || 'unknown',
        assessment.maliciousTurnCount,
        assessment.assessedTurnCount
      );
      return { declaration };
    } finally {
      await this.releaseLock(agentId, lock.token);
    }
  }

  async markMessagesPermanentlySilent(
    messages: MessageEntity[]
  ): Promise<void> {
    for (const message of messages) {
      message.quotaExempt = true;
      message.replyTrigger = false;
      message.replyPlanningMode = 'permanent_agent_silence';
      message.replyPlanningReason = 'agent_permanently_silent';
      await this.messageModel.updateOne({ _id: message.id }, {
        $set: {
          quotaExempt: true,
          replyTrigger: false,
          replyPlanningMode: message.replyPlanningMode,
          replyPlanningReason: message.replyPlanningReason,
        },
      } as never);
    }
  }

  private buildStateMessage(options: {
    conversation: ConversationEntity;
    agent: AgentEntity;
    state: PermanentAgentSilenceState;
    now: Date;
  }): MessageEntity {
    const message = new MessageEntity();
    message.conversationId = options.conversation.id;
    message.userId = options.agent.createdUserId;
    message.agentId = options.agent.id;
    message.role = MessageRole.system;
    message.type = MessageType.text;
    message.content = serializePermanentAgentSilenceState(options.state);
    message.status = MessageStatus.sent;
    message.quotaExempt = true;
    message.replyTrigger = false;
    message.isArchived = true;
    message.archivedAt = options.now;
    message.createdAt = options.now;
    message.updatedAt = options.now;
    return message;
  }

  private async findState(
    agent: AgentEntity
  ): Promise<
    { message: MessageEntity; state: PermanentAgentSilenceState } | undefined
  > {
    const candidates = await this.messageModel.find({
      where: {
        agentId: agent.id,
        userId: agent.createdUserId,
        role: MessageRole.system,
        isArchived: true,
      } as never,
      order: {
        createdAt: 'DESC',
      },
      take: 40,
    });

    for (const message of candidates) {
      const state = parsePermanentAgentSilenceState(message.content);
      if (state) return { message, state };
    }
    return undefined;
  }

  private async findVisibleMessageById(
    messageId: MongoObjectId,
    conversationId: MongoObjectId
  ): Promise<MessageEntity | null> {
    const byId = await this.messageModel.findOne({
      where: {
        id: messageId,
        conversationId,
        isArchived: { $ne: true },
      } as never,
    });
    if (byId) return byId;

    return this.messageModel.findOne({
      where: {
        _id: messageId,
        conversationId,
        isArchived: { $ne: true },
      } as never,
    });
  }

  private async cacheState(agentId: string, active: boolean): Promise<void> {
    try {
      await this.redisService?.set(
        this.stateCacheKey(agentId),
        active ? 'active' : 'none',
        'EX',
        active ? ACTIVE_CACHE_TTL_SECONDS : NEGATIVE_CACHE_TTL_SECONDS
      );
    } catch (error) {
      this.logger.warn(
        '[permanent-agent-silence] cache write failed, agentId=%s, reason=%s',
        agentId,
        this.describeError(error)
      );
    }
  }

  private async acquireLock(
    agentId: string
  ): Promise<{ acquired: boolean; token: string }> {
    const token = `${Date.now()}:${Math.random().toString(16).slice(2)}`;
    if (!this.redisService) {
      return { acquired: true, token };
    }

    const result = await this.redisService.set(
      this.lockKey(agentId),
      token,
      'PX',
      ACTIVATION_LOCK_TTL_MS,
      'NX'
    );
    return { acquired: result === 'OK', token };
  }

  private async releaseLock(agentId: string, token: string): Promise<void> {
    if (!this.redisService) return;

    const key = this.lockKey(agentId);
    if ((await this.redisService.get(key)) === token) {
      await this.redisService.del(key);
    }
  }

  private stateCacheKey(agentId: string): string {
    return `agent:permanent-silence:state:${agentId}`;
  }

  private lockKey(agentId: string): string {
    return `agent:permanent-silence:lock:${agentId}`;
  }

  private idOf(value: MongoObjectId): string {
    return value?.toHexString?.() || String(value || '');
  }

  private toObjectId(value?: string): MongoObjectId | undefined {
    const normalized = value?.trim() || '';
    return normalized && MongoObjectId.isValid(normalized)
      ? new MongoObjectId(normalized)
      : undefined;
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
