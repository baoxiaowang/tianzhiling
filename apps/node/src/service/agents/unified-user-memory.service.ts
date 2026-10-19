import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { MessageEntity } from '@tzl/entities';
import { OpenAIService } from './openai';
import {
  AgentProfileFactService,
  ExtractProfileFactsBatchEntry,
  ROLE_FACT_EXTRACTION_SYSTEM_PROMPT,
} from './agent-profile-fact.service';
import {
  ExtractedRelativeMemory,
  RelativeMemoryCaptureContext,
  RelativeMemoryExtractorService,
} from './relative-memory-extractor.service';
import {
  ExtractedUserSelfFact,
  shouldExtractUserSelf,
  UserSelfMemoryService,
} from './user-self-memory.service';

export interface UnifiedMemoryBatchEntry {
  message: MessageEntity;
  searchableText: string;
  contextMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface UnifiedMemoryBatchResult {
  agentCountByMessageId: Map<string, number>;
  agentCount: number;
  userCount: number;
  relativeCount: number;
}

/**
 * 合并后的账户记忆抽取器：
 *   - captureBatch：一批消息一次模型调用，返回 agent/user/people 三个命名空间；
 *   - captureFromUserMessage：单条消息一条调用，返回 people/selfFacts。
 *
 * 写入仍复用三个既有服务的落库逻辑（校验、去重、规则兜底、人物解析、
 * 当前角色排除、称谓归属、状态升降级都不重写）。合并提示词失败时由调用方
 * 回退到原来的独立入口，避免整批丢记忆。
 */
@Provide()
export class UnifiedUserMemoryService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  agentProfileFactService: AgentProfileFactService;

  @Inject()
  relativeMemoryExtractorService: RelativeMemoryExtractorService;

  @Inject()
  userSelfMemoryService: UserSelfMemoryService;

  /**
   * 一批用户消息只发一次模型调用，一次返回三类事实。
   * 解析失败/截断返回 null，调用方回退到“角色批量 + 逐条用户侧”的旧路径。
   */
  async captureBatch(
    entries: UnifiedMemoryBatchEntry[]
  ): Promise<UnifiedMemoryBatchResult | null> {
    const prepared = entries
      .map(entry => {
        const text = entry.searchableText?.trim();
        return text ? { ...entry, sourceText: text } : null;
      })
      .filter(
        (entry): entry is UnifiedMemoryBatchEntry & { sourceText: string } =>
          Boolean(entry)
      );
    if (!prepared.length) {
      return {
        agentCountByMessageId: new Map(),
        agentCount: 0,
        userCount: 0,
        relativeCount: 0,
      };
    }
    if (!this.openAIService?.isEnabled?.()) return null;

    // 与旧的批量/逐条入口同口径：三类都不值得调用时，只走规则事实落库，
    // 不为“合并”而发一次空模型请求。
    const worthCalling = prepared.some(
      entry =>
        this.agentProfileFactService?.hasUnifiedExtractionSignal?.(
          entry.sourceText
        ) === true ||
        this.relativeMemoryExtractorService?.shouldExtractRelative?.(
          entry.sourceText
        ) === true ||
        shouldExtractUserSelf(entry.sourceText)
    );
    const parsed = worthCalling
      ? await this.extractBatch(prepared)
      : {
          agentByMessageId: new Map<string, unknown[]>(),
          userByMessageId: new Map<string, ExtractedUserSelfFact[]>(),
          peopleByMessageId: new Map<string, ExtractedRelativeMemory[]>(),
        };
    if (!parsed) return null;

    // 顺序与旧路径一致：先角色事实（会顺带建立 user identity），再人物，再本人。
    const agentResults =
      (await this.agentProfileFactService?.persistUnifiedBatchFacts?.({
        entries: prepared as ExtractProfileFactsBatchEntry[],
        factsByMessageId: parsed.agentByMessageId,
      })) || [];
    const agentCountByMessageId = new Map(
      agentResults.map(result => [result.messageId, result.total])
    );

    let userCount = 0;
    let relativeCount = 0;
    for (const entry of prepared) {
      const messageId = this.stringifyId(entry.message.id);
      const selfFacts = parsed.userByMessageId.get(messageId) || [];
      if (selfFacts.length) {
        userCount +=
          (await this.userSelfMemoryService
            ?.recordPreExtracted?.(entry.message, entry.sourceText, selfFacts)
            .catch(error => {
              this.logger?.warn?.(
                '[unified-user-memory] batch self persist failed, messageId=%s, reason=%s',
                messageId,
                error instanceof Error ? error.message : String(error)
              );
              return 0;
            })) || 0;
      }
      const people = parsed.peopleByMessageId.get(messageId) || [];
      if (people.length) {
        relativeCount +=
          (await this.relativeMemoryExtractorService
            ?.capturePreExtracted?.(entry.message, entry.sourceText, people, {
              contextMessages: entry.contextMessages,
            })
            .catch(error => {
              this.logger?.warn?.(
                '[unified-user-memory] batch relative persist failed, messageId=%s, reason=%s',
                messageId,
                error instanceof Error ? error.message : String(error)
              );
              return 0;
            })) || 0;
      }
    }

    return {
      agentCountByMessageId,
      agentCount: agentResults.reduce((sum, item) => sum + item.total, 0),
      userCount,
      relativeCount,
    };
  }

