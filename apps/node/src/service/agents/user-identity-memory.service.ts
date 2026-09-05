import { InjectEntityModel } from '@midwayjs/typeorm';
import { Inject, Provide } from '@midwayjs/core';
import {
  MessageEntity,
  MongoObjectId,
  USER_IDENTITY_PROFILE_VERSION,
  UserIdentityFormerName,
  UserIdentityNameSource,
  UserIdentityProfileEntity,
  UserKnownPersonEntity,
  UserKnownPersonStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  extractUserNameMemory,
  isExplicitCanonicalNameReplacement,
} from './agent-name-memory';
import { UserRelativeProfileService } from './user-relative-profile.service';

export interface UserIdentityPromptProfile {
  realName?: string;
  formerNames: string[];
  aliases: string[];
}

export interface UserKnownPersonPromptProfile {
  id: string;
  preferredName?: string;
  realName?: string;
  aliases: string[];
  relationToUser?: string;
}

export interface KnownPersonDeclaration {
  realName?: string;
  aliases: string[];
  relationToUser: string;
  identityKey: string;
}

// Lazy matching is important before markers such as “名字叫”; otherwise the
// marker itself is swallowed into the nickname (e.g. “浩浩名字”).
const PERSON_NAME = '[\\u4e00-\\u9fa5A-Za-z·]{1,12}?';
const RELATION =
  '爸爸|妈妈|父亲|母亲|儿子|女儿|孩子|哥哥|姐姐|弟弟|妹妹|爷爷|奶奶|外公|外婆|姥姥|姥爷|老公|老婆|丈夫|妻子|爱人|伴侣|孙子|孙女|外孙|外孙女|重孙|重孙女|外甥|外甥女|侄子|侄女|叔叔|伯伯|舅舅|姑姑|姨妈|阿姨|朋友|同事|家人|亲人';
const NON_PERSON_NAMES = new Set([
  '爸爸',
  '妈妈',
  '父亲',
  '母亲',
  '儿子',
  '女儿',
  '孩子',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '朋友',
  '同事',
  '家人',
  '亲人',
  '他',
  '她',
  '他们',
  '她们',
]);

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
export class UserIdentityMemoryService {
  @InjectEntityModel(UserIdentityProfileEntity)
  identityModel: MongoRepository<UserIdentityProfileEntity>;

  @InjectEntityModel(UserKnownPersonEntity)
  knownPersonModel: MongoRepository<UserKnownPersonEntity>;

  @Inject()
  userRelativeProfileService: UserRelativeProfileService;

  async recordFromUserMessage(
    message: MessageEntity,
    sourceText: string
  ): Promise<void> {
    await this.recordUserIdentity({
      userId: message.userId,
      agentId: message.agentId,
      messageId: message.id,
      sourceText,
    });
    await this.recordKnownPeople({
      userId: message.userId,
      agentId: message.agentId,
      messageId: message.id,
      sourceText,
    });
  }

  async getUserIdentity(
    userId: MongoObjectId
  ): Promise<UserIdentityPromptProfile | null> {
    const profile = await this.identityModel.findOne({ where: { userId } });

    if (!profile) return null;

    return {
      realName: profile.realName?.trim() || undefined,
      formerNames: this.unique(
        (profile.formerNames || []).map(item => item.value)
      ),
      aliases: this.unique(profile.aliases || []),
    };
  }

  async listRelevantKnownPeople(options: {
    userId: MongoObjectId;
    query: string;
    recentTexts?: string[];
    limit?: number;
  }): Promise<UserKnownPersonPromptProfile[]> {
    const mentionText = [
      options.query,
      ...(options.recentTexts || []).slice(-2),
    ]
      .filter(Boolean)
      .join('\n');

    if (!mentionText.trim()) return [];

    const people = await this.knownPersonModel.find({
      where: {
        userId: options.userId,
        status: UserKnownPersonStatus.active,
      },
      order: { updatedAt: 'DESC' },
      take: 64,
    });

    return people
      .filter(person =>
        this.unique([person.realName, ...(person.aliases || [])]).some(
          name => name.length >= 2 && mentionText.includes(name)
        )
      )
      .slice(0, Math.max(1, Math.min(options.limit || 4, 8)))
      .map(person => ({
        id: `person:${person.id.toString()}`,
        ...(person.preferredName?.trim()
          ? { preferredName: person.preferredName.trim() }
          : {}),
        realName: person.realName?.trim() || undefined,
        aliases: this.unique(person.aliases || []),
        relationToUser: person.relationToUser?.trim() || undefined,
      }));
  }

