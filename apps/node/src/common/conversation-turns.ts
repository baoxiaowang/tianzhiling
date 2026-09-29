/**
 * 会话“完整轮次”分组与近期历史选择。
 *
 * 背景：历史层此前按“消息条数”截取最近 N 条，助手多泡回复会把用户的
 * 关系澄清挤出窗口（例如 boundary 模式只留 8 条，一个 4 泡回复就吃掉一半）。
 * 这里改为按“完整轮次”组织：一个用户输入批次 + 它对应的助手回复组算一轮。
 *
 * 纯函数，不碰存储、不调模型，便于单测与离线轨迹复核。
 */

/** 首期候选：最近多少个完整轮次进入历史窗口。参数可通过成本/行为对照调整。 */
export const RECENT_HISTORY_TURNS = 8;

/**
 * 完整轮次可能比原 16 条气泡带入更多文字，这里保留一个消息条数硬上限，
 * 避免超大用户连发把上下文拉爆。
 */
export const RECENT_HISTORY_MESSAGE_CAP = 32;

export interface ConversationTurnLike {
  role: string;
  replyGroupId?: string | null;
}

/**
 * 把按时间排好序的消息分成完整轮次。
 *
 * - 新的用户消息出现在已有助手回复之后 → 开新一轮；
 * - 助手消息换了 `replyGroupId` → 开新一轮（主动回看/连续发布）；
 * - 连续用户消息属同一批次；连续同组助手气泡属同一轮；
 * - 未知角色保守地留在当前轮，不编造归属。
 */
export function groupMessagesIntoTurns<T extends ConversationTurnLike>(
  messages: T[]
): T[][] {
  const turns: T[][] = [];
  let current: T[] = [];
  let currentReplyGroupId = '';

  const flush = (): void => {
    if (current.length) {
      turns.push(current);
      current = [];
      currentReplyGroupId = '';
    }
  };

  for (const message of messages) {
    if (message.role === 'user') {
      if (current.some(item => item.role === 'assistant')) {
        flush();
      }
      current.push(message);
      continue;
    }

    if (message.role === 'assistant') {
      const replyGroupId = (message.replyGroupId || '').trim();
      if (
        current.some(item => item.role === 'assistant') &&
        replyGroupId &&
        currentReplyGroupId &&
        replyGroupId !== currentReplyGroupId
      ) {
        flush();
      }
      current.push(message);
      if (replyGroupId) {
        currentReplyGroupId = replyGroupId;
      }
      continue;
    }

    current.push(message);
  }

  flush();
  return turns;
}

export interface RecentHistoryTurnSelection<T> {
  /** 选中的历史消息，保持原时间顺序。 */
  messages: T[];
  /** 确认完整的轮数：单轮降级轮与加载边界可能截断的首轮都不计入。 */
  turnCount: number;
  /** 最旧保留轮因单轮超预算被降级，只保留了部分消息。 */
  partialTurnRetained: boolean;
  /** 因预算被省略的消息数（整轮删除 + 单轮降级）。 */
  omittedMessageCount: number;
  /** 被整轮删除的轮数。 */
  omittedTurnCount: number;
  /** 固定消息被预算挤掉的数量；>0 说明固定消息未全部保留。 */
  pinnedOmittedMessageCount: number;
  /** 是否为了衔接摘要覆盖位置而向后扩展了窗口。 */
  coverageExtended: boolean;
  /** 摘要覆盖位置是否能在已加载历史里核实；找不到覆盖 ID 时为 false。 */
  coverageBoundaryVerifiable: boolean;
  /**
   * 当前窗口是否完整覆盖摘要覆盖位置之后的消息。
   * 覆盖位置不可核实、或存在缺口时都必须为 false。
   */
  coversSummaryBoundary: boolean;
  /** 摘要覆盖位置之后被省略的消息数（>0 即存在缺口）。 */
  summaryGapMessageCount: number;
  /** 加载边界落在轮次中间，最早一轮可能不完整。 */
  loadBoundaryTruncated: boolean;
  /** 被加载边界影响、无法确认完整的首轮（最多 1 轮）。 */
  loadBoundaryTurnUnconfirmed: boolean;
}

