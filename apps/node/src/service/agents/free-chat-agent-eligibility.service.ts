import { Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  FREE_CHAT_AGENT_LEDGER_POLICY_VERSION,
  FreeChatAgentLedgerEntity,
  FreeChatAgentSlot,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

export const FREE_CHAT_AGENT_LIMIT = 3;

const SLOT_WRITE_MAX_ATTEMPTS = 8;

@Provide()
export class FreeChatAgentEligibilityService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(FreeChatAgentLedgerEntity)
  ledgerModel: MongoRepository<FreeChatAgentLedgerEntity>;

  async isEligible(agent: AgentEntity | null): Promise<boolean> {
    if (!agent) {
      throw new Error('agent is missing');
    }

    // 小使者由系统创建，使用独立的无限额度通道，不占真实亲友名额。
    if (agent.messengerOfAgentId) {
      return true;
    }

    const ownerUserId = this.asObjectId(agent.createdUserId);
    if (!ownerUserId) {
      throw new Error('agent owner is missing');
    }
    const candidateSlot = this.buildAgentSlot(agent);

    try {
      const slots = await this.ensureSlots(ownerUserId, candidateSlot);
      return slots.some(slot =>
        this.sameId(slot.agentId, candidateSlot.agentId)
      );
    } catch (error) {
      this.logger?.error?.(
        '[chat-quota] failed to resolve durable free-chat agent slots: %s',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Called after a real agent is persisted so its successful registration can
   * occupy a slot before deletion or later chat traffic changes the visible
   * agent set. Concurrent registrations converge through the owner ledger CAS.
   */
  async recordCreatedAgent(agent: AgentEntity): Promise<void> {
    if (!agent || agent.messengerOfAgentId) {
      return;
    }

    const ownerUserId = this.asObjectId(agent.createdUserId);
    if (!ownerUserId) {
      throw new Error('agent owner is missing');
    }

    await this.ensureSlots(ownerUserId, this.buildAgentSlot(agent));
  }

  /**
   * Historical users are initialized lazily. Persist their current first
   * three slots before any destructive delete so a later agent cannot be
   * promoted simply because an earlier record disappeared.
   */
  async preserveSlotsBeforeDeletion(agent: AgentEntity): Promise<void> {
    await this.recordCreatedAgent(agent);
  }

  private async ensureSlots(
    ownerUserId: MongoObjectId,
    candidateSlot?: FreeChatAgentSlot
  ): Promise<FreeChatAgentSlot[]> {
    for (let attempt = 0; attempt < SLOT_WRITE_MAX_ATTEMPTS; attempt += 1) {
      const ledger = await this.findLedger(ownerUserId);
      const existingSlots = ledger
        ? this.readLedgerSlots(ledger, ownerUserId)
        : [];
      let nextSlots = this.mergeSlots(
        existingSlots,
        candidateSlot ? [candidateSlot] : []
      ).slice(0, FREE_CHAT_AGENT_LIMIT);

      // Always merge the currently earliest real agents. This repairs a saved
      // agent whose post-create ledger registration failed, even when another
      // concurrent request already filled all three slots. Deleted slot records
      // remain in existingSlots, so this scan cannot promote a later agent.
      const earliestAgentSlots = await this.listEarliestRealAgentSlots(
        ownerUserId
      );
      nextSlots = this.mergeSlots(nextSlots, earliestAgentSlots).slice(
        0,
        FREE_CHAT_AGENT_LIMIT
      );

      if (ledger && this.sameSlotList(existingSlots, nextSlots)) {
        return existingSlots;
      }

      const now = new Date();
      if (ledger) {
        await this.ledgerModel.findOneAndUpdate(
          {
            _id: ownerUserId,
            slots: ledger.slots,
            policyVersion: FREE_CHAT_AGENT_LEDGER_POLICY_VERSION,
          },
          {
            $set: {
              slots: nextSlots,
              updatedAt: now,
            },
          },
          { returnDocument: 'after' }
        );
      } else {
        await this.ledgerModel.findOneAndUpdate(
          { _id: ownerUserId },
          {
            $setOnInsert: {
              userId: ownerUserId,
              slots: nextSlots,
              policyVersion: FREE_CHAT_AGENT_LEDGER_POLICY_VERSION,
              createdAt: now,
              updatedAt: now,
            },
          },
          { returnDocument: 'after', upsert: true }
        );
      }

      // Independent readback is the durable commit check. Do not let the
      // mutating call certify its own write.
      const persistedLedger = await this.findLedger(ownerUserId);
      const persistedSlots = persistedLedger
        ? this.readLedgerSlots(persistedLedger, ownerUserId)
        : [];
      if (this.sameSlotList(persistedSlots, nextSlots)) {
        return persistedSlots;
      }
    }

    throw new Error('free-chat agent slots changed concurrently');
  }

  private findLedger(
    userId: MongoObjectId
  ): Promise<FreeChatAgentLedgerEntity | null> {
    return this.ledgerModel.findOne({
      where: { _id: userId },
    } as never);
  }

  private async listEarliestRealAgentSlots(
    ownerUserId: MongoObjectId
  ): Promise<FreeChatAgentSlot[]> {
    const rows = await this.agentModel
      .aggregate<{ _id: MongoObjectId; createdAt: Date }>([
        {
          $match: {
            createdUserId: ownerUserId,
            $or: [
              { messengerOfAgentId: { $exists: false } },
              { messengerOfAgentId: null },
            ],
          },
        },
        { $sort: { createdAt: 1, _id: 1 } },
        { $limit: FREE_CHAT_AGENT_LIMIT },
        { $project: { _id: 1, createdAt: 1 } },
      ])
      .toArray();

    return rows.map(row => {
      const agentId = this.asObjectId(row._id);
      const createdAt = this.asDate(row.createdAt);
      if (!agentId || !createdAt) {
        throw new Error('agent slot query result is malformed');
      }
      return { agentId, createdAt };
    });
  }

  private readLedgerSlots(
    ledger: FreeChatAgentLedgerEntity,
    ownerUserId: MongoObjectId
  ): FreeChatAgentSlot[] {
    if (
      ledger.policyVersion !== FREE_CHAT_AGENT_LEDGER_POLICY_VERSION ||
      !this.sameOptionalId(ledger.userId, ownerUserId)
    ) {
      throw new Error('free-chat agent slot ledger metadata is malformed');
    }
    return this.normalizeSlots(ledger.slots);
  }

  private normalizeSlots(value: unknown): FreeChatAgentSlot[] {
    if (!Array.isArray(value) || value.length > FREE_CHAT_AGENT_LIMIT) {
      throw new Error('free-chat agent slot ledger is malformed');
    }

    const slots: FreeChatAgentSlot[] = [];
    const seen = new Set<string>();
    for (const valueItem of value) {
      const record = valueItem as Partial<FreeChatAgentSlot> | null;
      const agentId = this.asObjectId(record?.agentId);
      const createdAt = this.asDate(record?.createdAt);
      if (!agentId || !createdAt || seen.has(agentId.toHexString())) {
        throw new Error('free-chat agent slot ledger is malformed');
      }
      seen.add(agentId.toHexString());
      slots.push({ agentId, createdAt });
    }

    const sortedSlots = this.sortSlots(slots);
    if (!this.sameSlotList(slots, sortedSlots)) {
      throw new Error('free-chat agent slot ledger is malformed');
    }
    return slots;
  }

  private mergeSlots(
    existing: FreeChatAgentSlot[],
    candidates: FreeChatAgentSlot[]
  ): FreeChatAgentSlot[] {
    const slotsById = new Map<string, FreeChatAgentSlot>();

    for (const value of [...existing, ...candidates]) {
      const agentId = this.asObjectId(value?.agentId);
      const createdAt = this.asDate(value?.createdAt);
      if (!agentId || !createdAt) {
        throw new Error('free-chat agent slot is malformed');
      }
      const key = agentId.toHexString();
      const current = slotsById.get(key);
      if (!current || createdAt.getTime() < current.createdAt.getTime()) {
        slotsById.set(key, { agentId, createdAt });
      }
    }

    return this.sortSlots([...slotsById.values()]);
  }

  private sortSlots(slots: FreeChatAgentSlot[]): FreeChatAgentSlot[] {
    return [...slots].sort((left, right) => {
      const timeDifference =
        left.createdAt.getTime() - right.createdAt.getTime();
      return (
        timeDifference ||
        left.agentId.toHexString().localeCompare(right.agentId.toHexString())
      );
    });
  }

  private sameSlotList(
    left: FreeChatAgentSlot[],
    right: FreeChatAgentSlot[]
  ): boolean {
    return (
      left.length === right.length &&
      left.every(
        (value, index) =>
          this.sameId(value.agentId, right[index].agentId) &&
          value.createdAt.getTime() === right[index].createdAt.getTime()
      )
    );
  }

  private buildAgentSlot(agent: AgentEntity): FreeChatAgentSlot {
    const agentId = this.asObjectId(agent.id);
    const createdAt = this.asDate(agent.createdAt);
    if (!agentId || !createdAt) {
      throw new Error('agent id or createdAt is missing');
    }
    return { agentId, createdAt };
  }

  private sameId(left: MongoObjectId, right: MongoObjectId): boolean {
    return left.toHexString() === right.toHexString();
  }

  private sameOptionalId(left: unknown, right: MongoObjectId): boolean {
    const leftId = this.asObjectId(left);
    return Boolean(leftId && this.sameId(leftId, right));
  }

  private asObjectId(value: unknown): MongoObjectId | undefined {
    const raw =
      typeof value === 'string'
        ? value
        : typeof (value as { toHexString?: unknown })?.toHexString ===
          'function'
        ? (value as { toHexString(): string }).toHexString()
        : '';
    if (!MongoObjectId.isValid(raw)) {
      return undefined;
    }
    return new MongoObjectId(raw);
  }

  private asDate(value: unknown): Date | undefined {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      return undefined;
    }
    return new Date(value.getTime());
  }
}
