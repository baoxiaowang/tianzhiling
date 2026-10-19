import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { MessageEntity } from '@tzl/entities';
import { OpenAIService } from './openai';
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

/**
 * 合并后的“用户侧”记忆抽取器：一次模型调用同时返回
 *   - people：用户的其他亲友（原 relative-memory-extractor）
 *   - selfFacts：用户本人近况（原 user-self-memory）
 *
 * 为什么只合并这两类：它们都以“每条用户消息”为节奏、主体都是用户侧，
 * 原先要连发两次固定提示。角色事实（agent）走的是按批一次的
 * agent-profile-fact 批量入口，把它塞进逐条调用会把每批 1 次变成 N 次，
 * 反而更贵，所以保持按批。
 *
 * 这里只做“一次调用 + 解析”，写入仍复用两个既有服务的落库逻辑
 * （人物解析、当前角色排除、称谓归属、状态升降级都不重写）。
 */
@Provide()
export class UnifiedUserMemoryService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  relativeMemoryExtractorService: RelativeMemoryExtractorService;

  @Inject()
  userSelfMemoryService: UserSelfMemoryService;

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
