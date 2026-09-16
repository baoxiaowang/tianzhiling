import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
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
import { isSearchableDialogueEvidence, kinshipTermsIn } from './memory-value';
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
const MESSENGER_FAMILY_SIGNAL =
  /(?:爸爸|妈妈|父亲|母亲|爸|妈|哥哥|姐姐|弟弟|妹妹|丈夫|妻子|老公|老婆|爷爷|奶奶|外公|外婆|儿子|女儿|孩子|宝宝|孙子|孙女|外孙|外孙女)/;
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
    eventType?: 'birth' | 'expected_birth' | 'death';
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
    /** 事件发生时间（只在原话给出可确定的完整日期时填写），与来源消息时间分开。 */
    occurredAt?: string;
  }>;
}

interface RelativeMemoryCaptureContext {
  messengerParent?: AgentEntity;
  /** 普通对话里与用户对话的当前 AI 亲人本身；它不算用户的“其他亲友”，需排除。 */
  boundAgent?: AgentEntity;
  contextMessages?: Array<{
    role: 'user' | 'assistant';
    content: string;
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

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  async captureFromUserMessage(
    message: MessageEntity,
    sourceText: string,
    context: RelativeMemoryCaptureContext = {}
  ): Promise<number> {
    const text = sourceText?.trim();
    if (!text) return 0;
    let written = await this.captureExplicitUserBirthday(message, text);
    const namedDetail = NAMED_RELATIVE_DETAIL_SIGNAL.exec(text)?.[1];
    const hasNamedRelativeDetail = Boolean(
      namedDetail &&
        !/^(?:我|我的|本人|自己|你|你的|他|她|他们|她们)/u.test(namedDetail)
    );
    const messengerInterview = Boolean(context.messengerParent);
    // 召回优先的最小入口：只要原话出现已知亲属称谓且该句本身是对话证据，
    // 就把这条消息交给模型判断（是否亲友、什么关系、哪些事实）。这里只决定
    // “要不要调模型”，不用关键词决定事实内容；是否成立仍由模型判断。
    // 这一条补齐了“妈妈…打工”“回家看妈”这类不含“我+亲属+细节”的漏召回。
    const hasKinshipSubject =
      kinshipTermsIn(text).length > 0 && isSearchableDialogueEvidence(text);
    if (
      !(
        RELATIVE_SUBJECT_SIGNAL.test(text) && RELATIVE_DETAIL_SIGNAL.test(text)
      ) &&
      !hasNamedRelativeDetail &&
      !hasKinshipSubject &&
      !(messengerInterview && MESSENGER_FAMILY_SIGNAL.test(text))
    ) {
      return written;
    }
    if (!this.openAIService?.isEnabled?.()) return written;

    // 只有走到这里（已确认值得调模型）才解析当前对话对象，用于排除它自己。
    const boundAgent = context.messengerParent
      ? undefined
      : context.boundAgent || (await this.resolveBoundAgent(message));
    const excludedParentReferences = this.parentReferences(
      context.messengerParent || boundAgent
    );
    const extracted = await this.extract(
      text,
      { ...context, boundAgent },
      message.createdAt
    );
    for (const item of extracted.slice(0, 4)) {
      const relation = item.relationToUser?.trim();
      if (!relation || !isRelativeRelation(relation)) continue;
      const realName = this.cleanName(item.realName);
      const aliases = (item.aliases || [])
        .map(value => this.cleanName(value))
        .filter((value): value is string =>
          Boolean(value && value !== realName)
        )
        .slice(0, 8);
      const referenceName = this.cleanName(item.referenceName);
      if (
        excludedParentReferences.length > 0 &&
        this.isMessengerParent(
          { referenceName, realName, relation },
          excludedParentReferences
        )
      ) {
        continue;
      }

      const linkedAgentId = context.messengerParent
        ? await this.resolveUniqueLinkedAgent(
            message,
            context.messengerParent,
            [referenceName, realName, relation, ...aliases].filter(
              (value): value is string => Boolean(value)
            )
          )
        : undefined;

      let person =
        await this.userIdentityMemoryService.resolveKnownPersonReference({
          userId: message.userId,
          referenceName,
          relationToUser: relation,
        });
      const relationCount =
        !person && !realName && !aliases.length
          ? await this.userIdentityMemoryService.countKnownPeopleByRelation(
              message.userId,
              relation
            )
          : 0;
      if (person && linkedAgentId && !person.linkedAgentId) {
        person =
          await this.userIdentityMemoryService.upsertKnownPersonDeclaration({
            userId: message.userId,
            agentId: message.agentId,
            messageId: message.id,
            sourceText: text,
            declaration: {
              identityKey: '',
              realName: realName || person.realName,
              aliases,
              relationToUser: relation,
              linkedAgentId,
            },
          });
      }
      if (
        !person &&
        (realName || aliases.length || relationCount === 0 || linkedAgentId)
      ) {
        const declaration: KnownPersonDeclaration = {
          identityKey: '',
          realName,
          aliases,
          relationToUser: relation,
          linkedAgentId,
        };
        person =
          await this.userIdentityMemoryService.upsertKnownPersonDeclaration({
            userId: message.userId,
            agentId: message.agentId,
            messageId: message.id,
            sourceText: text,
            declaration,
          });
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
          dateFact.eventType === 'death'
            ? PersonTemporalEventType.death
            : dateFact.eventType === 'expected_birth'
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
        const profile =
          await this.personTemporalMemoryService.recordExplicitPersonDate({
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
          });
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
        if (
          !Object.values(UserRelativeFactDomain).includes(fact.domain as never)
        ) {
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
          // 来源时间=消息发生时间；事件时间另填 occurredAt（可确定时）。
          effectiveAt: message.createdAt,
          occurredAt: this.parseExactDate(fact.occurredAt),
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
    const profile =
      await this.personTemporalMemoryService.recordExplicitPersonDate({
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
      });
    return profile ? 1 : 0;
  }

  private async extract(
    sourceText: string,
    context: RelativeMemoryCaptureContext,
    referenceAt?: Date
  ): Promise<ExtractedRelativeMemory[]> {
    try {
      const result = await this.openAIService.generateText({
        temperature: 0,
        topP: 0.1,
        reasoningSplit: false,
        maxTokens: 420,
        systemPrompt: [
          '你是独立的账户人物记忆抽取器，不生成聊天回复。只输出JSON。',
          '只抽取用户明确陈述或纠正的现实亲友信息；疑问、否定、猜测、角色虚构不写入。',
          context.messengerParent
            ? '这是小使者访谈。指定AI亲人本人的事实由另一个存储器负责，本次people中必须排除该人，只抽取用户本人以外的其他亲友。'
            : context.boundAgent
            ? '本次对话对象是当前AI亲人本人，它不属于用户的其他亲友，必须排除；只抽取用户本人以外的其他亲友。'
            : '',
          '只抽取用户本人以外的亲友；不要抽取用户本人的处境（工作、收入、养育、健康、情绪）。',
          '同一人物输出一项。referenceName是原话中的称呼；正式姓名与昵称分开。保留用户在原话中的称谓，不要把它映射成另一种亲属关系（如把“大爸爸/二爸/幺爹”改成父亲/叔叔），也不要判断多个称谓是否同一人。',
          '同一人物可有多个事实，按命题分别放入facts；每个事实用能区分命题的稳定短键（如work.pension、work.busy、plan.mid_autumn_visit），不同事实不得共用同一个key互相覆盖。',
          '疑问、否定、假设、祈愿不写成已发生的事实；愿望与计划写status=uncertain并保留原意。“团聚/重逢”类问句不得写成已经团聚；关系称谓本身若明确可记，但未明确说某人已故时不要写成已故事实。',
          '日期只抄原话可确定的年月日，不推测缺失值。不能形成结构化日期的模糊离世时间，可作为life_event事实保留原意。',
          'occurredAt只在原话给出可确定的完整日期(YYYY-MM-DD)时填写，表示事件发生时间；不要把消息时间当作事件时间。健康、成长、教育、工作、照护等写facts。',
          '{"people":[{"referenceName":"","realName":"","aliases":[],"relationToUser":"","lifeStage":"unknown|newborn|infant|toddler|preschool|school_age|adolescent|adult|older_adult","sex":"male|female|unknown","dates":[{"eventType":"birth|expected_birth|death","date":"YYYY-MM-DD","year":0,"month":0,"day":0,"calendar":"gregorian|lunar|unknown","correction":false}],"facts":[{"domain":"health|growth|education|work|care|relationship|life_event|preference|routine|other","key":"稳定短键","value":"原话事实","status":"current|resolved|historical|uncertain","occurredAt":""}]}]}',
        ].join('\n'),
        prompt: [
          context.messengerParent
            ? `需排除的指定AI亲人：${this.parentReferences(
                context.messengerParent
              ).join('、')}`
            : '',
          `参考时间（消息发生时间）：${referenceAt?.toISOString?.() || ''}`,
          context.contextMessages?.length
            ? `最近连续对话（只用于解析指代，不当作事实）：${JSON.stringify(
                context.contextMessages.slice(-8).map(item => ({
                  role: item.role,
                  content: item.content.slice(0, 200),
                }))
              )}`
            : '',
          `用户原话：${sourceText.slice(0, 1000)}`,
        ]
          .filter(Boolean)
          .join('\n'),
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

  private async resolveBoundAgent(
    message: MessageEntity
  ): Promise<AgentEntity | undefined> {
    if (!this.agentModel?.findOne) return undefined;
    return (
      (await this.agentModel.findOne({
        where: { _id: message.agentId } as never,
      })) || undefined
    );
  }

  private parentReferences(parent?: AgentEntity): string[] {
    if (!parent) return [];
    return Array.from(
      new Set(
        [parent.name, parent.realName, parent.iCallAgent]
          .map(value => this.cleanName(value))
          .filter((value): value is string => Boolean(value))
      )
    );
  }

  private isMessengerParent(
    item: {
      referenceName?: string;
      realName?: string;
      relation?: string;
    },
    parentReferences: string[]
  ): boolean {
    return [item.referenceName, item.realName, item.relation]
      .filter((value): value is string => Boolean(value))
      .some(value => parentReferences.includes(value));
  }

  private async resolveUniqueLinkedAgent(
    message: MessageEntity,
    parent: AgentEntity,
    references: string[]
  ): Promise<AgentEntity['id'] | undefined> {
    if (!this.agentModel?.find || !references.length) return undefined;
    const normalized = new Set(references.map(value => value.toLowerCase()));
    const agents = await this.agentModel.find({
      where: {
        createdUserId: message.userId,
        status: 1,
        messengerOfAgentId: { $exists: false },
      } as never,
      take: 32,
    });
    const matches = agents.filter(agent => {
      if (agent.id.toString() === parent.id.toString()) return false;
      return [agent.name, agent.realName, agent.iCallAgent]
        .map(value => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
        .some(value => normalized.has(value));
    });
    return matches.length === 1 ? matches[0].id : undefined;
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
