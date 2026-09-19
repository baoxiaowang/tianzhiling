/**
 * R01 候选：输入构造（ExtractorInput v2 的取数部分）。
 *
 * 与现状差异：
 * 1) 不再只取近 30 天：无水位时取"上一段会话尾巴（有界）+ 当前会话"，
 *    长期回归（>30 天）也能看到上次聊到哪儿了。
 * 2) 不按"像不像事实"预删单句，不按 8 字删短回答（保留更正、否定、拒谈）。
 * 3) 带覆盖账本：读了哪些区间、因为预算没读哪些、是否截断。
 */
import { isFactBearingUtterance } from '../../agents/memory-value';

/**
 * 本模块跑在 es2018 lib 目标下（apps/node/tsconfig.json），没有
 * Array.prototype.flatMap；用等价的显式实现替代，避免为它改动全局 lib/ target。
 */
function flatMapArray<T, U>(items: readonly T[], fn: (item: T) => U[]): U[] {
  const out: U[] = [];
  for (const item of items) {
    out.push(...fn(item));
  }
  return out;
}

export interface InputMessage {
  id: string;
  role: 'user' | 'assistant';
  occurredAt: string;
  content: string;
  sourceType: 'text' | 'transcript' | 'image_description';
}

export interface InputSegment {
  id: string;
  period: 'previous_session' | 'current_session' | 'support';
  messages: InputMessage[];
}

export interface ExtractorInputV2 {
  schemaVersion: 'return_extract_input_v2';
  now: string;
  timezone: 'Asia/Shanghai';
  /** 消息接收顺序的稳定上界（只包含触发时已知的消息，不能读未来）。 */
  inputUpperBound: string;
  segments: InputSegment[];
  coverage: {
    readRanges: string[];
    deferredRanges: string[];
    truncated: boolean;
    /** 读入的消息条数（含相邻 AI 消息）。 */
    readMessages: number;
    /** 输入字符数（粗口径 token 预算依据）。 */
    inputChars: number;
    /** 是否因为预算丢弃了本该读的区间。 */
    budgetExceeded: boolean;
    /** 与旧口径的差异量化：旧口径会丢掉的消息条数。 */
    legacyDroppedMessages: number;
    legacyFilteredByFact: number;
  };
}

export interface BuildInputOptions {
  now: Date;
  /** 只允许读到这个接收时刻/消息为止（防未来数据）。 */
  inputUpperBound?: string;
  /** 消息接收顺序（id -> 序号）；给定时按序号而不是时间戳排序。 */
  receivedSeq?: Record<string, number>;
  /** 当前会话起点（回归第一条消息的 id）；不传则按 6 小时间隔切会话。 */
  currentSessionStartId?: string;
  /** 当前会话最多取多少条（含用户与相邻 AI）。 */
  currentSessionMax?: number;
  /** 上一段会话尾巴最多取多少条。 */
  previousTailMax?: number;
  /** 预算：最多多少条消息进输入。 */
  budgetMessages?: number;
  /** 预算：输入字符数上限（粗 token 预算）。 */
  budgetChars?: number;
  /** 是否保留空内容/极短消息（R01 起默认保留）。 */
  keepShort?: boolean;
  /** 是否沿用旧的事实型过滤（默认关闭，仅用于消融对照）。 */
  factFilter?: boolean;
  sessionGapHours?: number;
}

const DEFAULTS = {
  currentSessionMax: 40,
  previousTailMax: 20,
  budgetMessages: 60,
  sessionGapHours: 6,
  budgetChars: 12000,
};

