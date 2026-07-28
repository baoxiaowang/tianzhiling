import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentRelationshipSignalAssertionPolicy,
  AgentRelationshipSignalEntity,
  AgentRelationshipSignalStatus,
  AgentRelationshipSignalSubject,
  AgentRelationshipSignalTopic,
  AgentRelationshipSignalType,
  MessageEntity,
  MongoObjectId,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import type { StructuredReplyIntent } from './reply-intent';

export interface AgentRelationshipSignalSummary {
  key: string;
  signalType: AgentRelationshipSignalType;
  topic: AgentRelationshipSignalTopic;
  subject: AgentRelationshipSignalSubject;
  confidence: number;
  supportCount: number;
  status: AgentRelationshipSignalStatus;
  assertionPolicy: AgentRelationshipSignalAssertionPolicy;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

interface RelationshipSignalCandidate {
  signalType: AgentRelationshipSignalType;
  topic: AgentRelationshipSignalTopic;
  subject: AgentRelationshipSignalSubject;
  confidence: number;
  assertionPolicy: AgentRelationshipSignalAssertionPolicy;
}

interface UpsertFromUserMessageOptions {
  message: MessageEntity;
  intent?: StructuredReplyIntent;
}

interface ListRelationshipSignalsOptions {
  userId: MongoObjectId;
  agentId: MongoObjectId;
  limit?: number;
}

const DEFAULT_SIGNAL_LIMIT = 8;
const MAX_SOURCE_MESSAGE_IDS = 8;

@Provide()
export class AgentRelationshipSignalService {
  @InjectEntityModel(AgentRelationshipSignalEntity)
  signalModel: MongoRepository<AgentRelationshipSignalEntity>;

  deriveFromIntent(
    intent?: StructuredReplyIntent
  ): RelationshipSignalCandidate[] {
    if (
      !intent ||
      !['concern', 'sadness', 'fear', 'longing', 'attachment'].includes(
        intent.emotion
      )
    ) {
      return [];
    }

    const concernsPhysicalSuffering = intent.intents.some(
      item =>
        (item.intent === 'ask_agent_status' &&
          item.target === 'agent' &&
          item.timeScope === 'current' &&
          item.subIntent === 'physical_pain') ||
        (item.intent === 'question_departure' &&
          item.target === 'agent' &&
          item.subIntent === 'death_pain')
    );

    if (!concernsPhysicalSuffering) {
      return [];
    }

    return [
      {
        signalType: AgentRelationshipSignalType.concern,
        topic: AgentRelationshipSignalTopic.agentPhysicalSuffering,
        subject: AgentRelationshipSignalSubject.agent,
        confidence: this.normalizeConfidence(intent.confidence),
        assertionPolicy: AgentRelationshipSignalAssertionPolicy.userStateOnly,
      },
    ];
  }

  async upsertFromUserMessage(
    options: UpsertFromUserMessageOptions
  ): Promise<AgentRelationshipSignalSummary[]> {
    const candidates = this.deriveFromIntent(options.intent);
    const result: AgentRelationshipSignalSummary[] = [];

    for (const candidate of candidates) {
      result.push(
        await this.upsertSignal({
          ...candidate,
          userId: options.message.userId,
          agentId: options.message.agentId,
          sourceMessageId: options.message.id,
        })
      );
    }

    return result;
  }

  async listSignals(
    options: ListRelationshipSignalsOptions
  ): Promise<AgentRelationshipSignalSummary[]> {
    const signals = await this.signalModel.find({
      where: {
        userId: options.userId,
        agentId: options.agentId,
        status: AgentRelationshipSignalStatus.active,
      },
      order: {
        supportCount: 'DESC',
        lastSeenAt: 'DESC',
      },
      take: this.normalizeLimit(options.limit),
    });

    return signals.map(signal => this.buildSummary(signal));
  }

  selectRelevantSignals(
    signals: AgentRelationshipSignalSummary[],
    intent?: StructuredReplyIntent
  ): AgentRelationshipSignalSummary[] {
    if (!this.isPhysicalSufferingTopic(intent)) {
      return [];
    }

    return signals
      .filter(
        signal =>
          signal.status === AgentRelationshipSignalStatus.active &&
          signal.topic ===
            AgentRelationshipSignalTopic.agentPhysicalSuffering &&
          signal.assertionPolicy ===
            AgentRelationshipSignalAssertionPolicy.userStateOnly
      )
      .slice(0, 1);
  }

  private async upsertSignal(
    input: RelationshipSignalCandidate & {
      userId: MongoObjectId;
      agentId: MongoObjectId;
      sourceMessageId: MongoObjectId;
    }
  ): Promise<AgentRelationshipSignalSummary> {
    const now = new Date();
    const existing = await this.signalModel.findOne({
      where: {
        userId: input.userId,
        agentId: input.agentId,
        signalType: input.signalType,
        topic: input.topic,
      },
    });
    const signal = existing ?? new AgentRelationshipSignalEntity();
    const sourceMessageIds = existing?.sourceMessageIds || [];
    const alreadySupported = sourceMessageIds.some(id =>
      id.equals(input.sourceMessageId)
    );

    signal.userId = input.userId;
    signal.agentId = input.agentId;
    signal.signalType = input.signalType;
    signal.topic = input.topic;
    signal.subject = input.subject;
    signal.confidence = Math.max(
      this.normalizeConfidence(existing?.confidence),
      input.confidence
    );
    signal.supportCount = Math.max(
      1,
      Number(existing?.supportCount || 0) + (alreadySupported ? 0 : 1)
    );
    signal.sourceMessageIds = alreadySupported
      ? sourceMessageIds
      : [...sourceMessageIds, input.sourceMessageId].slice(
          -MAX_SOURCE_MESSAGE_IDS
        );
    signal.status = AgentRelationshipSignalStatus.active;
    signal.assertionPolicy = input.assertionPolicy;
    signal.firstSeenAt = existing?.firstSeenAt ?? now;
    signal.lastSeenAt = alreadySupported ? existing?.lastSeenAt ?? now : now;
    signal.createdAt = existing?.createdAt ?? now;
    signal.updatedAt = now;

    await this.signalModel.save(signal);

    return this.buildSummary(signal);
  }

  private isPhysicalSufferingTopic(intent?: StructuredReplyIntent): boolean {
    return Boolean(
      intent?.intents.some(
        item =>
          (item.intent === 'ask_agent_status' &&
            item.target === 'agent' &&
            item.subIntent === 'physical_pain') ||
          (item.intent === 'question_departure' &&
            item.target === 'agent' &&
            item.subIntent === 'death_pain')
      )
    );
  }

  private buildSummary(
    signal: AgentRelationshipSignalEntity
  ): AgentRelationshipSignalSummary {
    return {
      key: `${signal.signalType}.${signal.topic}`,
      signalType: signal.signalType,
      topic: signal.topic,
      subject: signal.subject,
      confidence: this.normalizeConfidence(signal.confidence),
      supportCount: Math.max(1, Number(signal.supportCount || 1)),
      status: signal.status,
      assertionPolicy: signal.assertionPolicy,
      firstSeenAt: signal.firstSeenAt,
      lastSeenAt: signal.lastSeenAt,
    };
  }

  private normalizeConfidence(value?: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0;
  }

  private normalizeLimit(value?: number): number {
    if (!Number.isFinite(value)) {
      return DEFAULT_SIGNAL_LIMIT;
    }

    return Math.max(1, Math.min(20, Math.floor(value!)));
  }
}