  private async recordUserIdentity(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    messageId: MongoObjectId;
    sourceText: string;
  }): Promise<void> {
    const extracted = extractUserNameMemory(options.sourceText);
    const globalExplicitAliases = extracted.explicitAliases.filter(
      alias => alias !== extracted.preferredName
    );

    if (!extracted.canonicalName && !globalExplicitAliases.length) return;

    const now = new Date();
    const source: UserIdentityNameSource = isExplicitCanonicalNameReplacement(
      options.sourceText,
      'user'
    )
      ? 'explicit_chat_correction'
      : 'explicit_chat_statement';

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await this.identityModel.findOne({
        where: { userId: options.userId },
      });
      const nextAliases = this.unique([
        ...(existing?.aliases || []),
        ...extracted.derivedAliases,
        ...globalExplicitAliases,
      ]).filter(name => name !== extracted.canonicalName);

      if (!existing) {
        const profile = new UserIdentityProfileEntity();
        Object.assign(profile, {
          userId: options.userId,
          realName: extracted.canonicalName,
          formerNames: [],
          aliases: nextAliases,
          version: USER_IDENTITY_PROFILE_VERSION,
          source,
          sourceAgentId: options.agentId,
          sourceMessageId: options.messageId,
          sourceText: options.sourceText.slice(0, 500),
          createdAt: now,
          updatedAt: now,
        });
        try {
          await this.identityModel.save(profile);
          return;
        } catch (error) {
          if (attempt === 1) throw error;
          continue;
        }
      }

      const formerNames: UserIdentityFormerName[] = [
        ...(existing.formerNames || []),
      ];
      if (
        extracted.canonicalName &&
        existing.realName &&
        extracted.canonicalName !== existing.realName &&
        !formerNames.some(item => item.value === existing.realName)
      ) {
        formerNames.push({
          value: existing.realName,
          supersededAt: now,
          sourceMessageId: options.messageId,
        });
      }
      const update = {
        ...(extracted.canonicalName
          ? { realName: extracted.canonicalName }
          : {}),
        formerNames: formerNames.slice(-12),
        aliases: nextAliases,
        version: USER_IDENTITY_PROFILE_VERSION,
        source,
        sourceAgentId: options.agentId,
        sourceMessageId: options.messageId,
        sourceText: options.sourceText.slice(0, 500),
        updatedAt: now,
      };
      const result = await this.identityModel.updateOne(
        { _id: existing.id, updatedAt: existing.updatedAt },
        { $set: update } as never
      );

      if (result.modifiedCount === 1) return;
    }

    throw new Error('User identity concurrent update did not converge');
  }

  private async recordKnownPeople(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    messageId: MongoObjectId;
    sourceText: string;
  }): Promise<void> {
    const declarations = extractKnownPersonDeclarations(options.sourceText);
    for (const declaration of declarations) {
      await this.upsertKnownPersonDeclaration({ ...options, declaration });
    }
  }

  async upsertKnownPersonDeclaration(options: {
    userId: MongoObjectId;
    agentId: MongoObjectId;
    messageId: MongoObjectId;
    sourceText: string;
    declaration: KnownPersonDeclaration;
  }): Promise<UserKnownPersonEntity> {
    const { declaration } = options;
    const people = this.knownPersonModel.find
      ? await this.knownPersonModel.find({
          where: {
            userId: options.userId,
            status: UserKnownPersonStatus.active,
          },
          order: { updatedAt: 'DESC' },
          take: 128,
        })
      : [];
    const incomingNames = new Set(
      this.unique([declaration.realName, ...declaration.aliases]).map(value =>
        value.toLowerCase()
      )
    );
    const relation = normalizeRelation(declaration.relationToUser);
    const nameMatches = people.filter(person =>
      this.unique([
        person.realName,
        person.preferredName,
        ...(person.aliases || []),
      ]).some(name => incomingNames.has(name.toLowerCase()))
    );
    let existing = nameMatches.find(
      person => normalizeRelation(person.relationToUser || '') === relation
    );
    if (!existing && nameMatches.length === 1) existing = nameMatches[0];

    const now = new Date();
    if (existing) {
      const aliases = this.unique([
        ...(existing.aliases || []),
        existing.realName !== declaration.realName
          ? existing.realName
          : undefined,
        ...declaration.aliases,
      ]).filter(value => value !== declaration.realName);
      existing.realName = declaration.realName || existing.realName;
      existing.preferredName = declaration.aliases[0] || existing.preferredName;
      existing.aliases = aliases;
      existing.relationToUser = declaration.relationToUser;
      existing.sourceAgentId = options.agentId;
      existing.sourceMessageId = options.messageId;
      existing.sourceText = options.sourceText.slice(0, 500);
      existing.updatedAt = now;
      await this.knownPersonModel.save(existing);
    } else {
      existing = new UserKnownPersonEntity();
      Object.assign(existing, {
        userId: options.userId,
        identityKey: `person:${randomUUID()}`,
        realName: declaration.realName,
        preferredName: declaration.aliases[0],
        aliases: this.unique(declaration.aliases).filter(
          value => value !== declaration.realName
        ),
        relationToUser: declaration.relationToUser,
        status: UserKnownPersonStatus.active,
        sourceAgentId: options.agentId,
        sourceMessageId: options.messageId,
        sourceText: options.sourceText.slice(0, 500),
        createdAt: now,
        updatedAt: now,
      });
      await this.knownPersonModel.save(existing);
    }

    await this.userRelativeProfileService?.ensureForKnownPerson({
      userId: options.userId,
      personId: existing.id,
      relationToUser: declaration.relationToUser,
      sourceMessageId: options.messageId,
      sourceText: options.sourceText,
    });
    return existing;
  }

  async resolveKnownPersonReference(options: {
    userId: MongoObjectId;
    referenceName?: string;
    relationToUser?: string;
  }): Promise<UserKnownPersonEntity | null> {
    const people = await this.knownPersonModel.find({
      where: {
        userId: options.userId,
        status: UserKnownPersonStatus.active,
      },
      order: { updatedAt: 'DESC' },
      take: 128,
    });
    const reference = options.referenceName?.trim().toLowerCase();
    const relation = normalizeRelation(options.relationToUser || '');
    const matches = people.filter(person => {
      const nameMatched = reference
        ? this.unique([
            person.realName,
            person.preferredName,
            ...(person.aliases || []),
          ]).some(name => name.toLowerCase() === reference)
        : true;
      const relationMatched = relation
        ? normalizeRelation(person.relationToUser || '') === relation
        : true;
      return nameMatched && relationMatched;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  async resolveKnownPersonMention(options: {
    userId: MongoObjectId;
    mention: string;
  }): Promise<UserKnownPersonEntity | null> {
    const mention = options.mention?.trim().toLowerCase();
    if (!mention) return null;
    const people = await this.knownPersonModel.find({
      where: {
        userId: options.userId,
        status: UserKnownPersonStatus.active,
      },
      order: { updatedAt: 'DESC' },
      take: 128,
    });
    const ranked = people
      .map(person => {
        const names = this.unique([
          person.realName,
          person.preferredName,
          ...(person.aliases || []),
        ]).map(value => value.toLowerCase());
        const relation = (person.relationToUser || '').trim().toLowerCase();
        const exactName = names.some(name => name === mention);
        const containedName = names.some(
          name => name.length >= 2 && mention.includes(name)
        );
        const exactRelation = Boolean(relation && relation === mention);
        const containedRelation = Boolean(
          relation && relation.length >= 2 && mention.includes(relation)
        );
        const score = exactName
          ? 100
          : containedName
          ? 80
          : exactRelation
          ? 60
          : containedRelation
          ? 40
          : 0;
        return { person, score };
      })
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!ranked.length) return null;
    const best = ranked[0].score;
    const bestMatches = ranked.filter(item => item.score === best);
    return bestMatches.length === 1 ? bestMatches[0].person : null;
  }

  async countKnownPeopleByRelation(
    userId: MongoObjectId,
    relationToUser: string
  ): Promise<number> {
    const relation = normalizeRelation(relationToUser);
    const people = await this.knownPersonModel.find({
      where: { userId, status: UserKnownPersonStatus.active },
      take: 128,
    });
    return people.filter(
      person => normalizeRelation(person.relationToUser || '') === relation
    ).length;
  }

  private unique(values: Array<string | undefined>): string[] {
    return Array.from(
      new Set(values.map(value => value?.trim()).filter(Boolean) as string[])
    );
  }
}

export function extractKnownPersonDeclarations(
  sourceText: string
): KnownPersonDeclaration[] {
  const text = (sourceText || '').replace(/\s+/g, '').trim();
  if (!text || /[?？]/.test(text)) return [];

  const declarations: Array<{
    realName?: string;
    alias?: string;
    relationToUser?: string;
  }> = [];
  const aliasNameRelation = new RegExp(
    `(?:^|(?<=[，,。；;]))(${PERSON_NAME})(?:名字)?叫(${PERSON_NAME})[，,]?(?:是|就是)我(?:的)?(${RELATION})(?=$|[，,。；;])`,
    'g'
  );
  const relationName = new RegExp(
    `(?:^|(?<=[，,。；;]))我(?:的)?(${RELATION})(?:名字)?(?:叫|名叫|是)(${PERSON_NAME})(?=$|[，,。；;])`,
    'g'
  );
  const nameRelation = new RegExp(
    `(?:^|(?<=[，,。；;]))(${PERSON_NAME})(?:是|就是)我(?:的)?(${RELATION})(?=$|[，,。；;])`,
    'g'
  );

  for (const match of collectRegexMatches(text, aliasNameRelation)) {
    declarations.push({
      alias: normalizePersonName(match[1]),
      realName: normalizePersonName(match[2]),
      relationToUser: match[3],
    });
  }
  for (const match of collectRegexMatches(text, relationName)) {
    declarations.push({
      realName: normalizePersonName(match[2]),
      relationToUser: match[1],
    });
  }
  for (const match of collectRegexMatches(text, nameRelation)) {
    declarations.push({
      realName: normalizePersonName(match[1]),
      relationToUser: match[2],
    });
  }

  const byKey = new Map<string, KnownPersonDeclaration>();
  for (const declaration of declarations) {
    const realName = declaration.realName;
    const alias = declaration.alias;
    const relation = declaration.relationToUser?.trim();
    if (!relation || (!realName && !alias)) continue;
    const anchor = realName || alias;
    if (!anchor) continue;
    const identityKey = `${normalizeRelation(
      relation
    )}|${anchor.toLowerCase()}`;
    const prior = byKey.get(identityKey);
    byKey.set(identityKey, {
      identityKey,
      realName: realName || prior?.realName,
      aliases: Array.from(
        new Set([...(prior?.aliases || []), alias].filter(Boolean) as string[])
      ),
      relationToUser: relation,
    });
  }

  return [...byKey.values()];
}

function normalizePersonName(value?: string): string | undefined {
  const name = (value || '').replace(/[，,。！？!?；;：:、]/g, '').trim();
  if (
    !name ||
    name.length > 12 ||
    NON_PERSON_NAMES.has(name) ||
    /(?:什么|哪个|谁|不是|是不是)/.test(name)
  ) {
    return undefined;
  }
  return name;
}

function normalizeRelation(value: string): string {
  const aliases: Record<string, string> = {
    爸: '爸爸',
    父亲: '爸爸',
    妈: '妈妈',
    母亲: '妈妈',
    老公: '丈夫',
    老婆: '妻子',
    外婆: '姥姥',
    外公: '姥爷',
  };
  return aliases[value] || value;
}
