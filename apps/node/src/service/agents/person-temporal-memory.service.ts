import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  MessageEntity,
  MongoObjectId,
  PERSON_TEMPORAL_PROFILE_VERSION,
  PersonTemporalAssertionEntity,
  PersonTemporalAssertionStatus,
  PersonTemporalConflictStatus,
  PersonTemporalEventType,
  PersonTemporalPrecision,
  PersonTemporalProfileEntity,
  PersonTemporalResolutionCertainty,
  PersonTemporalSubjectType,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  ParsedDepartureTimeAssertion,
  parseAgentDepartureTime,
} from './person-temporal-memory';

export interface RecordAgentDepartureTimeOptions {
  message: MessageEntity;
  searchableText: string;
  implicitCurrentAgent?: boolean;
}

export interface RecordAgentDepartureTimeResult {
  assertion: PersonTemporalAssertionEntity;
  profile: PersonTemporalProfileEntity;
  projectionUpdated: boolean;
}

@Provide()
export class PersonTemporalMemoryService {
  @InjectEntityModel(PersonTemporalAssertionEntity)
  assertionModel: MongoRepository<PersonTemporalAssertionEntity>;

  @InjectEntityModel(PersonTemporalProfileEntity)
  profileModel: MongoRepository<PersonTemporalProfileEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  async recordAgentDepartureFromMessage(
    options: RecordAgentDepartureTimeOptions
  ): Promise<RecordAgentDepartureTimeResult | null> {
    const parsed = parseAgentDepartureTime({
      text: options.searchableText,
      referenceAt: options.message.createdAt,
      implicitCurrentAgent: options.implicitCurrentAgent,
    });
    if (!parsed) return null;

    const semanticKey = this.buildSemanticKey(parsed);
    let assertion = await this.assertionModel.findOne({
      where: {
        userId: options.message.userId,
        sourceMessageId: options.message.id,
        semanticKey,
      },
    });
    const now = new Date();
    if (!assertion) {
      assertion = new PersonTemporalAssertionEntity();
      Object.assign(assertion, {
        userId: options.message.userId,
        subjectType: PersonTemporalSubjectType.agent,
        subjectId: options.message.agentId,
        eventType: PersonTemporalEventType.death,
        expressionKind: parsed.expressionKind,
        calendar: parsed.calendar,
        rawText: options.searchableText.trim().slice(0, 500),
        referenceAt: options.message.createdAt,
        numericValue: parsed.numericValue,
        durationUnit: parsed.durationUnit,
        approximate: parsed.approximate,
        isCorrection: parsed.isCorrection,
        ritual: parsed.ritual,
        ritualNominalDay: parsed.ritualNominalDay,
        normalizedExactDate: parsed.normalizedExactDate,
        normalizedStart: parsed.normalizedStart,
        normalizedEnd: parsed.normalizedEnd,
        normalizedYear: parsed.normalizedYear,
        normalizedMonth: parsed.normalizedMonth,
        normalizedDay: parsed.normalizedDay,
        precision: parsed.precision,
        confidence: parsed.confidence,
        resolutionCertainty: parsed.resolutionCertainty,
        status: PersonTemporalAssertionStatus.active,
        semanticKey,
        derivationRule: parsed.derivationRule,
        sourceAgentId: options.message.agentId,
        sourceMessageId: options.message.id,
        createdAt: now,
        updatedAt: now,
      });
      try {
        await this.assertionModel.save(assertion);
      } catch (error) {
        const concurrentlyCreated = await this.assertionModel.findOne({
          where: {
            userId: options.message.userId,
            sourceMessageId: options.message.id,
            semanticKey,
          },
        });
        if (!concurrentlyCreated) throw error;
        assertion = concurrentlyCreated;
      }
    }

    const ownedAgent = await this.agentModel.findOne({
      where: {
        _id: options.message.agentId,
        createdUserId: options.message.userId,
      } as never,
    });
    const profile = await this.getOrCreateProfile({
      userId: options.message.userId,
      subjectId: options.message.agentId,
      legacyExactDate: ownedAgent?.deathDate,
    });
    const resolution = await this.applyAssertionToProfile({
      assertion,
      parsed,
      profile,
      legacyExactDate: ownedAgent?.deathDate,
    });
    let projectionUpdated = false;
    if (
      ownedAgent &&
      resolution.selectedExactDate &&
      (!ownedAgent.deathDate ||
        parsed.isCorrection ||
        this.sameDate(ownedAgent.deathDate, resolution.selectedExactDate))
    ) {
      if (!this.sameDate(ownedAgent.deathDate, resolution.selectedExactDate)) {
        ownedAgent.deathDate = resolution.selectedExactDate;
        ownedAgent.updatedAt = now;
        await this.agentModel.save(ownedAgent);
        projectionUpdated = true;
      }
    }

    return { assertion, profile, projectionUpdated };
  }

