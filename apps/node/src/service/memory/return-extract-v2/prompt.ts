/**
 * R02 候选：一次调用的新抽取契约（提示 + 逻辑输出协议）。
 *
 * 与前一轮的差别：
 * - 任务是"挑出以后值得记着的少数具体事情，并按新消息更新已有事情"，不再只收"还没做/没结果"的事件；
 *   明确加入 meaningful_update（有分量的近况）与 calendar（明确的日子）。
 * - 输出是 operations：create/update/resolve/cancel/dismiss/uncertain，带 targetItemId，
 *   解决"完成/取消/拒谈无法表达"的协议缺口。
 * - 每条操作带证据（messageId + 逐字引文）与一句理由；不确定就标 uncertain，不猜主体/日期。
 */
import { ExtractorInputV2 } from './input';

export const RETURN_EXTRACT_V2_VERSION = 'return_extract_output_v2' as const;

const ENUM_BLOCK = `字段取值（只能从这里选）：
- action：create（新增一件事）、update（同一件事有新进展）、resolve（已有结果/完成）、cancel（取消/不去了）、dismiss（用户明确拒谈）、uncertain（拿不准，先留着不主动用）
- kind：open_event（有对象和变化过程、还在进行或结果未知）、meaningful_update（有分量的近况/阶段结果，不一定还有待办）、calendar（明确的生日/纪念日/约定日期）
- eventTime.precision：day / week / month / unknown
- 新建必须 action=create 且 targetItemId=null；更新/完成/取消/拒谈必须填已有事项的 itemId。`;

export const RETURN_EXTRACT_SYSTEM_PROMPT = `你整理的是同一用户与同一聊天对象的一段对话。请找出少数以后值得记着的具体事情，并根据新消息更新已有事情。你不决定下次聊天必须问什么。

阅读时注意：
- 消息按时间排列，旧会话与当前会话分开。事件时间以那条原话的时间为参照。
- 用户原话是事实来源；AI 的话只提供语境，除非用户明确确认，不能当作事实。
- 碎片消息可以合起来理解，但引用分别保留，不拼造一段"用户原话"。
- 先看新消息是否更正、完成、取消或拒绝谈已有事项，再考虑新增。
- 明确未完的事情、用户在意的重要近况、明确的日子分别输出。
- meaningful_update 只能是"生活确实发生了变化、并且用户明显在意"的具体事情（例如升学/录取、搬家、工作变动、身体出结果、亲人离世这样的阶段节点）。
  只是表达思念、难过、哭泣、做梦、烧纸、托梦祝福，都不算 meaningful_update，不要输出。
- 日常流水、单独的思念和没有具体事件的情绪不新增；宁可少收，不要强行填满数量。
- 同一句话只输出一个操作；同一件事不要既 create 又当 update。
- 完成不是一律丢弃：更新阶段，不能把已有结果仍记为等待结果。
- 不能确定是谁、什么时候、是否同一件事时标明未知，不补全猜测。

只输出指定 JSON。每个操作附真实消息 ID 与精确引文，并给一句简短保留/更新理由。

${ENUM_BLOCK}`;

const EXAMPLE_BLOCK = `示例（合成，仅示范输出形状）：
输入片段：
  [s1] 用户 2026-01-05: 我后天带我爸去医院做检查
  [s2] 用户 2026-01-06: 检查做完了，医生说下周三还要复查一次
  [s3] AI   2026-01-06: 那你姐陪你去的吗？
  [s4] 用户 2026-01-06: 别提这事了
已有事项：
  {"itemId":"i1","kind":"open_event","subject":"爸爸","description":"爸爸要去医院做检查","state":"awaiting_result"}
期望输出：
{"schemaVersion":"return_extract_output_v2","operations":[
 {"opId":"o1","action":"update","targetItemId":"i1","kind":"open_event","description":"爸爸检查已完成，下周三还要复查","subject":{"sourceLabel":"爸爸"},"phase":"已完成检查，等待复查","evidence":[{"messageId":"s2","quote":"检查做完了，医生说下周三还要复查一次"}],"eventTime":{"rawText":"下周三","anchorMessageId":"s2","precision":"week"},"uncertainty":null,"reason":"同一件事的新进展，保留后续复查"},
 {"opId":"o2","action":"dismiss","targetItemId":"i1","kind":"open_event","description":"用户要求别再提这件事","subject":{"sourceLabel":"爸爸"},"phase":null,"evidence":[{"messageId":"s4","quote":"别提这事了"}],"eventTime":{"rawText":null,"anchorMessageId":null,"precision":"unknown"},"uncertainty":null,"reason":"用户明确拒谈"},
 {"opId":"o3","action":"create","targetItemId":null,"kind":"meaningful_update","description":"用户父亲检查结果正常，家人松了口气","subject":{"sourceLabel":"爸爸"},"phase":"已出结果","evidence":[{"messageId":"s2","quote":"检查做完了"}],"eventTime":{"rawText":null,"anchorMessageId":"s2","precision":"unknown"},"uncertainty":null,"reason":"有分量的近况，后续可承接"}],
 "unresolvedReferences":[]}
注意：s3 是 AI 的提问、用户没有回答，所以不能记"姐姐陪同"。

反例（这些都不输出任何操作）：
输入片段：
  [t1] 用户 2026-01-07: 我好想你，今天又哭了
  [t2] 用户 2026-01-07: 今天吃面，准备洗澡睡觉了
  [t3] 用户 2026-01-07: 晚上给你烧点纸，你要收得到
期望输出：
{"schemaVersion":"return_extract_output_v2","operations":[],"unresolvedReferences":[]}`;

export function buildV2Prompt(
  input: ExtractorInputV2,
  existingItems: Array<{
    itemId: string;
    kind: string;
    subject: string;
    description: string;
    state: string;
    lastEvidenceAt?: string;
  }>
): string {
  const payload = {
    schemaVersion: 'return_extract_input_v2',
    now: input.now,
    timezone: input.timezone,
    existingItems: existingItems.map(item => ({
      itemId: item.itemId,
      kind: item.kind,
      subject: item.subject,
      description: item.description,
      state: item.state,
      ...(item.lastEvidenceAt ? { lastEvidenceAt: item.lastEvidenceAt } : {}),
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
  return `${EXAMPLE_BLOCK}

现在处理这一批（严格按上面的形状输出 JSON，operations 可以为空数组）：

${JSON.stringify(payload, null, 1)}`;
}
