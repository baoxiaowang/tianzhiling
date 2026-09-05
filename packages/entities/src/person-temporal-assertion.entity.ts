import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export enum PersonTemporalSubjectType {
  user = "user",
  agent = "agent",
  relative = "relative",
}

export enum PersonTemporalEventType {
  birth = "birth",
  death = "death",
  birthdayObservance = "birthday_observance",
  expectedBirth = "expected_birth",
}

export enum PersonTemporalExpressionKind {
  exactDate = "exact_date",
  partialDate = "partial_date",
  relativeDuration = "relative_duration",
  ritualMilestone = "ritual_milestone",
  unknown = "unknown",
}

export enum PersonTemporalCalendar {
  gregorian = "gregorian",
  lunar = "lunar",
  unknown = "unknown",
}

export enum PersonTemporalPrecision {
  exactDay = "exact_day",
  dayRange = "day_range",
  monthDay = "month_day",
  yearMonth = "year_month",
  month = "month",
  year = "year",
  yearRange = "year_range",
  approximateDuration = "approximate_duration",
  ritualRange = "ritual_range",
  unknown = "unknown",
}

export enum PersonTemporalAssertionConfidence {
  confirmed = "confirmed",
  candidate = "candidate",
}

export enum PersonTemporalAssertionStatus {
  active = "active",
  superseded = "superseded",
  conflicted = "conflicted",
  rejected = "rejected",
}

export enum PersonTemporalResolutionCertainty {
  explicitExact = "explicit_exact",
  derivedExact = "derived_exact",
  estimatedRange = "estimated_range",
  unresolved = "unresolved",
}

export enum PersonTemporalDurationUnit {
  day = "day",
  month = "month",
  year = "year",
}

export enum PersonTemporalRitual {
  touqi = "touqi",
  erqi = "erqi",
  sanqi = "sanqi",
  wuqi = "wuqi",
  qiqi = "qiqi",
  hundredDays = "hundred_days",
  anniversary = "anniversary",
}

@Index(["userId", "subjectType", "subjectId", "eventType", "status"], {
  background: true,
})
@Index(["userId", "sourceMessageId", "semanticKey"], {
  unique: true,
  background: true,
})
@Entity(TableName.person_temporal_assertion)
export class PersonTemporalAssertionEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  subjectType: PersonTemporalSubjectType;

  @Column()
  subjectId: MongoObjectId;

  @Column()
  eventType: PersonTemporalEventType;

  @Column()
  expressionKind: PersonTemporalExpressionKind;

  @Column()
  calendar: PersonTemporalCalendar;

  @Column()
  rawText: string;

  @Column()
  referenceAt: Date;

  @Column()
  numericValue?: number;

  @Column()
  durationUnit?: PersonTemporalDurationUnit;

  @Column()
  approximate?: boolean;

  @Column()
  isCorrection?: boolean;

  @Column()
  ritual?: PersonTemporalRitual;

  @Column()
  ritualNominalDay?: number;

  @Column()
  normalizedExactDate?: Date;

  @Column()
  normalizedStart?: Date;

  @Column()
  normalizedEnd?: Date;

  @Column()
  normalizedYear?: number;

  @Column()
  normalizedMonth?: number;

  @Column()
  normalizedDay?: number;

  @Column()
  precision: PersonTemporalPrecision;

  @Column()
  confidence: PersonTemporalAssertionConfidence;

  @Column()
  resolutionCertainty: PersonTemporalResolutionCertainty;

  @Column()
  status: PersonTemporalAssertionStatus;

  @Column()
  semanticKey: string;

  @Column()
  derivationRule?: string;

  @Column()
  sourceAgentId?: MongoObjectId;

  @Column()
  sourceMessageId: MongoObjectId;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