export function buildExtractorInputV2(
  rows: InputMessage[],
  options: BuildInputOptions
): ExtractorInputV2 {
  const config = { ...DEFAULTS, ...options };
  const seqOf = (row: InputMessage) =>
    options.receivedSeq?.[row.id] ?? new Date(row.occurredAt).getTime();
  // 先按接收上界裁掉"触发时还不知道"的消息（T1 不能读 T2）
  const bounded = rows
    .filter(row => (row.content || '').trim().length > 0)
    .filter(row => {
      if (!config.inputUpperBound) return true;
      if (options.receivedSeq)
        return (
          seqOf(row) <=
          (options.receivedSeq[config.inputUpperBound] ?? Infinity)
        );
      return (
        new Date(row.occurredAt).getTime() <=
        new Date(config.inputUpperBound).getTime()
      );
    });
  const sorted = bounded
    .slice()
    .sort((left, right) => seqOf(left) - seqOf(right));

  // 会话切分：只看**用户消息**之间的间隔；AI 消息不切段（用户隔 8 小时回来时，
  // 中间即使有 AI 消息，也仍然是同一段回归）。
  const sessions: InputMessage[][] = [];
  let current: InputMessage[] = [];
  let lastUserAt: number | undefined;
  for (const row of sorted) {
    if (row.role === 'user') {
      const at = new Date(row.occurredAt).getTime();
      if (
        lastUserAt !== undefined &&
        (at - lastUserAt) / 3600000 >= config.sessionGapHours
      ) {
        sessions.push(current);
        current = [];
      }
      lastUserAt = at;
    }
    current.push(row);
  }
  if (current.length) sessions.push(current);

  let currentSession = sessions[sessions.length - 1] || [];
  let previousSession: InputMessage[] =
    sessions.length > 1 ? sessions[sessions.length - 2] : [];
  if (config.currentSessionStartId) {
    const startIndex = sessions.findIndex(session =>
      session.some(row => row.id === config.currentSessionStartId)
    );
    if (startIndex >= 0) {
      // 只取"触发消息及其之后"的部分，不把触发点之前的同段消息也算成本次新增
      const within = sessions[startIndex];
      const offset = within.findIndex(
        row => row.id === config.currentSessionStartId
      );
      currentSession = within.slice(offset);
      previousSession = startIndex > 0 ? sessions[startIndex - 1] : [];
    }
  }

  const currentPicked = currentSession.slice(-config.currentSessionMax);
  const previousPicked = previousSession.slice(-config.previousTailMax);
  const segments: InputSegment[] = [];
  if (previousPicked.length) {
    segments.push({
      id: 'previous',
      period: 'previous_session',
      messages: previousPicked,
    });
  }
  segments.push({
    id: 'current',
    period: 'current_session',
    messages: currentPicked,
  });

  // 预算裁剪：先保当前会话尾部，再补上一段会话尾部；同时受条数与字符预算约束
  let budget = config.budgetMessages;
  let charBudget = config.budgetChars;
  const kept: InputSegment[] = [];
  for (const segment of [...segments].reverse()) {
    if (budget <= 0 || charBudget <= 0) break;
    const usable = segment.messages.filter(
      message => message.role === 'user' || message.content
    );
    const messages: InputMessage[] = [];
    for (const message of usable.slice(-budget).reverse()) {
      const size = (message.content || '').length;
      if (charBudget - size < 0 && messages.length) break;
      charBudget -= size;
      messages.unshift(message);
    }
    if (!messages.length) continue;
    budget -= messages.length;
    kept.unshift({ ...segment, messages });
  }

  const readRanges = kept.map(segment => {
    const first = segment.messages[0];
    const last = segment.messages[segment.messages.length - 1];
    return `${segment.period}:${first.id}..${last.id}`;
  });
  const keptIds = new Set(
    flatMapArray(kept, segment => segment.messages.map(message => message.id))
  );
  const deferred = sorted.filter(row => !keptIds.has(row.id));
  const legacySince = new Date(options.now.getTime() - 30 * 24 * 3600 * 1000);
  const legacyDropped = sorted.filter(
    row => new Date(row.occurredAt) < legacySince
  ).length;
  const legacyFiltered = config.factFilter
    ? 0
    : sorted.filter(
        row =>
          row.role === 'user' &&
          !isFactBearingUtterance(row.content) &&
          keptIds.has(row.id)
      ).length;

  const readMessages = kept.reduce(
    (sum, segment) => sum + segment.messages.length,
    0
  );
  const inputChars = kept.reduce(
    (sum, segment) =>
      sum +
      segment.messages.reduce(
        (inner, message) => inner + (message.content || '').length,
        0
      ),
    0
  );
  return {
    schemaVersion: 'return_extract_input_v2',
    now: options.now.toISOString(),
    timezone: 'Asia/Shanghai',
    inputUpperBound:
      config.inputUpperBound ||
      sorted[sorted.length - 1]?.occurredAt ||
      options.now.toISOString(),
    segments: kept,
    coverage: {
      readRanges,
      deferredRanges: deferred.length
        ? [
            `deferred:${deferred.length}条(${deferred[0].id}..${
              deferred[deferred.length - 1].id
            })`,
          ]
        : [],
      truncated: deferred.length > 0,
      readMessages,
      inputChars,
      budgetExceeded: budget <= 0 || charBudget <= 0,
      legacyDroppedMessages: legacyDropped,
      legacyFilteredByFact: legacyFiltered,
    },
  };
}

/** 渲染成文本（R01 仍用旧提示词模板，只替换输入选段）。 */
export function renderMessagesForLegacyPrompt(input: ExtractorInputV2) {
  return flatMapArray(input.segments, segment =>
    segment.messages
      .filter(message => message.role === 'user')
      .map(message => ({
        messageId: message.id,
        occurredAt: message.occurredAt,
        content: message.content,
      }))
  );
}

/**
 * 水位推进：只有"连续读完"的部分才能推进；一旦有未覆盖区间，水位停在第一个未读消息之前。
 * 水位是消息 id（按接收顺序），不是时间戳——同一时间戳的消息也不会被跳过。
 */
export function resolveNextWatermark(options: {
  previousWatermark?: string;
  receivedOrder: string[];
  readMessageIds: string[];
}): { watermark: string | undefined; blockedBy?: string } {
  const read = new Set(options.readMessageIds);
  const order = options.receivedOrder;
  const startIndex = options.previousWatermark
    ? order.indexOf(options.previousWatermark) + 1
    : 0;
  let watermark = options.previousWatermark;
  for (let index = startIndex; index < order.length; index += 1) {
    const id = order[index];
    if (!read.has(id)) return { watermark, blockedBy: id };
    watermark = id;
  }
  return { watermark };
}
