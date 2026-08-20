import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  AgentProfileFactConfidence,
  AgentProfileFactEntity,
  AgentProfileFactStatus,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

const JOB_ID = 'agent-memory-inheritance-backfill-20260820-v1';
const WINDOW_DAYS = 90;
const PROFILE_FIELDS = [
  'lifeExperience',
  'personalityTraits',
  'languageHabits',
  'hobbies',
  'sharedMemories',
] as const;

export interface AgentMemoryInheritanceSummary {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'unknown';
  eligibleUserCount?: number;
  matchedGroupCount?: number;
  updatedAgentCount?: number;
  copiedProfileFieldCount?: number;
  copiedFactCount?: number;
  skippedConflictCount?: number;
  completedAt?: string;
}

@Provide()
export class AgentMemoryInheritanceService {
  @Logger() logger: ILogger;
  @InjectEntityModel(AgentEntity) agentModel: MongoRepository<AgentEntity>;
  @InjectEntityModel(AgentProfileFactEntity)
  factModel: MongoRepository<AgentProfileFactEntity>;
  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;
  @Inject() redisService: RedisService;

  async inheritForNewAgent(agent: AgentEntity): Promise<void> {
    const candidates = await this.agentModel.find({
      where: {
        createdUserId: agent.createdUserId,
        messengerOfAgentId: { $exists: false },
        status: 1,
      } as never,
      order: { updatedAt: 'DESC' },
    });
    const sources = candidates.filter(
      candidate =>
        this.id(candidate.id) !== this.id(agent.id) &&
        this.identityKey(candidate) === this.identityKey(agent)
    );
    if (!sources.length) return;
    await this.inheritInto(agent, sources, true);
  }