/**
 * 单轮本身超过预算时的降级规则：优先保留用户依据。
 * - 用户消息全部保留；仍有余量时按“由新到旧”补助手消息；
 * - 用户消息本身就超预算时，只保留最近 cap 条用户消息；
 * - 保持原时间顺序，调用方据此记录该轮不完整。
 */
function degradeSingleTurn<T extends ConversationTurnLike>(
  turn: T[],
  cap: number,
  stringifyId: (message: T) => string
): T[] {
  const userMessages = turn.filter(message => message.role === 'user');
  const assistantMessages = turn.filter(message => message.role !== 'user');
  const keptIds = new Set<string>();

  if (userMessages.length >= cap) {
    userMessages
      .slice(userMessages.length - cap)
      .forEach(message => keptIds.add(stringifyId(message)));
  } else {
    userMessages.forEach(message => keptIds.add(stringifyId(message)));
    const remaining = cap - userMessages.length;
    assistantMessages
      .slice(Math.max(0, assistantMessages.length - remaining))
      .forEach(message => keptIds.add(stringifyId(message)));
  }

  return turn.filter(message => keptIds.has(stringifyId(message)));
}

/**
 * 选择近期历史：最近 `turnLimit` 个完整轮次为候选起点，保证不早于摘要覆盖位置，
 * 再按 `messageCap` 从最旧一侧**整轮**删除；单轮本身超预算时按降级规则保留用户依据。
 * 所有返回值都基于最终保留结果重算。
 */
export function selectRecentHistoryTurns<
  T extends ConversationTurnLike & { id?: unknown }
