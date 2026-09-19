/**
 * 窄任务提示（修正版，N06）。
 *
 * 三条规则各自独立定义，互不套用：
 *  A. 新建事项（open_event）：具体对象 + 一件具体的事 + 现在还没有结果。
 *  B. 个人日子（calendar）：用户或家属明确说出的某个具体日子，主体可定位。
 *  C. 已有事项更新：只针对 existingItems，依据新消息判 update / resolve / cancel / dismiss。
 *
 * 与上一版的差别：
 *  - 删掉上一版那条把"没有将来动作"一律排除的总规则（它把 B 和 A 里的"结果未知"一起误杀）；
 *  - "不收"清单只作用于 A（新建事项），不作用于 B 和 C；
 *  - 不列词语豁免清单：B 的成立只要求"明确说出的具体日子 + 主体可定位"。
 */
import { ExtractorInputV2 } from './input';

export const NARROW_SYSTEM_PROMPT = `你只做三件事，每件事有自己的定义，互不套用。

A. 新建事项（kind=open_event，action=create）
   成立条件（三条都要满足）：
   1) 有具体对象：用户自己，或原话里明确点名的家人；
   2) 是一件事，不是感受：具体到"做什么/等什么/办什么"；
   3) 这件事现在还没有结果：还没做、正在做、或在等结果。
   注意：句子是情绪或思念，但同一句里说清了一件具体的事，就按这件事收；只说情绪就不收。
   不收：日常流水、稳定人物事实（年龄、排行、已故多年）、只有症状没有就诊用药在跟进的、
   回忆过去、用户没有回答的 AI 提问里的命题。

B. 个人日子（kind=calendar，action=create）
   成立条件（两条都要满足）：
   1) 原话里明确说出了一个具体日子（生日、纪念日、约定日期，含"头七/五七/百天/周年"这类明确的日期说法）；
   2) 主体可定位：是谁的日子。
   不要求"还没发生"，也不做公历换算：时间照原话写法，写进 eventTime.rawText，精度不确定就写 unknown。

C. 已有事项更新（action=update/resolve/cancel/dismiss，必须填 targetItemId）
   只看 existingItems 里已有的条目，用**本次新消息**作依据：
   - 有新进展 → update；有结果或完成 → resolve；取消/不去了 → cancel；用户明确说别再提 → dismiss。
   - 只重申旧话、本次新消息没有新依据的，不要输出更新。
   - 上一段已经了结或用户拒谈的事，不要因为旧话重放而重新激活。

通用要求：
- 主体不确定就写"未知"，不许猜；时间照原话，不推算公历、不编精确日期。
- 每条给真实 messageId 与逐字引文，以及一句≤60字的理由（写具体的事或具体的变化）。
- 没有符合的就输出空数组，不要凑数。
- 只输出指定 JSON。

输出形状：
{"schemaVersion":"return_extract_output_v2","operations":[{"opId":"o1","action":"create|update|resolve|cancel|dismiss|uncertain","targetItemId":null 或已有 itemId,"kind":"open_event|calendar","description":"...","subject":{"sourceLabel":"..."},"phase":"...","evidence":[{"messageId":"...","quote":"..."}],"eventTime":{"rawText":null,"anchorMessageId":null,"precision":"day|week|month|unknown"},"uncertainty":null,"reason":"≤60字"}],"unresolvedReferences":[]}`;

export function buildNarrowPrompt(
  input: ExtractorInputV2,
  existingItems: any[]
): string {
  const payload = {
    now: input.now,
    timezone: input.timezone,
    existingItems: existingItems.map(item => ({
      itemId: item.itemId,
      kind: item.kind,
      subject: item.subject,
      description: item.description,
      state: item.state,
    })),
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
  };
  return `按 A/B/C 三条规则处理这一批（没有符合的就给空 operations）：\n\n${JSON.stringify(
    payload,
    null,
    1
  )}`;
}