  async runProductionBackfillOnce(now = new Date()): Promise<void> {
    if (process.env.NODE_ENV !== 'production' || !this.redisService) return;
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Asia/Shanghai',
      }).format(now)
    );
    if (hour < 3 || hour >= 7) return;
    const completedKey = `chat:${JOB_ID}:completed`;
    const lockKey = `chat:${JOB_ID}:lock`;
    if (await this.redisService.get(completedKey)) return;
    const token = `${process.pid}:${now.getTime()}`;
    if (
      (await this.redisService.set(
        lockKey,
        token,
        'PX',
        4 * 60 * 60 * 1000,
        'NX'
      )) !== 'OK'
    )
      return;
    try {
      const cutoff = new Date(now.getTime() - WINDOW_DAYS * 86400000);
      const activeRows = await (this.messageModel as any)
        .aggregate([
          {
            $match: {
              role: MessageRole.user,
              status: MessageStatus.sent,
              isArchived: { $ne: true },
              createdAt: { $gte: cutoff },
            },
          },
          { $group: { _id: '$userId' } },
        ])
        .toArray();
      const userIds = new Map<string, MongoObjectId>();
      for (const row of activeRows) {
        if (row?._id) userIds.set(this.id(row._id), row._id);
      }
      const summary: AgentMemoryInheritanceSummary = {
        jobId: JOB_ID,
        status: 'running',
        eligibleUserCount: userIds.size,
        matchedGroupCount: 0,
        updatedAgentCount: 0,
        copiedProfileFieldCount: 0,
        copiedFactCount: 0,
        skippedConflictCount: 0,
      };
      for (const userId of userIds.values()) {
        const agents = await this.agentModel.find({
          where: {
            createdUserId: userId,
            messengerOfAgentId: { $exists: false },
            status: 1,
          } as never,
          order: { createdAt: 'DESC' },
        });
        const groups = new Map<string, AgentEntity[]>();
        for (const agent of agents) {
          const key = this.identityKey(agent);
          if (!key) continue;
          groups.set(key, [...(groups.get(key) || []), agent]);
        }
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          summary.matchedGroupCount! += 1;
          const [target, ...sources] = group.sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.updatedAt.getTime() - a.updatedAt.getTime()
          );
          const result = await this.inheritInto(target, sources, true);
          summary.updatedAgentCount! += result.updated ? 1 : 0;
          summary.copiedProfileFieldCount! += result.profileFields;
          summary.copiedFactCount! += result.facts;
          summary.skippedConflictCount! += result.conflicts;
        }
      }
      summary.status = 'completed';
      summary.completedAt = new Date().toISOString();
      await this.redisService.set(completedKey, JSON.stringify(summary));
      this.logger.info('[memory-inheritance] completed summary=%j', summary);
    } catch (error) {
      this.logger.error(
        '[memory-inheritance] failed reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    } finally {
      if ((await this.redisService.get(lockKey)) === token) {
        await this.redisService.del(lockKey);
      }
    }
  }

  async getStatus(): Promise<AgentMemoryInheritanceSummary> {
    if (!this.redisService) return { jobId: JOB_ID, status: 'unknown' };
    const completed = await this.redisService.get(`chat:${JOB_ID}:completed`);
    if (completed) return JSON.parse(completed);
    const running = await this.redisService.get(`chat:${JOB_ID}:lock`);
    return { jobId: JOB_ID, status: running ? 'running' : 'pending' };
  }

  private async inheritInto(
    target: AgentEntity,
    sources: AgentEntity[],
    persist: boolean
  ): Promise<{
    updated: boolean;
    profileFields: number;
    facts: number;
    conflicts: number;
  }> {
    let profileFields = 0;
    for (const field of PROFILE_FIELDS) {
      if (target[field]?.trim()) continue;
      const values = [
        ...new Set(sources.map(item => item[field]?.trim()).filter(Boolean)),
      ];
      if (values.length === 1) {
        target[field] = values[0];
        profileFields += 1;
      }
    }
    const sourceIds = sources.map(item => item.id);
    const sourceFacts = await this.factModel.find({
      where: {
        userId: target.createdUserId,
        agentId: { $in: sourceIds },
        status: AgentProfileFactStatus.active,
      } as never,
      order: { updatedAt: 'DESC' },
    });
    const byKey = new Map<string, AgentProfileFactEntity[]>();
    for (const fact of sourceFacts) {
      if (fact.conflictingValues?.length) continue;
      byKey.set(fact.key, [...(byKey.get(fact.key) || []), fact]);
    }
    let copiedFacts = 0;
    let conflicts = 0;
    for (const [key, facts] of byKey) {
      const values = [...new Set(facts.map(fact => fact.value.trim()))];
      if (values.length !== 1) {
        conflicts += 1;
        continue;
      }
      const source = facts[0];
      if (!(await this.hasTrustedUserSource(source))) continue;
      const existing = await this.factModel.findOne({
        where: { userId: target.createdUserId, agentId: target.id, key },
      });
      if (existing) continue;
      if (persist) {
        const copy = new AgentProfileFactEntity();
        Object.assign(copy, {
          userId: target.createdUserId,
          agentId: target.id,
          type: source.type,
          key: source.key,
          value: source.value,
          polarity: source.polarity,
          confidence: source.confidence,
          status: AgentProfileFactStatus.active,
          priority: source.priority,
          sourceMessageId: source.sourceMessageId,
          sourceMessageIds: source.sourceMessageIds,
          sourceText: source.sourceText,
          supportCount: source.supportCount,
          assertionPolicy: source.assertionPolicy,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        await this.factModel.save(copy);
      }
      copiedFacts += 1;
    }
    if (persist && profileFields) {
      target.updatedAt = new Date();
      await this.agentModel.save(target);
    }
    return {
      updated: profileFields > 0 || copiedFacts > 0,
      profileFields,
      facts: copiedFacts,
      conflicts,
    };
  }

  private async hasTrustedUserSource(
    fact: AgentProfileFactEntity
  ): Promise<boolean> {
    if (!fact.sourceMessageId) {
      return (
        fact.confidence === AgentProfileFactConfidence.confirmed &&
        Boolean(fact.sourceText?.trim())
      );
    }
    const message = await this.messageModel.findOne({
      where: { id: fact.sourceMessageId },
    });
    return message?.role === MessageRole.user;
  }

  private identityKey(agent: AgentEntity): string {
    const nickname = this.normalizeKinName(agent.name);
    const relationship = this.normalizeKinName(agent.iCallAgent || '');
    return nickname && relationship ? `${nickname}|${relationship}` : '';
  }

  private normalizeKinName(value: string): string {
    const text = value
      .trim()
      .toLowerCase()
      .replace(/[\s·・]/gu, '');
    const aliases: Record<string, string> = {
      爸: '爸爸',
      爸爸: '爸爸',
      爸比: '爸爸',
      爹: '爸爸',
      爹爹: '爸爸',
      父亲: '爸爸',
      妈: '妈妈',
      妈妈: '妈妈',
      妈咪: '妈妈',
      娘: '妈妈',
      母亲: '妈妈',
      奶奶: '奶奶',
      祖母: '奶奶',
      爷爷: '爷爷',
      祖父: '爷爷',
      姥姥: '姥姥',
      外婆: '姥姥',
      姥爷: '姥爷',
      外公: '姥爷',
      老公: '丈夫',
      丈夫: '丈夫',
      爱人: '爱人',
      老婆: '妻子',
      妻子: '妻子',
    };
    return aliases[text] || text;
  }

  private id(value: MongoObjectId): string {
    return value?.toString?.() || String(value);
  }
}
