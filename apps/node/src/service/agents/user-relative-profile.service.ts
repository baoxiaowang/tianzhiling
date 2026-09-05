import { InjectEntityModel } from '@midwayjs/typeorm';
import { Provide } from '@midwayjs/core';
import {
  MongoObjectId,
  USER_RELATIVE_PROFILE_VERSION,
  UserRelativeAgentRelationship,
  UserRelativeFactDomain,
  UserRelativeFactConfidence,
  UserRelativeFactEntity,
  UserRelativeFactStatus,
  UserRelativeLifeStage,
  UserRelativeProfileEntity,
  UserRelativeProfileStatus,
  UserRelativeSex,
  UserKnownPersonEntity,
  UserKnownPersonStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

export interface UserRelativePromptFact {
  domain: UserRelativeFactDomain;
  key: string;
  value: string;
  status: UserRelativeFactStatus;
  occurredAt?: Date;
  confidence?: UserRelativeFactConfidence;
}

export interface UserRelativePromptProfile {
  id: string;
  preferredName?: string;
  realName?: string;
  aliases: string[];
  relationToUser?: string;
  relationToAgent?: string;
  personCallsAgent?: string;
  lifeStage: UserRelativeLifeStage;
  sex?: UserRelativeSex;
  birthDate?: Date;
  birthYear?: number;
  facts: UserRelativePromptFact[];
  needsName?: boolean;
}

export interface EnsureRelativeProfileOptions {
  userId: MongoObjectId;
  personId: MongoObjectId;
  relationToUser?: string;
  sourceMessageId?: MongoObjectId;
  sourceText?: string;
}

export interface RecordRelativeFactOptions {
  userId: MongoObjectId;
  personId: MongoObjectId;
  domain: UserRelativeFactDomain;
  key: string;
  value: string;
  status?: UserRelativeFactStatus;
  occurredAt?: Date;
  resolvedAt?: Date;
  sourceAgentId?: MongoObjectId;
  sourceMessageId?: MongoObjectId;
  sourceText?: string;
  confidence?: UserRelativeFactConfidence;
  effectiveAt?: Date;
  validUntil?: Date;
}

const RELATIVE_REFERENCE_PATTERN =
  /亲人|家人|爸爸|父亲|妈妈|母亲|爷爷|奶奶|外公|外婆|姥姥|姥爷|老公|老婆|丈夫|妻子|爱人|伴侣|哥哥|姐姐|弟弟|妹妹|兄弟|姐妹|孩子|宝宝|宝贝|儿子|女儿|闺女|小子|老大|老二|二宝|孙子|孙女|外孙|外孙女|重孙|重孙女|外甥|外甥女|侄子|侄女|叔叔|伯伯|舅舅|姑姑|姨妈|阿姨/;
const RELATIVE_RELATION_PATTERN =
  /^(?:爸爸|父亲|妈妈|母亲|爷爷|奶奶|外公|外婆|姥姥|姥爷|老公|老婆|丈夫|妻子|爱人|伴侣|哥哥|姐姐|弟弟|妹妹|兄弟|姐妹|儿子|女儿|闺女|孩子|宝宝|宝贝|老大|老二|二宝|孙子|孙女|外孙|外孙女|重孙|重孙女|外甥|外甥女|侄子|侄女|叔叔|伯伯|舅舅|姑姑|姨妈|阿姨|家人|亲人)$/;
const MAX_FACTS_PER_RELATIVE = 4;
const NAME_INQUIRY_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;
const ASSISTANT_NAME_INQUIRY_PATTERN =
  /(?:孩子|宝宝|宝贝|儿子|女儿|闺女|小家伙).{0,8}(?:叫什么名字|名字叫什么|名字是什么|名字呢)|(?:叫什么名字|怎么称呼)(?:[呀呢啊吗？?]|$)/u;

@Provide()
export class UserRelativeProfileService {
  @InjectEntityModel(UserRelativeProfileEntity)
  relativeProfileModel: MongoRepository<UserRelativeProfileEntity>;

  @InjectEntityModel(UserRelativeFactEntity)
  relativeFactModel: MongoRepository<UserRelativeFactEntity>;

  @InjectEntityModel(UserKnownPersonEntity)
  knownPersonModel: MongoRepository<UserKnownPersonEntity>;

  async ensureForKnownPerson(
    options: EnsureRelativeProfileOptions
  ): Promise<UserRelativeProfileEntity | null> {
    if (!isRelativeRelation(options.relationToUser)) return null;

    const existing = await this.relativeProfileModel.findOne({
      where: {
        userId: options.userId,
        personId: options.personId,
      },
    });
    const now = new Date();

    if (existing) {
      if (existing.status !== UserRelativeProfileStatus.active) {
        existing.status = UserRelativeProfileStatus.active;
        existing.updatedAt = now;
        await this.relativeProfileModel.save(existing);
      }
      return existing;
    }

    const profile = new UserRelativeProfileEntity();
    Object.assign(profile, {
      userId: options.userId,
      personId: options.personId,
      status: UserRelativeProfileStatus.active,
      lifeStage: 'unknown',
      relationshipsToAgents: [],
      version: USER_RELATIVE_PROFILE_VERSION,
      sourceMessageId: options.sourceMessageId,
      sourceText: this.cleanSource(options.sourceText),
      createdAt: now,
      updatedAt: now,
    });
    try {
      await this.relativeProfileModel.save(profile);
      return profile;
    } catch (error) {
      const concurrentlyCreated = await this.relativeProfileModel.findOne({
        where: {
          userId: options.userId,
          personId: options.personId,
        },
      });
      if (concurrentlyCreated) return concurrentlyCreated;
      throw error;
    }
  }

  async upsertAgentRelationship(options: {
    userId: MongoObjectId;
    personId: MongoObjectId;
    agentId: MongoObjectId;
    relationToAgent?: string;
    personCallsAgent?: string;
    sourceMessageId?: MongoObjectId;
  }): Promise<UserRelativeProfileEntity | null> {
    const profile = await this.relativeProfileModel.findOne({
      where: { userId: options.userId, personId: options.personId },
    });
    if (!profile) return null;

    const now = new Date();
    const relationships = [...(profile.relationshipsToAgents || [])];
    const index = relationships.findIndex(
      item => item.agentId?.toString() === options.agentId.toString()
    );
    const next: UserRelativeAgentRelationship = {
      ...(index >= 0 ? relationships[index] : {}),
      agentId: options.agentId,
      ...(options.relationToAgent?.trim()
        ? { relationToAgent: options.relationToAgent.trim().slice(0, 24) }
        : {}),
      ...(options.personCallsAgent?.trim()
        ? { personCallsAgent: options.personCallsAgent.trim().slice(0, 24) }
        : {}),
      sourceMessageId: options.sourceMessageId,
      updatedAt: now,
    };
    if (index >= 0) relationships[index] = next;
    else relationships.push(next);

    profile.relationshipsToAgents = relationships.slice(-24);
    profile.updatedAt = now;
    await this.relativeProfileModel.save(profile);
    return profile;
  }

  async setProfileState(options: {
    userId: MongoObjectId;
    personId: MongoObjectId;
    lifeStage?: UserRelativeLifeStage;
    sex?: UserRelativeSex;
    birthDate?: Date;
    birthYear?: number;
    sourceMessageId?: MongoObjectId;
    sourceText?: string;
  }): Promise<UserRelativeProfileEntity | null> {
    const profile = await this.relativeProfileModel.findOne({
      where: { userId: options.userId, personId: options.personId },
    });
    if (!profile) return null;

    if (options.lifeStage) profile.lifeStage = options.lifeStage;
    if (options.sex) profile.sex = options.sex;
    if (options.birthDate) profile.birthDate = options.birthDate;
    if (
      Number.isInteger(options.birthYear) &&
      Number(options.birthYear) >= 1900 &&
      Number(options.birthYear) <= new Date().getFullYear()
    ) {
      profile.birthYear = Number(options.birthYear);
    }
    profile.sourceMessageId =
      options.sourceMessageId || profile.sourceMessageId;
    profile.sourceText =
      this.cleanSource(options.sourceText) || profile.sourceText;
    profile.updatedAt = new Date();
    await this.relativeProfileModel.save(profile);
    return profile;
  }

  async recordFact(
    options: RecordRelativeFactOptions
  ): Promise<UserRelativeFactEntity | null> {
    const profile = await this.relativeProfileModel.findOne({
      where: { userId: options.userId, personId: options.personId },
    });
    if (!profile || profile.status !== UserRelativeProfileStatus.active) {
      return null;
    }

    const key = options.key.trim().slice(0, 120);
    const value = options.value.trim().slice(0, 500);
    if (!key || !value) return null;

    const now = new Date();
    const status = options.status || UserRelativeFactStatus.current;
    if (
      status === UserRelativeFactStatus.current ||
      status === UserRelativeFactStatus.resolved
    ) {
      const current = await this.relativeFactModel.findOne({
        where: {
          userId: options.userId,
          personId: options.personId,
          domain: options.domain,
          key,
          status: UserRelativeFactStatus.current,
        },
      });
      if (status === UserRelativeFactStatus.resolved && current) {
        current.value = value;
        current.status = UserRelativeFactStatus.resolved;
        current.resolvedAt = options.resolvedAt || now;
        current.sourceAgentId = options.sourceAgentId || current.sourceAgentId;
        current.sourceMessageId =
          options.sourceMessageId || current.sourceMessageId;
        current.sourceText =
          this.cleanSource(options.sourceText) || current.sourceText;
        current.updatedAt = now;
        await this.relativeFactModel.save(current);
        return current;
      }
      if (current?.value === value) {
        current.occurredAt = options.occurredAt || current.occurredAt;
        current.sourceAgentId = options.sourceAgentId || current.sourceAgentId;
        current.sourceMessageId =
          options.sourceMessageId || current.sourceMessageId;
        current.sourceText =
          this.cleanSource(options.sourceText) || current.sourceText;
        current.updatedAt = now;
        current.supportCount = Math.max(1, current.supportCount || 1) + 1;
        current.confidence =
          options.confidence ||
          current.confidence ||
          UserRelativeFactConfidence.extracted;
        current.sources = this.appendFactSource(current.sources, options, now);
        current.effectiveAt = options.effectiveAt || current.effectiveAt;
        current.validUntil = options.validUntil || current.validUntil;
        await this.relativeFactModel.save(current);
        return current;
      }
      if (current) {
        current.status = UserRelativeFactStatus.historical;
        current.updatedAt = now;
        await this.relativeFactModel.save(current);
      }
    }

    const fact = new UserRelativeFactEntity();
    Object.assign(fact, {
      userId: options.userId,
      personId: options.personId,
      domain: options.domain,
      key,
      value,
      status,
      confidence:
        options.confidence || UserRelativeFactConfidence.extracted,
      supportCount: 1,
      sources: this.appendFactSource([], options, now),
      effectiveAt: options.effectiveAt,
      validUntil: options.validUntil,
      occurredAt: options.occurredAt,
      resolvedAt: options.resolvedAt,
      sourceAgentId: options.sourceAgentId,
      sourceMessageId: options.sourceMessageId,
      sourceText: this.cleanSource(options.sourceText),
      createdAt: now,
      updatedAt: now,
    });
    await this.relativeFactModel.save(fact);
    return fact;
  }

  async listRelevantForPrompt(options: {
    userId: MongoObjectId;
    agentId?: MongoObjectId;
    query: string;
    recentTexts?: string[];
    limit?: number;
  }): Promise<UserRelativePromptProfile[]> {
    const mentionText = [
      options.query,
      ...(options.recentTexts || []).slice(-2),
    ]
      .filter(Boolean)
      .join('\n');
    if (!mentionText.trim()) return [];

    const profiles = await this.relativeProfileModel.find({
      where: {
        userId: options.userId,
        status: UserRelativeProfileStatus.active,
      },
      order: { updatedAt: 'DESC' },
      take: 32,
    });
    if (!profiles.length) return [];

    const personIds = profiles.map(profile => profile.personId);
    const people = await this.knownPersonModel.find({
      where: {
        userId: options.userId,
        _id: { $in: personIds },
        status: UserKnownPersonStatus.active,
      } as never,
    });
    const peopleById = new Map(
      people.map(person => [person.id.toString(), person])
    );
    const genericRelativeReference =
      RELATIVE_REFERENCE_PATTERN.test(mentionText);
    const ranked = profiles
      .map(profile => {
        const person = peopleById.get(profile.personId.toString());
        if (!person) return null;
        const names = this.unique([
          person.preferredName,
          person.realName,
          ...(person.aliases || []),
        ]);
        const nameMatched = names.some(
          name => name.length >= 2 && mentionText.includes(name)
        );
        const relationMatched = Boolean(
          person.relationToUser && mentionText.includes(person.relationToUser)
        );
        if (!nameMatched && !relationMatched && !genericRelativeReference) {
          return null;
        }
        return {
          profile,
          person,
          score: nameMatched ? 100 : relationMatched ? 50 : 10,
        };
      })
      .filter(
        (
          item
        ): item is {
          profile: UserRelativeProfileEntity;
          person: UserKnownPersonEntity;
          score: number;
        } => Boolean(item)
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.profile.updatedAt.getTime() - left.profile.updatedAt.getTime()
      )
      .slice(0, Math.max(1, Math.min(options.limit || 4, 8)));

    if (!ranked.length) return [];

    const selectedIds = ranked.map(item => item.profile.personId);
    const facts = await this.relativeFactModel.find({
      where: {
        userId: options.userId,
        personId: { $in: selectedIds },
        status: {
          $in: [
            UserRelativeFactStatus.current,
            UserRelativeFactStatus.uncertain,
          ],
        },
      } as never,
      order: { updatedAt: 'DESC' },
      take: ranked.length * MAX_FACTS_PER_RELATIVE * 2,
    });

    return ranked.map(({ profile, person }) => {
      const relationship = options.agentId
        ? (profile.relationshipsToAgents || []).find(
            item => item.agentId?.toString() === options.agentId?.toString()
          )
        : undefined;
      return {
        id: `person:${person.id.toString()}`,
        preferredName: person.preferredName?.trim() || undefined,
        realName: person.realName?.trim() || undefined,
        aliases: this.unique(person.aliases || []),
        relationToUser: person.relationToUser?.trim() || undefined,
        relationToAgent: relationship?.relationToAgent,
        personCallsAgent: relationship?.personCallsAgent,
        lifeStage: profile.lifeStage,
        sex: profile.sex,
        birthDate: profile.birthDate,
        birthYear: profile.birthYear,
        facts: facts
          .filter(
            fact => fact.personId.toString() === profile.personId.toString()
          )
          .slice(0, MAX_FACTS_PER_RELATIVE)
          .map(fact => ({
            domain: fact.domain,
            key: fact.key,
            value: fact.value,
            status: fact.status,
            occurredAt: fact.occurredAt,
            confidence:
              fact.confidence || UserRelativeFactConfidence.extracted,
          })),
        needsName:
          !Boolean(
            person.preferredName || person.realName || person.aliases?.length
          ) &&
          (!profile.nameInquiryLastAskedAt ||
            profile.nameInquiryLastAskedAt.getTime() <=
              Date.now() - NAME_INQUIRY_COOLDOWN_MS),
      };
    });
  }

  async recordAssistantNameInquiry(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    userText: string;
    assistantText: string;
  }): Promise<boolean> {
    if (
      !RELATIVE_REFERENCE_PATTERN.test(options.userText) ||
      !ASSISTANT_NAME_INQUIRY_PATTERN.test(options.assistantText)
    ) {
      return false;
    }
    const candidates = (
      await this.listRelevantForPrompt({
        userId: options.userId,
        agentId: options.agentId,
        query: options.userText,
        limit: 4,
      })
    ).filter(item => item.needsName);
    if (candidates.length !== 1) return false;
    const personId = new MongoObjectId(candidates[0].id.replace(/^person:/, ''));
    const profile = await this.relativeProfileModel.findOne({
      where: { userId: options.userId, personId },
    });
    if (!profile) return false;
    profile.nameInquiryLastAskedAt = new Date();
    profile.nameInquiryCount = Math.max(0, profile.nameInquiryCount || 0) + 1;
    profile.updatedAt = profile.nameInquiryLastAskedAt;
    await this.relativeProfileModel.save(profile);
    return true;
  }

  private unique(values: Array<string | undefined>): string[] {
    return Array.from(
      new Set(values.map(value => value?.trim()).filter(Boolean) as string[])
    );
  }

  private cleanSource(value?: string): string | undefined {
    const clean = value?.trim();
    return clean ? clean.slice(0, 500) : undefined;
  }

  private appendFactSource(
    sources: UserRelativeFactEntity['sources'],
    options: RecordRelativeFactOptions,
    observedAt: Date
  ): NonNullable<UserRelativeFactEntity['sources']> {
    if (!options.sourceMessageId) return sources || [];
    const messageId = options.sourceMessageId.toString();
    return [
      ...(sources || []).filter(
        source => source.messageId?.toString() !== messageId
      ),
      {
        messageId: options.sourceMessageId,
        agentId: options.sourceAgentId,
        sourceText: this.cleanSource(options.sourceText),
        observedAt,
      },
    ].slice(-8);
  }
}

export function isRelativeRelation(value?: string): boolean {
  return RELATIVE_RELATION_PATTERN.test((value || '').trim());
}