  private async getOrCreateProfile(options: {
    userId: MongoObjectId;
    subjectId: MongoObjectId;
    legacyExactDate?: Date;
  }): Promise<PersonTemporalProfileEntity> {
    const existing = await this.profileModel.findOne({
      where: {
        userId: options.userId,
        subjectType: PersonTemporalSubjectType.agent,
        subjectId: options.subjectId,
        eventType: PersonTemporalEventType.death,
      },
    });
    if (existing) return existing;

    const now = new Date();
    const profile = new PersonTemporalProfileEntity();
    Object.assign(profile, {
      userId: options.userId,
      subjectType: PersonTemporalSubjectType.agent,
      subjectId: options.subjectId,
      eventType: PersonTemporalEventType.death,
      ...(options.legacyExactDate
        ? {
            exactDate: options.legacyExactDate,
            estimatedStart: options.legacyExactDate,
            estimatedEnd: options.legacyExactDate,
            normalizedYear: options.legacyExactDate.getUTCFullYear(),
            normalizedMonth: options.legacyExactDate.getUTCMonth() + 1,
            normalizedDay: options.legacyExactDate.getUTCDate(),
          }
        : {}),
      precision: options.legacyExactDate
        ? PersonTemporalPrecision.exactDay
        : PersonTemporalPrecision.unknown,
      calendar: options.legacyExactDate ? 'gregorian' : 'unknown',
      resolutionCertainty: options.legacyExactDate
        ? PersonTemporalResolutionCertainty.explicitExact
        : PersonTemporalResolutionCertainty.unresolved,
      conflictStatus: PersonTemporalConflictStatus.none,
      version: PERSON_TEMPORAL_PROFILE_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await this.profileModel.save(profile);
      return profile;
    } catch (error) {
      const concurrentlyCreated = await this.profileModel.findOne({
        where: {
          userId: options.userId,
          subjectType: PersonTemporalSubjectType.agent,
          subjectId: options.subjectId,
          eventType: PersonTemporalEventType.death,
        },
      });
      if (concurrentlyCreated) return concurrentlyCreated;
      throw error;
    }
  }

  private async applyAssertionToProfile(options: {
    assertion: PersonTemporalAssertionEntity;
    parsed: ParsedDepartureTimeAssertion;
    profile: PersonTemporalProfileEntity;
    legacyExactDate?: Date;
  }): Promise<{
    selectedExactDate?: Date;
  }> {
    const { assertion, parsed, profile } = options;
    const existingExactDate = profile.exactDate || options.legacyExactDate;
    if (
      parsed.normalizedExactDate &&
      existingExactDate &&
      !this.sameDate(parsed.normalizedExactDate, existingExactDate)
    ) {
      if (!parsed.isCorrection) {
        assertion.status = PersonTemporalAssertionStatus.conflicted;
        assertion.updatedAt = new Date();
        await this.assertionModel.save(assertion);
        profile.conflictStatus = PersonTemporalConflictStatus.conflicted;
        profile.updatedAt = new Date();
        await this.profileModel.save(profile);
        return {};
      }
      await this.supersedePriorExactAssertions(assertion);
    }

    const currentScore = this.precisionScore(profile.precision);
    const nextScore = this.precisionScore(parsed.precision);
    const shouldSelect =
      (parsed.isCorrection && Boolean(parsed.normalizedExactDate)) ||
      currentScore === 0 ||
      nextScore > currentScore ||
      (nextScore === currentScore &&
        parsed.normalizedExactDate !== undefined &&
        (!existingExactDate ||
          this.sameDate(parsed.normalizedExactDate, existingExactDate)));

    if (!shouldSelect) {
      profile.updatedAt = new Date();
      await this.profileModel.save(profile);
      return {};
    }

    profile.bestAssertionId = assertion.id;
    profile.exactDate = parsed.normalizedExactDate;
    profile.estimatedStart =
      parsed.normalizedStart || parsed.normalizedExactDate;
    profile.estimatedEnd = parsed.normalizedEnd || parsed.normalizedExactDate;
    profile.normalizedYear = parsed.normalizedYear;
    profile.normalizedMonth = parsed.normalizedMonth;
    profile.normalizedDay = parsed.normalizedDay;
    profile.precision = parsed.precision;
    profile.calendar = parsed.calendar;
    profile.resolutionCertainty = parsed.resolutionCertainty;
    profile.conflictStatus = PersonTemporalConflictStatus.none;
    profile.version = PERSON_TEMPORAL_PROFILE_VERSION;
    profile.updatedAt = new Date();
    await this.profileModel.save(profile);
    return { selectedExactDate: parsed.normalizedExactDate };
  }

  private async supersedePriorExactAssertions(
    replacement: PersonTemporalAssertionEntity
  ): Promise<void> {
    const active = await this.assertionModel.find({
      where: {
        userId: replacement.userId,
        subjectType: replacement.subjectType,
        subjectId: replacement.subjectId,
        eventType: replacement.eventType,
        status: PersonTemporalAssertionStatus.active,
      },
    });
    const now = new Date();
    for (const assertion of active) {
      if (
        assertion.id?.toString() === replacement.id?.toString() ||
        !assertion.normalizedExactDate
      ) {
        continue;
      }
      assertion.status = PersonTemporalAssertionStatus.superseded;
      assertion.updatedAt = now;
      await this.assertionModel.save(assertion);
    }
  }

  private precisionScore(value: PersonTemporalPrecision): number {
    const scores: Record<PersonTemporalPrecision, number> = {
      [PersonTemporalPrecision.exactDay]: 100,
      [PersonTemporalPrecision.dayRange]: 80,
      [PersonTemporalPrecision.monthDay]: 75,
      [PersonTemporalPrecision.yearMonth]: 72,
      [PersonTemporalPrecision.month]: 70,
      [PersonTemporalPrecision.year]: 60,
      [PersonTemporalPrecision.yearRange]: 50,
      [PersonTemporalPrecision.approximateDuration]: 40,
      [PersonTemporalPrecision.ritualRange]: 30,
      [PersonTemporalPrecision.unknown]: 0,
    };
    return scores[value] ?? 0;
  }

  private buildSemanticKey(parsed: ParsedDepartureTimeAssertion): string {
    return [
      PersonTemporalEventType.death,
      parsed.expressionKind,
      parsed.calendar,
      parsed.normalizedExactDate?.toISOString().slice(0, 10) || '',
      parsed.normalizedStart?.toISOString().slice(0, 10) || '',
      parsed.normalizedEnd?.toISOString().slice(0, 10) || '',
      parsed.normalizedYear || '',
      parsed.numericValue || '',
      parsed.durationUnit || '',
      parsed.ritual || '',
    ].join('|');
  }

  private sameDate(left?: Date, right?: Date): boolean {
    if (!left || !right) return false;
    return (
      left.getUTCFullYear() === right.getUTCFullYear() &&
      left.getUTCMonth() === right.getUTCMonth() &&
      left.getUTCDate() === right.getUTCDate()
    );
  }
}