  async captureFromUserMessage(
    message: MessageEntity,
    sourceText: string,
    context: RelativeMemoryCaptureContext = {}
  ): Promise<number> {
    const text = sourceText?.trim();
    if (!text) return 0;
    const relativeWanted =
      this.relativeMemoryExtractorService?.shouldExtractRelative?.(
        text,
        context
      ) === true;
    const selfWanted = shouldExtractUserSelf(text, context.contextMessages);
    // 两类都不值得调用时直接跳过，不为合并而合并地发一次空请求。
    if (!relativeWanted && !selfWanted) return 0;
    if (!this.openAIService?.isEnabled?.()) return 0;

    const extracted = await this.extract(text, message.createdAt, context);
    if (!extracted) {
      // 合并提示词失败/截断时回退到原来的两条独立入口，避免整条消息丢记忆。
      // 只在真正失败时回退；成功但某一类为空是“本条没有该类事实”，不回退。
      let fallbackWritten = 0;
      if (relativeWanted) {
        fallbackWritten +=
          (await this.relativeMemoryExtractorService
            ?.captureFromUserMessage?.(message, text, context)
            .catch(() => 0)) || 0;
      }
      if (selfWanted) {
        fallbackWritten +=
          (await this.userSelfMemoryService
            ?.extractFromUserMessage?.(message, text, context)
            .catch(() => 0)) || 0;
      }
      return fallbackWritten;
    }

    let written = 0;
    if (relativeWanted && extracted.people.length) {
      written +=
        (await this.relativeMemoryExtractorService
          ?.capturePreExtracted?.(message, text, extracted.people, context)
          .catch(error => {
            this.logger?.warn?.(
              '[unified-user-memory] relative persist failed, reason=%s',
              error instanceof Error ? error.message : String(error)
            );
            return 0;
          })) || 0;
    }
    if (selfWanted && extracted.selfFacts.length) {
      written +=
        (await this.userSelfMemoryService
          ?.recordPreExtracted?.(message, text, extracted.selfFacts)
          .catch(error => {
            this.logger?.warn?.(
              '[unified-user-memory] user self persist failed, reason=%s',
              error instanceof Error ? error.message : String(error)
            );
            return 0;
          })) || 0;
    }
    return written;
  }