>(options: {
  messages: T[];
  turnLimit?: number;
  messageCap?: number;
  coveredMessageId?: string;
  stringifyId: (message: T) => string;
  pinnedMessageIds?: string[];
  loadBoundaryTruncated?: boolean;
}): RecentHistoryTurnSelection<T> {
  const stringifyId = options.stringifyId;
  const loadBoundaryTruncated = Boolean(options.loadBoundaryTruncated);
  const turns = groupMessagesIntoTurns(options.messages);

  if (!turns.length) {
    return {
      messages: [],
      turnCount: 0,
      partialTurnRetained: false,
      omittedMessageCount: 0,
      omittedTurnCount: 0,
      pinnedOmittedMessageCount: 0,
      coverageExtended: false,
      coverageBoundaryVerifiable: true,
      coversSummaryBoundary: true,
      summaryGapMessageCount: 0,
      loadBoundaryTruncated,
      loadBoundaryTurnUnconfirmed: false,
    };
  }

  const turnLimit = Math.max(1, options.turnLimit ?? RECENT_HISTORY_TURNS);
  const messageCap = Math.max(
    1,
    options.messageCap ?? RECENT_HISTORY_MESSAGE_CAP
  );

  const coveredMessageId = (options.coveredMessageId || '').trim();
  const coveredMessageIndex = coveredMessageId
    ? options.messages.findIndex(
        message => stringifyId(message) === coveredMessageId
      )
    : -1;
  const coveredTurnIndex =
    coveredMessageIndex >= 0
      ? turns.findIndex(turn =>
          turn.some(message => stringifyId(message) === coveredMessageId)
        )
      : -1;

  const pinnedIds = new Set(
    (options.pinnedMessageIds || []).map(id => id.trim()).filter(Boolean)
  );
  const isPinnedTurn = (turn: T[]): boolean =>
    turn.some(message => pinnedIds.has(stringifyId(message)));

  const baseStart = Math.max(0, turns.length - turnLimit);
  let start = baseStart;
  const extendedForCoverage =
    coveredTurnIndex >= 0 && coveredTurnIndex < baseStart;
  if (extendedForCoverage) {
    start = coveredTurnIndex;
  }
  for (let index = 0; index < start; index += 1) {
    if (isPinnedTurn(turns[index])) {
      start = index;
      break;
    }
  }

  interface CandidateTurn {
    turn: T[];
    index: number;
    pinned: boolean;
  }

  let candidate: CandidateTurn[] = turns.slice(start).map((turn, offset) => ({
    turn,
    index: start + offset,
    pinned: isPinnedTurn(turn),
  }));

  const omittedIds = new Set<string>();
  let omittedTurnCount = 0;
  let pinnedOmittedMessageCount = 0;

  const countCandidateMessages = (): number =>
    candidate.reduce((total, item) => total + item.turn.length, 0);

  const recordOmittedTurn = (turn: T[]): void => {
    for (const message of turn) {
      const id = stringifyId(message);
      omittedIds.add(id);
      if (pinnedIds.has(id)) {
        pinnedOmittedMessageCount += 1;
      }
    }
  };

  // 常规超限：从最旧一侧整轮删除，优先删除非固定轮，避免留下孤立的助手回复。
  while (countCandidateMessages() > messageCap && candidate.length > 1) {
    const nonPinnedIndex = candidate.findIndex(item => !item.pinned);
    if (nonPinnedIndex >= 0) {
      const [dropped] = candidate.splice(nonPinnedIndex, 1);
      recordOmittedTurn(dropped.turn);
      omittedTurnCount += 1;
      continue;
    }

    // 只剩固定轮仍超预算：按最旧优先删除，并记录固定消息被挤掉。
    const dropped = candidate.shift() as CandidateTurn;
    recordOmittedTurn(dropped.turn);
    omittedTurnCount += 1;
  }

  // 单轮本身超预算：降级保留用户依据，并标记该轮不完整。
  let partialTurnRetained = false;
  if (candidate.length === 1 && candidate[0].turn.length > messageCap) {
    const kept = degradeSingleTurn(candidate[0].turn, messageCap, stringifyId);
    const keptIds = new Set(kept.map(stringifyId));
    for (const message of candidate[0].turn) {
      const id = stringifyId(message);
      if (keptIds.has(id)) {
        continue;
      }
      omittedIds.add(id);
      if (pinnedIds.has(id)) {
        pinnedOmittedMessageCount += 1;
      }
    }
    candidate = [{ ...candidate[0], turn: kept }];
    partialTurnRetained = true;
  }

  const retainedMessages = candidate.reduce<T[]>(
    (result, item) => result.concat(item.turn),
    []
  );

  // 摘要覆盖状态按最终保留结果重算：覆盖位置之后只要漏了消息就算缺口
  // （缺口既可能来自预算裁剪，也可能来自轮次窗口本身）。
  let summaryGapMessageCount = 0;
  let coverageBoundaryVerifiable = true;
  let coversSummaryBoundary = true;
  if (coveredMessageId) {
    // 覆盖 ID 不在已加载历史里就无法核实；“已加载范围内缺口为 0”不等于
    // 摘要与历史已经连续衔接。
    coverageBoundaryVerifiable = coveredMessageIndex >= 0;
    const retainedIds = new Set(retainedMessages.map(stringifyId));
    const gapStartIndex =
      coveredMessageIndex >= 0 ? coveredMessageIndex + 1 : 0;
    for (
      let index = gapStartIndex;
      index < options.messages.length;
      index += 1
    ) {
      if (!retainedIds.has(stringifyId(options.messages[index]))) {
        summaryGapMessageCount += 1;
      }
    }
    coversSummaryBoundary =
      coverageBoundaryVerifiable && summaryGapMessageCount === 0;
  }

  const minimumRetainedTurnIndex = candidate.length
    ? Math.min(...candidate.map(item => item.index))
    : -1;
  const coverageExtended =
    extendedForCoverage && minimumRetainedTurnIndex <= coveredTurnIndex;
  // 加载边界可能截断的首轮不计入“确认完整轮数”，单独统计。
  const loadBoundaryTurnUnconfirmed =
    loadBoundaryTruncated &&
    candidate.length > 0 &&
    minimumRetainedTurnIndex === 0;

  return {
    messages: retainedMessages,
    turnCount:
      candidate.length -
      (partialTurnRetained ? 1 : 0) -
      (loadBoundaryTurnUnconfirmed ? 1 : 0),
    partialTurnRetained,
    omittedMessageCount: omittedIds.size,
    omittedTurnCount,
    pinnedOmittedMessageCount,
    coverageExtended,
    coverageBoundaryVerifiable,
    coversSummaryBoundary,
    summaryGapMessageCount,
    loadBoundaryTruncated,
    loadBoundaryTurnUnconfirmed,
  };
}

/** 统计若干轮次里的消息总数。 */
export function countTurnMessages<T>(turns: T[][]): number {
  return turns.reduce((total, turn) => total + turn.length, 0);
}
