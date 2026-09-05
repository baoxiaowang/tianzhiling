import { Column, Entity, Index } from "typeorm";
import {
  PersonTemporalCalendar,
  PersonTemporalEventType,
  PersonTemporalPrecision,
  PersonTemporalResolutionCertainty,
  PersonTemporalSubjectType,
} from "./person-temporal-assertion.entity";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const PERSON_TEMPORAL_PROFILE_VERSION =
  "person_temporal_profile_v1" as const;

export enum PersonTemporalConflictStatus {
  none = "none",
  conflicted = "conflicted",
}

@Index(["userId", "subjectType", "subjectId", "eventType"], {
  unique: true,
  background: true,
})
@Index(["userId", "eventType", "updatedAt"], { background: true })
@Entity(TableName.person_temporal_profile)
export class PersonTemporalProfileEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  subjectType: PersonTemporalSubjectType;

  @Column()
  subjectId: MongoObjectId;

  @Column()
  eventType: PersonTemporalEventType;

  @Column()
  bestAssertionId?: MongoObjectId;

  @Column()
  exactDate?: Date;

  @Column()
  estimatedStart?: Date;

  @Column()
  estimatedEnd?: Date;

  @Column()
  normalizedYear?: number;

  @Column()
  normalizedMonth?: number;

  @Column()
  normalizedDay?: number;

  @Column()
  precision: PersonTemporalPrecision;

  @Column()
  calendar: PersonTemporalCalendar;

  @Column()
  resolutionCertainty: PersonTemporalResolutionCertainty;

  @Column()
  conflictStatus: PersonTemporalConflictStatus;

  @Column()
  version: typeof PERSON_TEMPORAL_PROFILE_VERSION;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
