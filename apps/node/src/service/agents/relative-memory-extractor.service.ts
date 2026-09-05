import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import {
  MessageEntity,
  PersonTemporalCalendar,
  PersonTemporalEventType,
  PersonTemporalSubjectType,
  UserRelativeFactConfidence,
  UserRelativeFactDomain,
  UserRelativeFactStatus,
  UserRelativeLifeStage,
  UserRelativeSex,
} from '@tzl/entities';
import { OpenAIService } from './openai';
import {
  KnownPersonDeclaration,
  UserIdentityMemoryService,
} from './user-identity-memory.service';
import {
  isRelativeRelation,
  UserRelativeProfileService,
} from './user-relative-profile.service';
import { PersonTemporalMemoryService } from './person-temporal-memory.service';

const RELATIVE_SUBJECT_SIGNAL =
  /我(?:的)?(?:孩子|宝宝|宝贝|儿子|女儿|闺女|孙子|孙女|外孙|外孙女|哥哥|姐姐|弟弟|妹妹|爸爸|妈妈|父亲|母亲|丈夫|妻子|老公|老婆)/;
const RELATIVE_DETAIL_SIGNAL =
  /名字|叫|出生|生日|预产期|怀孕|发烧|生病|住院|健康|长大|上学|幼儿园|工作/;
const NAMED_RELATIVE_DETAIL_SIGNAL =
  /([\u4e00-\u9fa5A-Za-z·]{2,12}).{0,12}(?:出生|生日|预产期|发烧|生病|住院|上学|幼儿园)/;
const SAFE_NAME = /^[\u4e00-\u9fa5A-Za-z·]{1,24}$/;
const USER_BIRTH_ASSERTION =
  /我(?:的)?生日(?:是|在|为)?\s*(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)|我(?:是|于)?\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?\s*出生/u;
const QUESTION_OR_NEGATION = /[？?]|吗|是不是|不是|没(?:有)?|不记得|忘了/u;

interface ExtractedRelativeMemory {
  referenceName?: string;
  realName?: string;
  aliases?: string[];
  relationToUser?: string;
  lifeStage?: UserRelativeLifeStage;
  sex?: UserRelativeSex;
  dates?: Array<{
    eventType?: 'birth' | 'expected_birth';
    date?: string;
    year?: number;
    month?: number;
    day?: number;
    calendar?: 'gregorian' | 'lunar' | 'unknown';
    correction?: boolean;
  }>;
  facts?: Array<{
    domain?: UserRelativeFactDomain;
    key?: string;
    value?: string;
    status?: UserRelativeFactStatus;
  }>;
}

