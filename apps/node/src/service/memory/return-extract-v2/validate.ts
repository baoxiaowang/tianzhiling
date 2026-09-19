/**
 * R01 候选：忠实校验器（协议仍为 v1 的 items 形式，修的是"程序把正确输出改错/删掉"）。
 *
 * 与现有解析器的差异（每条都在 R00 里有证据）：
 * 1) 不再用"去标点后 ≥8 字"硬删；短引文保留并标记 shortQuote。
 * 2) 不再要求"人/时间标记"否则删；改为标记 weakAnchor。
 * 3) 过去/完成、只有症状不再是删除理由，改为标记 pastSignal / symptomOnly 交给下游判断。
 * 4) 引文与声明的 messageId 不符时：拒绝（source_mismatch），不搜索同文别条、不替换成整句原文。
 * 5) 超过上限不再静默丢弃：返回 truncated 与 droppedItems。
 * 6) 拒绝原因按固定顺序只报最先命中的结构性原因，避免归错类。
 */
import {
  OPEN_ITEM_TOPIC_KEYS,
  type OpenItemCandidate,
} from '../memory-open-item-extraction';

export interface StrictCandidate extends OpenItemCandidate {
  flags: string[];
  /** 该 quote 在原文里的精确片段（规范化匹配时回填原文，保证证据逐字可查）。 */
  verbatimQuote: string;
  normalizedMatch: boolean;
}

export interface StrictParseResult {
  candidates: StrictCandidate[];
  rejected: Array<{
    reason: string;
    quote?: string;
    declaredMessageId?: string;
  }>;
  truncated: boolean;
  droppedItems: number;
  rawItemCount: number;
}

const MAX_CANDIDATES = 4;

function normalize(value: string): string {
  return (value || '')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/** 在原文里找出与 quote 规范化后一致的最长片段（用于回填逐字证据）。 */
function locateVerbatim(content: string, quote: string): string | undefined {
  if (!content || !quote) return undefined;
  if (content.includes(quote)) return quote;
  const target = normalize(quote);
  if (!target) return undefined;
  // 逐字符滑窗：允许原文里有空白/标点差异
  const chars = Array.from(content);
  const keep: Array<{ char: string; index: number }> = [];
  chars.forEach((char, index) => {
    if (/[\p{Script=Han}\p{L}\p{N}]/u.test(char))
      keep.push({ char: char.toLowerCase(), index });
  });
  const compact = keep.map(item => item.char).join('');
  const start = compact.indexOf(target);
  if (start === -1) return undefined;
  const end = start + target.length - 1;
  return content.slice(keep[start].index, keep[end].index + 1);
}

export function parseExtractionOutputStrict(
  rawContent: string,
  messages: Array<{ messageId: string; content: string }>
): StrictParseResult {
  const rejected: StrictParseResult['rejected'] = [];
  const candidates: StrictCandidate[] = [];
  let truncated = false;
  let droppedItems = 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      (rawContent || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/u, '')
    );
  } catch {
    return {
      candidates,
      rejected: [{ reason: 'invalid_json' }],
      truncated,
      droppedItems,
      rawItemCount: 0,
    };
  }
  const items = Array.isArray((parsed as { items?: unknown[] })?.items)
    ? ((parsed as { items: unknown[] }).items as unknown[])
    : [];
  if (!Array.isArray((parsed as { items?: unknown[] })?.items)) {
    return {
      candidates,
      rejected: [{ reason: 'missing_items' }],
      truncated,
      droppedItems,
      rawItemCount: 0,
    };
  }
  const allowedTopics: string[] = [...OPEN_ITEM_TOPIC_KEYS];
  const byId = new Map(messages.map(message => [message.messageId, message]));

  for (const item of items) {
    const record = (item || {}) as Record<string, unknown>;
    const quote = String(record.quote || '').trim();
    const declared = String(record.messageId || '').trim();
    const topicKey = String(record.topicKey || '').trim();
    const state = String(record.state || '').trim();

    if (!quote) {
      rejected.push({ reason: 'missing_quote', declaredMessageId: declared });
      continue;
    }
    if (allowedTopics.indexOf(topicKey) === -1) {
      rejected.push({
        reason: 'topic_not_allowed',
        quote,
        declaredMessageId: declared,
      });
      continue;
    }
    if (state !== 'awaiting_result' && state !== 'action_committed') {
      rejected.push({
        reason: 'state_not_expressible_in_v1',
        quote,
        declaredMessageId: declared,
      });
      continue;
    }
    const declaredMessage = byId.get(declared);
    if (!declaredMessage) {
      rejected.push({
        reason: 'unknown_declared_message',
        quote,
        declaredMessageId: declared,
      });
      continue;
    }
    const verbatim = locateVerbatim(declaredMessage.content, quote);
    if (!verbatim) {
      // 关键修复：不在别条消息里搜索同文，也不替换成整句原文
      rejected.push({
        reason: 'source_mismatch',
        quote,
        declaredMessageId: declared,
      });
      continue;
    }

    const flags: string[] = [];
    if (normalize(quote).length < 8) flags.push('shortQuote');
    if (!/[\p{Script=Han}\p{L}\p{N}]/u.test(quote)) flags.push('noContent');
    if (/去年|以前|那时候|当年|小时候/u.test(quote)) flags.push('pastSignal');
    if (/做完|做完了|已经|结果出来|没事了|取消/u.test(quote))
      flags.push('completionSignal');
    const importanceRaw = Number(record.importance);
    candidates.push({
      messageId: declared,
      quote: verbatim,
      topicKey: topicKey as OpenItemCandidate['topicKey'],
      state: state as OpenItemCandidate['state'],
      importance: (importanceRaw === 3 ? 3 : importanceRaw === 1 ? 1 : 2) as
        | 1
        | 2
        | 3,
      ...(record.dueHint
        ? { dueHint: String(record.dueHint).slice(0, 20) }
        : {}),
      ...(record.subjectRef
        ? { subjectRef: String(record.subjectRef).slice(0, 20) }
        : {}),
      flags,
      verbatimQuote: verbatim,
      normalizedMatch: verbatim !== quote,
    });
  }

  if (candidates.length > MAX_CANDIDATES) {
    truncated = true;
    droppedItems = candidates.length - MAX_CANDIDATES;
  }
  const kept = candidates.slice(0, MAX_CANDIDATES);
  droppedItems += candidates.length - kept.length > 0 ? 0 : 0;
  return {
    candidates: kept,
    rejected,
    truncated,
    droppedItems: truncated ? droppedItems : 0,
    rawItemCount: items.length,
  };
}