  private async extractBatch(
    entries: Array<UnifiedMemoryBatchEntry & { sourceText: string }>
  ): Promise<{
    agentByMessageId: Map<string, unknown[]>;
    userByMessageId: Map<string, ExtractedUserSelfFact[]>;
    peopleByMessageId: Map<string, ExtractedRelativeMemory[]>;
  } | null> {
    const allowedIds = new Set(
      entries.map(entry => this.stringifyId(entry.message.id))
    );
    const payload = entries.map(entry => ({
      messageId: this.stringifyId(entry.message.id),
      text: entry.sourceText,
    }));
    try {
      const result = await this.openAIService.generateMemoryText({
        temperature: 0,
        topP: 0.1,
        reasoningSplit: false,
        maxTokens: Math.min(1000 * entries.length, 6000),
        systemPrompt: this.buildBatchSystemPrompt(),
        prompt: [
          '来源：批量用户消息',
          '逐条独立抽取，不要把不同消息的事实混在一起。',
          '每条事实/每个人物都必须额外带 messageId，取值必须与下面输入中的 messageId 完全一致；无法确定属于哪条消息就不要输出。',
          '只输出一个 JSON 对象：{"agent":[...],"user":[...],"people":[...]}，没有某类就给空数组。',
          `消息列表：${JSON.stringify(payload)}`,
        ].join('\n'),
      });
      if (result.response?.choices?.[0]?.finish_reason === 'length') {
        this.logger?.warn?.(
          '[unified-user-memory] batch output truncated, size=%s',
          entries.length
        );
        return null;
      }
      const raw = result.content?.trim() || '';
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        agent?: unknown;
        user?: unknown;
        people?: unknown;
      };
      if (
        !Array.isArray(parsed.agent) &&
        !Array.isArray(parsed.user) &&
        !Array.isArray(parsed.people)
      ) {
        // 模型仍按旧的裸数组协议输出，视为格式失败，交给调用方回退。
        return null;
      }
      const agentByMessageId = new Map<string, unknown[]>();
      const userByMessageId = new Map<string, ExtractedUserSelfFact[]>();
      const peopleByMessageId = new Map<string, ExtractedRelativeMemory[]>();
      let accepted = 0;
      const accept = <T>(items: unknown, target: Map<string, T[]>): void => {
        if (!Array.isArray(items)) return;
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const messageId = (item as Record<string, unknown>).messageId;
          if (typeof messageId !== 'string' || !allowedIds.has(messageId)) {
            continue;
          }
          const list = target.get(messageId) || [];
          list.push(item as T);
          target.set(messageId, list);
          accepted += 1;
        }
      };
      accept<unknown>(parsed.agent, agentByMessageId);
      accept<ExtractedUserSelfFact>(parsed.user, userByMessageId);
      accept<ExtractedRelativeMemory>(parsed.people, peopleByMessageId);
      const returned =
        (Array.isArray(parsed.agent) ? parsed.agent.length : 0) +
        (Array.isArray(parsed.user) ? parsed.user.length : 0) +
        (Array.isArray(parsed.people) ? parsed.people.length : 0);
      if (returned > 0 && accepted === 0) {
        // 有内容却没有一条带合法 messageId：协议失败，回退而不是静默丢整批。
        return null;
      }
      return { agentByMessageId, userByMessageId, peopleByMessageId };
    } catch (error) {
      this.logger?.warn?.(
        '[unified-user-memory] batch extraction skipped, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }

  private buildBatchSystemPrompt(): string {
    return [
      '你是统一的账户记忆抽取器，一次调用同时抽取三类事实，不生成聊天回复。只输出 JSON 对象。',
      '最终输出协议（最高优先级，覆盖下面各节里关于输出格式的描述）：{"agent":[...],"user":[...],"people":[...]}；每条事实/每个人物都必须带 messageId。没有某类就给空数组。',
      '总规则：只抽取用户明确陈述或纠正的现实信息；疑问、否定、猜测、角色虚构不写入；不根据常识补全；不确定属于谁、属于哪条消息就不输出。',
      '【agent：当前 AI 亲人/逝去亲人角色本人的稳定事实】',
      ROLE_FACT_EXTRACTION_SYSTEM_PROMPT,
      '（上面角色规则里的“输出 JSON 数组/没有事实输出 []”仅表示字段与空值语义，最终仍按本协议输出三数组对象。）',
      '【user：用户本人近况】',
      '只抽取用户明确自述的本人处境：工作、经济、养育、健康、居住、婚姻/家庭状态，以及明确偏好或打算。',
      '不要抽取关于 AI 亲人或其他人的事实；纯情绪、纯思念、寒暄、疑问、猜测、诊断结论、自动待办不写。',
      '不得把“我很难受/我撑不住”升级为疾病诊断；愿望与计划写 status=uncertain，已了结写 resolved，过去写 historical。',
      'user 字段：{"messageId":"","domain":"situation|work|finance|family|health|emotion|preference|plan|other","key":"稳定短键","value":"用户自述","status":"current|resolved|historical|uncertain","occurredAt":""}',
      '【people：用户本人以外的亲友】',
      '同一人物输出一项。referenceName 是原话中的称呼；正式姓名与昵称分开；保留原话称谓，不映射成另一种亲属关系，不自行判断两个称谓是否同一人。',
      'personCallsUser 只在该亲友被明确说明如何称呼用户时填写（如“爸爸叫我湾呐”），它不是当前对话角色对用户的称呼。',
      '每个事实用能区分命题的稳定短键；愿望/计划写 status=uncertain，问句不得写成已发生；未明确说某人已故时不要写已故事实。',
      '明确离世写 life_event.deceased（status=historical，必须绑定原话指明的那个人）；明确离婚/断联写 relationship.divorced 或 relationship.no_contact；独居写 routine.live_alone；长期异地写 work.long_distance（后三者 status=current）。',
      '日期只抄原话可确定的年月日；occurredAt 只在原话给出完整日期(YYYY-MM-DD)时填写，不把消息时间当事件时间。',
      'people 字段：{"messageId":"","referenceName":"","realName":"","aliases":[],"personCallsUser":"","relationToUser":"","lifeStage":"unknown|newborn|infant|toddler|preschool|school_age|adolescent|adult|older_adult","sex":"male|female|unknown","dates":[{"eventType":"birth|expected_birth|death","date":"YYYY-MM-DD","year":0,"month":0,"day":0,"calendar":"gregorian|lunar|unknown","correction":false}],"facts":[{"domain":"health|growth|education|work|care|relationship|life_event|preference|routine|other","key":"稳定短键","value":"原话事实","status":"current|resolved|historical|uncertain","occurredAt":""}]}',
    ].join('\n');
  }

  private stringifyId(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    const withToString = value as { toString?: () => string };
    return typeof withToString.toString === 'function'
      ? withToString.toString()
      : String(value);
  }

  private async extract(
    sourceText: string,
    referenceAt: Date | undefined,
    context: RelativeMemoryCaptureContext
  ): Promise<{
    people: ExtractedRelativeMemory[];
    selfFacts: ExtractedUserSelfFact[];
  } | null> {
    try {
      const result = await this.openAIService.generateMemoryText({
        temperature: 0,
        topP: 0.1,
        reasoningSplit: false,
        maxTokens: 900,
        systemPrompt: [
          '你是账户记忆抽取器，一次调用同时抽取“用户本人近况”和“用户的其他亲友”。不生成聊天回复，只输出JSON对象。',
          '总规则：只抽取用户明确陈述或纠正的现实信息；疑问、否定、猜测、角色虚构不写入；不根据常识补全。',
          '输出结构：{"people":[...],"selfFacts":[...]}，没有某类就给空数组。',
          '【people：用户本人以外的亲友】',
          '同一人物输出一项。referenceName是原话中的称呼；正式姓名与昵称分开。保留用户原话中的称谓，不要映射成另一种亲属关系（如把“大爸爸/二爸/幺爹”改成父亲/叔叔），也不要自行判断两个称谓是否同一人（如“婆婆”和“奶奶”未明确证实不得合并）。',
          'personCallsUser只在该亲友被明确说明如何称呼用户时填写（如“爸爸叫我湾呐”），它绝不是当前对话角色对用户的称呼。',
          '每个事实用能区分命题的稳定短键（如work.pension、growth.school），不同事实不得共用同一个key互相覆盖。',
          '愿望与计划写status=uncertain并保留原意；“团聚/重逢”类问句不得写成已经团聚；未明确说某人已故时不要写成已故事实。',
          '明确离世写life_event.deceased（status=historical，必须绑定原话指明的那个人）；明确离婚/断联写relationship.divorced或relationship.no_contact；目前独居写routine.live_alone；长期异地写work.long_distance（后三者status=current）。',
          '日期只抄原话可确定的年月日，不推测缺失值；occurredAt只在原话给出完整日期(YYYY-MM-DD)时填写，不把消息时间当事件时间。',
          'people字段：{"referenceName":"","realName":"","aliases":[],"personCallsUser":"","relationToUser":"","lifeStage":"unknown|newborn|infant|toddler|preschool|school_age|adolescent|adult|older_adult","sex":"male|female|unknown","dates":[{"eventType":"birth|expected_birth|death","date":"YYYY-MM-DD","year":0,"month":0,"day":0,"calendar":"gregorian|lunar|unknown","correction":false}],"facts":[{"domain":"health|growth|education|work|care|relationship|life_event|preference|routine|other","key":"稳定短键","value":"原话事实","status":"current|resolved|historical|uncertain","occurredAt":""}]}',
          '【selfFacts：用户本人近况】',
          '只抽取用户在本条消息中明确自述的本人处境：工作、经济、养育、健康、居住、婚姻/家庭状态，以及明确偏好或打算。',
          '不要抽取关于AI亲人或其他人的事实；纯情绪、纯思念、寒暄、疑问、猜测、诊断结论、自动待办不写。',
          '不得把“我很难受/我撑不住”升级为疾病诊断，只保留为用户自述原意。',
          '愿望与计划写status=uncertain；已了结写resolved；过去的事写historical；其余current。',
          'selfFacts字段：{"domain":"situation|work|finance|family|health|emotion|preference|plan|other","key":"稳定短键","value":"用户自述","status":"current|resolved|historical|uncertain","occurredAt":""}',
          context.messengerParent
            ? '这是小使者访谈。指定AI亲人本人的事实由另一个存储器负责，people中必须排除该人，只抽取用户本人以外的其他亲友。'
            : context.boundAgent
            ? '本次对话对象是当前AI亲人本人，它不属于用户的其他亲友，people中必须排除；只抽取用户本人以外的其他亲友。'
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        prompt: [
          context.messengerParent
            ? `需排除的指定AI亲人：${[
                context.messengerParent.name,
                context.messengerParent.realName,
                context.messengerParent.iCallAgent,
              ]
                .filter(Boolean)
                .join('、')}`
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
      if (result.response?.choices?.[0]?.finish_reason === 'length') {
        this.logger?.warn?.('[unified-user-memory] output truncated');
        return null;
      }
      const raw = result.content?.trim() || '';
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(raw.slice(start, end + 1)) as {
        people?: unknown;
        selfFacts?: unknown;
      };
      return {
        people: Array.isArray(parsed.people)
          ? (parsed.people as ExtractedRelativeMemory[])
          : [],
        selfFacts: Array.isArray(parsed.selfFacts)
          ? (parsed.selfFacts as ExtractedUserSelfFact[])
          : [],
      };
    } catch (error) {
      this.logger?.warn?.(
        '[unified-user-memory] semantic extraction skipped, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }
}
