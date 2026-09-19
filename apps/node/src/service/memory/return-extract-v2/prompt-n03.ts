/**
 * N03 候选：小规模"保留判定"对照用的提示。
 * B：同模型一次调用，把"有分量且在意"换成**可检验的事件描述**；
 * C：同模型两步——先找候选，再拿完整原文 + 候选 + existingItems 复核保留类型与操作（最终输出归第二步）。
 */
import { ExtractorInputV2 } from './input';

export const CONCRETE_SYSTEM_PROMPT = `你整理的是同一用户与同一聊天对象的一段对话。请找出少数以后值得记着的具体事情，并根据新消息更新已有事情。你不决定下次聊天必须问什么。

保留判定必须写成**可检验的事件描述**，每条都要能回答：
- 谁/什么对象（不确定就写"未知"，不许猜）；
- 发生/计划/改变了什么（具体事，不是感受）；
- 何时说（用哪条消息为据）、当前阶段、还未知什么；
- 由哪一句支持（逐字引文）；
- 保留理由只能是"具体变化或明确安排"，不能写"用户很难过/这很重要"。

类别：
- open_event：有对象和变化过程，明确计划/进行中/结果未知，后续可延续；
- meaningful_update：生活确实发生变化、用户明显在意的阶段结果（例如升学、搬家、工作变动、身体出结果、亲人离世这样的节点）；**默认只作影子记录，不当待办、不用于主动追问**；
- calendar：主体可定位的生日/纪念日/约定日期（明确个人日子；公共节日本身不算）。

判断尺度（务必按这个尺度，不要一刀切）：
- 情感重要性不等主动跟进价值：对逝者表达想念、希望收到纸钱、托梦祈愿、逐日计数离世天数、公共祭祀节日的笼统提及，通常不新增；
- 但祭扫/探望的具体出行安排可以是 open_event；明确的个人纪念日可以是 calendar；
- 日常流水、稳定人物事实（年龄/排行/已故多年）、纯症状（无就诊用药跟进）不新增；
- 已完成的不是一律丢弃：有后续安排就要更新阶段；不要继续记为"等结果"。
- 不能确定是谁、什么时候、是否同一件事时标明未知；不确定就 action=uncertain，不补全猜测。

只输出指定 JSON。每个操作附真实消息 ID 与精确引文，并给一句简短理由。`;

export const DISCOVERY_SYSTEM_PROMPT = `你是抽取流水线的第一步：只负责从这段对话里**尽量全地找出候选事件**，不要决定最终保留。
对每个候选给出：类别倾向（open_event/meaningful_update/calendar/不确定）、一句话事件、支持它的原话引文、以及"怀疑点"（主体不明/时间不明/可能只是情绪）。
宁可多列候选，也不要漏掉可能的明确安排、阶段结果、个人日子；但不要把同一件事拆成多条。
只输出 JSON：{"candidates":[{"candidateId":"c1","kindHint":"open_event|meaningful_update|calendar|uncertain","description":"...","messageId":"...","quote":"...","doubt":"..."}]}`;

export const REVIEW_SYSTEM_PROMPT = `你是抽取流水线的第二步，也是最终输出所有者。你会拿到：完整原文（按会话分段）、第一步给出的候选（可能漏、可能错）、已有事项。
请核对每个候选的类别、主体、阶段、时间与保留价值，**删掉不该保留的、合并重复的、补上第一步漏掉的**，最后只输出一次最终结果。
判据与"可检验的事件描述"要求同下；不确定就标 uncertain 或标未知，不猜。
类别：open_event（计划/进行中/结果未知）、meaningful_update（生活确实变化且用户在意的阶段结果，默认影子）、calendar（明确的个人日子）。
情感重要性不等于主动跟进价值：以思念/哭泣/托梦/烧纸愿望/逐日计数/公共节日笼统提及为主的，不新增；祭扫探望的具体出行安排可以是 open_event。`;

const SHAPE = `输出 JSON 形状：
{"schemaVersion":"return_extract_output_v2","operations":[{"opId":"o1","action":"create|update|resolve|cancel|dismiss|uncertain","targetItemId":null 或已有 itemId,"kind":"open_event|meaningful_update|calendar","description":"...","subject":{"sourceLabel":"..."},"phase":"...","evidence":[{"messageId":"...","quote":"..."}],"eventTime":{"rawText":null,"anchorMessageId":null,"precision":"day|week|month|unknown"},"uncertainty":null,"reason":"≤60字的具体变化或明确安排"}],"unresolvedReferences":[]}`;

function renderInput(input: ExtractorInputV2, existingItems: any[]): string {
  return JSON.stringify(
    {
      now: input.now,
      timezone: input.timezone,
      existingItems,
      segments: input.segments.map(segment => ({
        period: segment.period,
        messages: segment.messages.map(message => ({
          messageId: message.id,
          role: message.role,
          occurredAt: message.occurredAt,
          content: message.content,
        })),
      })),
      coverage: input.coverage,
    },
    null,
    1
  );
}

export function buildConcretePrompt(
  input: ExtractorInputV2,
  existingItems: any[]
): string {
  return `按上面要求处理这一批（operations 可以为空数组）：\n\n${renderInput(
    input,
    existingItems
  )}\n\n${SHAPE}`;
}

export function buildDiscoveryPrompt(
  input: ExtractorInputV2,
  existingItems: any[]
): string {
  return `先找候选（不要输出最终操作）：\n\n${renderInput(
    input,
    existingItems
  )}`;
}

export function buildReviewPrompt(options: {
  input: ExtractorInputV2;
  existingItems: any[];
  candidates: unknown;
}): string {
  return `第一步的候选（可能漏、可能错）：\n${JSON.stringify(
    options.candidates
  )}\n\n完整原文与已有事项：\n${renderInput(
    options.input,
    options.existingItems
  )}\n\n请核对并给出最终结果。${SHAPE}`;
}