@Provide()
export class RelativeMemoryExtractorService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  userIdentityMemoryService: UserIdentityMemoryService;

  @Inject()
  userRelativeProfileService: UserRelativeProfileService;

  @Inject()
  personTemporalMemoryService: PersonTemporalMemoryService;

  async captureFromUserMessage(
    message: MessageEntity,
    sourceText: string
  ): Promise<number> {
    const text = sourceText?.trim();
    if (!text) return 0;
    let written = await this.captureExplicitUserBirthday(message, text);
    const namedDetail = NAMED_RELATIVE_DETAIL_SIGNAL.exec(text)?.[1];
    const hasNamedRelativeDetail = Boolean(
      namedDetail &&
        !/^(?:我|我的|本人|自己|你|你的|他|她|他们|她们)/u.test(namedDetail)
    );
    if (
      (!(RELATIVE_SUBJECT_SIGNAL.test(text) &&
        RELATIVE_DETAIL_SIGNAL.test(text)) &&
        !hasNamedRelativeDetail)
    ) {
      return written;
    }
    if (!this.openAIService?.isEnabled?.()) return written;

    const extracted = await this.extract(text);
    for (const item of extracted.slice(0, 4)) {
      const relation = item.relationToUser?.trim();
      if (!relation || !isRelativeRelation(relation)) continue;
      const realName = this.cleanName(item.realName);
      const aliases = (item.aliases || [])
        .map(value => this.cleanName(value))
        .filter((value): value is string => Boolean(value && value !== realName))
        .slice(0, 8);
      const referenceName = this.cleanName(item.referenceName);

      let person = await this.userIdentityMemoryService.resolveKnownPersonReference(
        {
          userId: message.userId,
          referenceName,
          relationToUser: relation,
        }
      );
      const relationCount =
        !person && !realName && !aliases.length
          ? await this.userIdentityMemoryService.countKnownPeopleByRelation(
              message.userId,
              relation
            )
          : 0;
      if (!person && (realName || aliases.length || relationCount === 0)) {
        const declaration: KnownPersonDeclaration = {
          identityKey: '',
          realName,
          aliases,
          relationToUser: relation,
        };
        person = await this.userIdentityMemoryService.upsertKnownPersonDeclaration(
          {
            userId: message.userId,
            agentId: message.agentId,
            messageId: message.id,
            sourceText: text,
            declaration,
          }
        );
      }
      if (!person) continue;

      await this.userRelativeProfileService.setProfileState({
        userId: message.userId,
        personId: person.id,
        lifeStage: this.cleanLifeStage(item.lifeStage),
        sex: this.cleanSex(item.sex),
        sourceMessageId: message.id,
        sourceText: text,
      });

      for (const dateFact of (item.dates || []).slice(0, 3)) {
        let eventType =
          dateFact.eventType === 'expected_birth'
            ? PersonTemporalEventType.expectedBirth
            : PersonTemporalEventType.birth;
        const exactDate =
          dateFact.calendar === 'lunar'
            ? undefined
            : this.parseExactDate(dateFact.date);
        const year = this.integer(dateFact.year);
        const month = this.integer(dateFact.month);
        const day = this.integer(dateFact.day);
        if (
          eventType === PersonTemporalEventType.birth &&
          !exactDate &&
          !year &&
          month &&
          day
        ) {
          eventType = PersonTemporalEventType.birthdayObservance;
        }
        const profile = await this.personTemporalMemoryService.recordExplicitPersonDate(
          {
            message,
            subjectType: PersonTemporalSubjectType.relative,
            subjectId: person.id,
            eventType,
            exactDate,
            year,
            month,
            day,
            calendar: this.calendar(dateFact.calendar),
            isCorrection: Boolean(dateFact.correction),
            rawText: text,
          }
        );
        if (
          profile &&
          [
            PersonTemporalEventType.birth,
            PersonTemporalEventType.birthdayObservance,
          ].includes(eventType)
        ) {
          await this.userRelativeProfileService.setProfileState({
            userId: message.userId,
            personId: person.id,
            birthDate: profile.exactDate,
            birthYear: profile.normalizedYear,
            sourceMessageId: message.id,
            sourceText: text,
          });
          written += 1;
        }
      }

      for (const fact of (item.facts || []).slice(0, 6)) {
        if (!Object.values(UserRelativeFactDomain).includes(fact.domain as never)) {
          continue;
        }
        const key = fact.key?.trim();
        const value = fact.value?.trim();
        if (!key || !value) continue;
        await this.userRelativeProfileService.recordFact({
          userId: message.userId,
          personId: person.id,
          domain: fact.domain as UserRelativeFactDomain,
          key,
          value,
          status: Object.values(UserRelativeFactStatus).includes(
            fact.status as never
          )
            ? fact.status
            : UserRelativeFactStatus.current,
          confidence: UserRelativeFactConfidence.extracted,
          sourceAgentId: message.agentId,
          sourceMessageId: message.id,
          sourceText: text,
          effectiveAt: message.createdAt,
        });
        written += 1;
      }
    }
    return written;
  }

  private async captureExplicitUserBirthday(
    message: MessageEntity,
    sourceText: string
  ): Promise<number> {
    if (QUESTION_OR_NEGATION.test(sourceText)) return 0;
    const match = USER_BIRTH_ASSERTION.exec(sourceText);
    if (!match) return 0;
    const year = this.integer(Number(match[1] || match[4]));
    const month = this.integer(Number(match[2] || match[5]));
    const day = this.integer(Number(match[3] || match[6]));
    if (!month || !day) return 0;
    const lunar = /农历|阴历/u.test(sourceText);
    const eventType = year
      ? PersonTemporalEventType.birth
      : PersonTemporalEventType.birthdayObservance;
    const exactDate =
      year && !lunar
        ? this.parseExactDate(
            `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
              2,
              '0'
            )}`
          )
        : undefined;
    const profile = await this.personTemporalMemoryService.recordExplicitPersonDate(
      {
        message,
        subjectType: PersonTemporalSubjectType.user,
        subjectId: message.userId,
        eventType,
        exactDate,
        year,
        month,
        day,
        calendar: lunar
          ? PersonTemporalCalendar.lunar
          : PersonTemporalCalendar.gregorian,
        rawText: sourceText,
      }
    );
    return profile ? 1 : 0;
  }

  private async extract(sourceText: string): Promise<ExtractedRelativeMemory[]> {
    try {
      const result = await this.openAIService.generateText({
        temperature: 0,
        topP: 0.1,
        reasoningSplit: false,
        maxTokens: 420,
        systemPrompt: [
          '你是独立的账户人物记忆抽取器，不生成聊天回复。只输出JSON。',
          '只抽取用户明确陈述或纠正的现实亲友信息；疑问、否定、猜测、角色虚构不写入。',
          '同一人物输出一项。referenceName是原话中的称呼；正式姓名与昵称分开。',
          '日期只抄原话可确定的年月日，不推测缺失值。健康、成长、教育、工作、照护等写facts。',
          '{"people":[{"referenceName":"","realName":"","aliases":[],"relationToUser":"","lifeStage":"unknown|newborn|infant|toddler|preschool|school_age|adolescent|adult|older_adult","sex":"male|female|unknown","dates":[{"eventType":"birth|expected_birth","date":"YYYY-MM-DD","year":0,"month":0,"day":0,"calendar":"gregorian|lunar|unknown","correction":false}],"facts":[{"domain":"health|growth|education|work|care|relationship|life_event|preference|routine|other","key":"稳定短键","value":"原话事实","status":"current|resolved|historical|uncertain"}]}]}',
        ].join('\n'),
        prompt: `用户原话：${sourceText.slice(0, 1000)}`,
      });
      const raw = result.content?.trim() || '';
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return [];
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        people?: unknown;
      };
      return Array.isArray(parsed.people)
        ? (parsed.people as ExtractedRelativeMemory[])
        : [];
    } catch (error) {
      this.logger.warn(
        '[relative-memory] semantic extraction skipped, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return [];
    }
  }

  private cleanName(value?: string): string | undefined {
    const clean = value?.trim().replace(/[，,。！？!?；;：:、]/g, '');
    return clean && SAFE_NAME.test(clean) ? clean : undefined;
  }

  private cleanLifeStage(
    value?: UserRelativeLifeStage
  ): UserRelativeLifeStage | undefined {
    const values: UserRelativeLifeStage[] = [
      'unknown',
      'newborn',
      'infant',
      'toddler',
      'preschool',
      'school_age',
      'adolescent',
      'adult',
      'older_adult',
    ];
    return values.includes(value as UserRelativeLifeStage) ? value : undefined;
  }

  private cleanSex(value?: UserRelativeSex): UserRelativeSex | undefined {
    return ['male', 'female', 'unknown'].includes(value || '')
      ? value
      : undefined;
  }

  private parseExactDate(value?: string): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return undefined;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
      ? date
      : undefined;
  }

  private integer(value?: number): number | undefined {
    return Number.isInteger(value) && Number(value) > 0
      ? Number(value)
      : undefined;
  }

  private calendar(value?: string): PersonTemporalCalendar {
    return value === 'lunar'
      ? PersonTemporalCalendar.lunar
      : value === 'unknown'
      ? PersonTemporalCalendar.unknown
      : PersonTemporalCalendar.gregorian;
  }
}
