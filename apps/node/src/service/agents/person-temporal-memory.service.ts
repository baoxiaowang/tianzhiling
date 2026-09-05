import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { createHash } from 'crypto';
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
  extractAgentDepartureTimeRelevantText,
  hasAgentDepartureTimeSignal,
  parseAgentDepartureTime,
} from './person-temporal-memory';
import { OpenAIService } from './openai';

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

export interface DepartureTimeSemanticDecision {
  applies: boolean;
  subject: 'current_agent' | 'other' | 'unknown';
  speechAct: 'assertion' | 'correction' | 'question' | 'negation' | 'uncertain';
  canonicalStatement?: string;
  confidence: 'high' | 'medium' | 'low';
}

export const PERSON_TEMPORAL_SEMANTIC_VERSION = 'departure_semantic_v2';

function collectRegexMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const flags = pattern.global ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
    if (!match[0]) regex.lastIndex += 1;
  }
  return matches;
}

@Provide()
export class PersonTemporalMemoryService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @InjectEntityModel(PersonTemporalAssertionEntity)
  assertionModel: MongoRepository<PersonTemporalAssertionEntity>;

  @InjectEntityModel(PersonTemporalProfileEntity)
  profileModel: MongoRepository<PersonTemporalProfileEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  async recordAgentDepartureFromMessage(
    options: RecordAgentDepartureTimeOptions
  ): Promise<RecordAgentDepartureTimeResult | null> {
    if (
      options.message.temporalMemoryVersion ===
        PERSON_TEMPORAL_SEMANTIC_VERSION &&
      ['written', 'not_applicable'].includes(
        options.message.temporalMemoryStatus || ''
      )
    ) {
      return null;
    }

    const deterministicResult = parseAgentDepartureTime({
      text: options.searchableText,
      referenceAt: options.message.createdAt,
      implicitCurrentAgent: options.implicitCurrentAgent,
    });
    let semanticSource: MessageEntity['temporalMemorySemanticSource'] =
      deterministicResult ? 'deterministic' : undefined;
    let parsed = deterministicResult;
    if (!parsed) {
      parsed = await this.extractDepartureTimeWithModel(options);
      if (parsed) semanticSource = 'fallback';
    }
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
        numericMin: parsed.numericMin,
        numericMax: parsed.numericMax,
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

    await this.rememberSemanticOutcome(
      options.message,
      'written',
      semanticSource
    );

    return { assertion, profile, projectionUpdated };
  }

  private async extractDepartureTimeWithModel(
    options: RecordAgentDepartureTimeOptions
  ): Promise<ParsedDepartureTimeAssertion | null> {
    const sourceText = extractAgentDepartureTimeRelevantText(
      options.searchableText,
      options.implicitCurrentAgent
    );
    if (
      !sourceText ||
      !hasAgentDepartureTimeSignal({
        text: sourceText,
        implicitCurrentAgent: options.implicitCurrentAgent,
      })
    ) {
      return null;
    }

    const semanticHash = this.buildSemanticDecisionHash(
      sourceText,
      options.implicitCurrentAgent
    );
    options.message.temporalMemorySemanticHash = semanticHash;
    const cachedDecision = await this.findCachedSemanticDecision(
      options,
      sourceText,
      semanticHash
    );
    if (cachedDecision === null) return null;
    if (cachedDecision) return cachedDecision;
    if (!this.openAIService?.isEnabled?.()) return null;

    try {
      const result = await this.openAIService.generateText({
        temperature: 0,
        topP: 0.1,
        reasoningSplit: false,
        maxTokens: 80,
        systemPrompt: [
          '判定用户是否在陈述/纠正当前智能体的离世时间。只输出JSON。',
          '无歧义陈述/纠正才a=1；提问、否定、猜测、第三人、对象不明均a=0。',
          'e必须原样截取原话时间片段；不计算日期，不新增数字或单位。',
          '{"a":0,"s":"current_agent|other|unknown","t":"assertion|correction|question|negation|uncertain","e":"原文片段","c":0}',
        ].join('\n'),
        prompt: [
          `当前智能体指代是否已由相认任务确定：${
            options.implicitCurrentAgent ? '是' : '否'
          }`,
          `用户原话：${sourceText}`,
        ].join('\n'),
      });
      const decision = this.parseSemanticDecision(result.content);
      if (!decision) return null;
      if (this.isDefinitiveNonApplicableDecision(decision)) {
        await this.rememberSemanticOutcome(
          options.message,
          'not_applicable',
          'fallback'
        );
        return null;
      }
      const parsed = this.parseAcceptedSemanticDecision(
        sourceText,
        options.message.createdAt,
        decision
      );
      if (parsed) {
        options.message.temporalMemoryEvidence = decision.canonicalStatement
          ?.trim()
          .slice(0, 120);
        options.message.temporalMemorySpeechAct =
          decision.speechAct === 'correction' ? 'correction' : 'assertion';
      }
      return parsed;
    } catch (error) {
      this.logger?.warn?.(
        '[person-temporal-memory] semantic extraction skipped, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  private parseSemanticDecision(
    content?: string
  ): DepartureTimeSemanticDecision | null {
    const raw = content?.trim();
    if (!raw) return null;
    const candidates = [
      raw,
      raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    ];
    const objectStart = raw.indexOf('{');
    const objectEnd = raw.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(raw.slice(objectStart, objectEnd + 1));
    }

    for (const candidate of Array.from(new Set(candidates))) {
      try {
        const value = JSON.parse(candidate) as Record<string, unknown>;
        const confidenceValue = value.confidence ?? value.c;
        const parsed: Partial<DepartureTimeSemanticDecision> = {
          applies:
            typeof value.applies === 'boolean' ? value.applies : value.a === 1,
          subject: (value.subject ?? value.s) as
            | DepartureTimeSemanticDecision['subject']
            | undefined,
          speechAct: (value.speechAct ?? value.t) as
            | DepartureTimeSemanticDecision['speechAct']
            | undefined,
          canonicalStatement:
            typeof (value.canonicalStatement ?? value.e) === 'string'
              ? String(value.canonicalStatement ?? value.e)
              : undefined,
          confidence:
            typeof confidenceValue === 'number'
              ? confidenceValue >= 0.9
                ? 'high'
                : confidenceValue >= 0.6
                ? 'medium'
                : 'low'
              : (confidenceValue as
                  | DepartureTimeSemanticDecision['confidence']
                  | undefined),
        };
        if (
          typeof parsed.applies === 'boolean' &&
          ['current_agent', 'other', 'unknown'].includes(
            parsed.subject || ''
          ) &&
          [
            'assertion',
            'correction',
            'question',
            'negation',
            'uncertain',
          ].includes(parsed.speechAct || '') &&
          ['high', 'medium', 'low'].includes(parsed.confidence || '')
        ) {
          return parsed as DepartureTimeSemanticDecision;
        }
      } catch {
        // Continue with the next bounded JSON candidate.
      }
    }
    return null;
  }

  private isDefinitiveNonApplicableDecision(
    decision: DepartureTimeSemanticDecision
  ): boolean {
    return !decision.applies && decision.confidence === 'high';
  }

  private async findCachedSemanticDecision(
    options: RecordAgentDepartureTimeOptions,
    sourceText: string,
    semanticHash: string
  ): Promise<ParsedDepartureTimeAssertion | null | undefined> {
    if (!this.messageModel?.findOne) return undefined;
    try {
      const cached = await this.messageModel.findOne({
        where: {
          userId: options.message.userId,
          agentId: options.message.agentId,
          temporalMemorySemanticHash: semanticHash,
          temporalMemoryVersion: PERSON_TEMPORAL_SEMANTIC_VERSION,
        } as never,
        order: { temporalMemoryCheckedAt: 'DESC' } as never,
      });
      if (!cached) return undefined;
      if (cached.temporalMemoryStatus === 'not_applicable') {
        await this.rememberSemanticOutcome(
          options.message,
          'not_applicable',
          'fallback'
        );
        return null;
      }
      if (
        cached.temporalMemoryStatus !== 'written' ||
        cached.temporalMemorySemanticSource !== 'fallback' ||
        !cached.temporalMemoryEvidence ||
        !cached.temporalMemorySpeechAct
      ) {
        return undefined;
      }
      const decision: DepartureTimeSemanticDecision = {
        applies: true,
        subject: 'current_agent',
        speechAct: cached.temporalMemorySpeechAct,
        canonicalStatement: cached.temporalMemoryEvidence,
        confidence: 'high',
      };
      const parsed = this.parseAcceptedSemanticDecision(
        sourceText,
        options.message.createdAt,
        decision
      );
      if (!parsed) return undefined;
      options.message.temporalMemoryEvidence = cached.temporalMemoryEvidence;
      options.message.temporalMemorySpeechAct = cached.temporalMemorySpeechAct;
      return parsed;
    } catch (error) {
      this.logger?.warn?.(
        '[person-temporal-memory] semantic cache lookup skipped, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
  }

  private buildSemanticDecisionHash(
    sourceText: string,
    implicitCurrentAgent = false
  ): string {
    const normalized = sourceText.normalize('NFKC').replace(/\s+/gu, '').trim();
    return createHash('sha256')
      .update(`${implicitCurrentAgent ? 'implicit' : 'explicit'}:${normalized}`)
      .digest('hex');
  }

  private parseAcceptedSemanticDecision(
    sourceText: string,
    referenceAt: Date,
    decision: DepartureTimeSemanticDecision
  ): ParsedDepartureTimeAssertion | null {
    if (
      !decision.applies ||
      decision.subject !== 'current_agent' ||
      !['assertion', 'correction'].includes(decision.speechAct) ||
      decision.confidence !== 'high' ||
      !decision.canonicalStatement?.trim()
    ) {
      return null;
    }

    const evidence = decision.canonicalStatement.trim().slice(0, 120);
    if (!this.preservesTemporalEvidence(sourceText, evidence)) return null;
    const parsed = parseAgentDepartureTime({
      text: evidence,
      referenceAt,
      implicitCurrentAgent: true,
    });
    if (!parsed) return null;

    return {
      ...parsed,
      isCorrection: decision.speechAct === 'correction' || parsed.isCorrection,
      derivationRule: `semantic_gate_v2:${parsed.derivationRule}`,
    };
  }

  private preservesTemporalEvidence(
    sourceText: string,
    canonicalStatement: string
  ): boolean {
    const normalizedSource = sourceText.replace(/\s+/gu, '');
    const normalizedEvidence = canonicalStatement.replace(/\s+/gu, '');
    if (!normalizedSource.includes(normalizedEvidence)) return false;

    const sourceTokens = this.extractTemporalEvidenceTokens(sourceText);
    const canonicalTokens =
      this.extractTemporalEvidenceTokens(canonicalStatement);
    if (
      !canonicalTokens.length ||
      canonicalTokens.some(token => !sourceTokens.includes(token))
    ) {
      return false;
    }

    const exactMarkers = /整整|正好|恰好|到今天|周年|一天不差/;
    return (
      !exactMarkers.test(canonicalStatement) || exactMarkers.test(sourceText)
    );
  }

  private async rememberSemanticOutcome(
    message: MessageEntity,
    status: NonNullable<MessageEntity['temporalMemoryStatus']>,
    source?: MessageEntity['temporalMemorySemanticSource']
  ): Promise<void> {
    message.temporalMemoryStatus = status;
    message.temporalMemoryVersion = PERSON_TEMPORAL_SEMANTIC_VERSION;
    message.temporalMemorySemanticSource = source;
    message.temporalMemoryCheckedAt = new Date();
    if (this.messageModel?.save) {
      try {
        await this.messageModel.save(message);
      } catch (error) {
        this.logger?.warn?.(
          '[person-temporal-memory] semantic outcome cache skipped, messageId=%s, reason=%s',
          message.id?.toString?.() || '',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  private extractTemporalEvidenceTokens(value: string): string[] {
    const compact = value.replace(/\s+/g, '');
    const tokens: string[] = [];
    for (const match of collectRegexMatches(
      compact,
      /([0-9零〇一二两三四五六七八九十百千]+)(?:个)?(年头|年|个月|月|周|星期|天|日|号)/g
    )) {
      const unit =
        match[2] === '年头' ? '年' : match[2] === '个月' ? '月' : match[2];
      tokens.push(`${match[1]}${unit}`);
    }
    for (const match of collectRegexMatches(
      compact,
      /头七|头7|一七|二七|2七|三七|3七|五七|5七|七七|7七|百日|百天|100天|昨天|前天|去年|今年/g
    )) {
      tokens.push(match[0]);
    }
    return Array.from(new Set(tokens));
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
      parsed.numericMin || '',
      parsed.numericMax || '',
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
