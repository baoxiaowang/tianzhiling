/**
 * 会话边界：同一 conversation 内，间隔超过 6 小时就视为新的会话段。
 *
 * 用户的“新聊天”通常不是新 conversation：同一条会话可能跨天。
 * 历史消息和连续性摘要只能作为过去材料，不能把上一段会话的急性状态
 * 当成当前状态。这里只做纯时间切分，不依赖提示词。
 */

export const CONVERSATION_SESSION_GAP_MS = 6 * 60 * 60 * 1000;

export interface SessionMessageLike {
  createdAt?: Date | string | null;
}

export interface CurrentSessionResult<T> {
  messages: T[];
  /** 本次请求之前存在会话边界（跨日/长间隔）。 */
  boundary: boolean;
  /** 最近一次边界之前最后一条消息的时间。 */
  boundaryAt?: Date;
}

function toDate(value: Date | string | null | undefined): Date | undefined {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }
  return undefined;
}

/**
 * 只保留“当前会话段”的历史消息。
 *
 * - 连续聊天（间隔 < 6 小时）：全部保留；
 * - 历史里出现长间隔：只保留最后一次长间隔之后的消息；
 * - 上一段最后一条消息距离当前轮也已超过 6 小时：历史为空。
 */
export function selectCurrentSessionHistory<T extends SessionMessageLike>(
  messages: T[],
  currentTurnAt: Date,
  gapMs = CONVERSATION_SESSION_GAP_MS
): CurrentSessionResult<T> {
  const currentAt = toDate(currentTurnAt);
  if (!currentAt || !Number.isFinite(gapMs) || gapMs <= 0) {
    return { messages, boundary: false };
  }

  const ordered = [...messages]
    .map(message => ({ message, at: toDate(message.createdAt) }))
    .filter((item): item is { message: T; at: Date } => Boolean(item.at))
    .sort((left, right) => left.at.getTime() - right.at.getTime());

  if (!ordered.length) {
    return { messages: [], boundary: false };
  }

  // 先看当前轮与上一段最后一条消息的间隔。
  const last = ordered[ordered.length - 1];
  if (currentAt.getTime() - last.at.getTime() >= gapMs) {
    return { messages: [], boundary: true, boundaryAt: last.at };
  }

  // 再看历史内部最后一次长间隔，只保留其后的消息。
  let start = 0;
  let boundaryAt: Date | undefined;
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].at.getTime() - ordered[index - 1].at.getTime() >= gapMs) {
      start = index;
      boundaryAt = ordered[index - 1].at;
    }
  }

  return {
    messages: ordered.slice(start).map(item => item.message),
    boundary: Boolean(boundaryAt),
    ...(boundaryAt ? { boundaryAt } : {}),
  };
}
