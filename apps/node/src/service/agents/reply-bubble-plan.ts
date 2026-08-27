export const MAX_ASSISTANT_REPLY_SEGMENTS = 3;

export type ReplyBubbleComplexityHint = 'concise' | 'paired' | 'layered';

export type ReplyTurnClosure = 'close' | 'continue' | 'neutral';

export interface ReplyBubblePlan {
  maxSegments: 2;
  complexityHint: ReplyBubbleComplexityHint;
  turnClosure: ReplyTurnClosure;
  preferTwoSegments?: boolean;
  encourageTwoSegments?: boolean;
}

export type ReplyBubbleStructureIssue =
  | 'empty_segment'
  | 'stage_direction_segment'
  | 'exact_duplicate_segment'
  | 'no_usable_segments'
  | 'too_many_segments';

export interface ReplyBubbleStructureInspection {
  segments: string[];
  issues: ReplyBubbleStructureIssue[];
  requiresReflow: boolean;
}

const EXPLICIT_SINGLE_BUBBLE_PATTERN =
  /(?:说|写|回)(?:一段|一整段)|一段话|不要分段|别分段/;
const CLOSING_TURN_PATTERN =
  /^.{0,10}?(?:不说了|不聊了|先不说了|别回了|不用回|先这样|先关一下|关闭聊天窗口|关窗口|哭一?[会下]儿?|说不下去了?|聊不下去了?)|(?:.{0,5}[。！!…~～]+\s*)?(?:晚安|睡了|先睡吧|去睡了|休息了|再见|拜拜|回头聊|下次聊)[。！!…~～\s]*$/;
const CONTINUING_TURN_PATTERN =
  /[?？]\s*$|(?:你说|告诉我|怎么办|怎么想|还记得吗|可以吗|行吗|好吗)[。！!…~～]*$/;
const PARENTHETICAL_ASIDE_PATTERN = /[（(【[][^）)】\]]{1,64}[）)】\]]/gu;

export function buildReplyBubblePlan(options: {
  currentQuery: string;
  replyMoveCount?: number;
  turnClosureHint?: ReplyTurnClosure;
  preferTwoSegments?: boolean;
  encourageTwoSegments?: boolean;
}): ReplyBubblePlan {
  const currentQuery = options.currentQuery.trim();
  const replyMoveCount = Math.max(0, options.replyMoveCount || 0);
  const ruleClosure = resolveReplyTurnClosure(currentQuery);
  const turnClosure =
    ruleClosure === 'close' ? 'close' : options.turnClosureHint || ruleClosure;
  const allowsTwoSegmentPreference =
    !EXPLICIT_SINGLE_BUBBLE_PATTERN.test(currentQuery);
  const complexityHint = EXPLICIT_SINGLE_BUBBLE_PATTERN.test(currentQuery)
    ? 'concise'
    : replyMoveCount >= 3
    ? 'layered'
    : replyMoveCount >= 2
    ? 'paired'
    : 'concise';

  return {
    // 保留既有规划字段供节奏诊断使用；模型生成合同统一只产出一条完整正文。
    maxSegments: 2,
    complexityHint,
    turnClosure,
    ...(options.preferTwoSegments && allowsTwoSegmentPreference
      ? { preferTwoSegments: true }
      : {}),
    ...(options.encourageTwoSegments && allowsTwoSegmentPreference
      ? { encourageTwoSegments: true }
      : {}),
  };
}

export function isReplyClosingTurn(currentQuery: string): boolean {
  const query = currentQuery.trim();
  return (
    CLOSING_TURN_PATTERN.test(query) ||
    /^(?:晚安|睡了|先睡吧|去睡了|休息了|再见|拜拜|回头聊|下次聊)(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆)?[。！!…~～\s]*$/.test(
      query
    )
  );
}

export function buildReplyBubblePlanPrompt(plan: ReplyBubblePlan): string {
  const complexityInstruction: Record<ReplyBubbleComplexityHint, string> = {
    concise: '聚焦当前最重要的回应。',
    paired: '两个贴题动作可以自然连在同一条完整回复里。',
    layered: '按当前需要保留必要层次，不因展示形式删掉重要内容。',
  };
  const closureInstruction: Record<ReplyTurnClosure, string> = {
    close:
      '自然收尾；先确认收到用户要走/要哭/要停的信号（"嗯，去吧""哭出来也好"），再给温暖回应；不提问或开新话题。',
    continue: '先答当前问题；必要时最多问一个。',
    neutral:
      '结合最近对话自然决定继续或停住；确有价值时可以问一个贴题问题，不为续聊硬问。',
  };

  return [
    `${complexityInstruction[plan.complexityHint]}${
      closureInstruction[plan.turnClosure]
    }`,
    '先把这一轮该说的内容完整说好，不在生成阶段设计一泡、两泡或三泡，也不为拆泡压缩、补写或删减正文。请把完整正文放在一个 segments 项里；发送层会在最终治理完成后按自然语义边界适配展示。',
  ].join('\n');
}

// 这些阈值只读取模型已经完成的正文，不进入生成提示，也不构成回复字数目标。
// 常见自然双句从 17 字开始可拆；三泡只留给明显更长的完整正文。
const DELIVERY_TWO_BUBBLE_MIN_CHARACTERS = 17;
const DELIVERY_THREE_BUBBLE_MIN_CHARACTERS = 48;
const DELIVERY_SPLIT_MIN_PART_CHARACTERS = 5;
const STRONG_DELIVERY_BOUNDARY_PATTERN = /[。！？!?]+/gu;
const SOFT_DELIVERY_BOUNDARY_PATTERN = /[，,；;]+/gu;

/**
 * 最终展示拆泡：只移动已有正文的边界，不增、删、改文字。
 * 找不到自然语义边界时保持原泡；长内容最多适配为三泡。
 */
export function splitReplyContentForDelivery(
  inputSegments: string[]
): string[] {
  // 上游最终治理已经完成清理与三泡上限校验；这里复制数组后只移动边界。
  const segments = [...inputSegments];
  const completedContentCharacters = countVisibleCharacters(
    inputSegments.join('')
  );
  const deliverySegmentLimit =
    completedContentCharacters >= DELIVERY_THREE_BUBBLE_MIN_CHARACTERS
      ? MAX_ASSISTANT_REPLY_SEGMENTS
      : completedContentCharacters >= DELIVERY_TWO_BUBBLE_MIN_CHARACTERS
      ? 2
      : 1;

  while (segments.length < deliverySegmentLimit) {
    const candidateIndexes = segments
      .map((segment, index) => ({
        index,
        length: countVisibleCharacters(segment),
      }))
      .filter(item => item.length >= DELIVERY_TWO_BUBBLE_MIN_CHARACTERS)
      .sort((left, right) => right.length - left.length);

    let splitApplied = false;
    for (const candidate of candidateIndexes) {
      const content = segments[candidate.index];
      const splitAt =
        findNaturalDeliverySplitPoint(
          content,
          STRONG_DELIVERY_BOUNDARY_PATTERN
        ) ??
        findNaturalDeliverySplitPoint(content, SOFT_DELIVERY_BOUNDARY_PATTERN);
      if (splitAt === null) {
        continue;
      }

      const first = content.slice(0, splitAt);
      const second = content.slice(splitAt);
      if (!first.trim() || !second.trim()) {
        continue;
      }

      segments.splice(candidate.index, 1, first, second);
      splitApplied = true;
      break;
    }

    if (!splitApplied) {
      break;
    }
  }

  return segments;
}

function findNaturalDeliverySplitPoint(
  content: string,
  boundaryPattern: RegExp
): number | null {
  const visibleCharacters = countVisibleCharacters(content);
  let bestIndex: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  boundaryPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = boundaryPattern.exec(content)) !== null) {
    let splitAt = (match.index || 0) + match[0].length;
    // 原文中的空白也必须保留；把边界后的空白留在前一泡，避免下一泡缩进。
    while (splitAt < content.length && /\s/u.test(content[splitAt])) {
      splitAt += 1;
    }
    const before = countVisibleCharacters(content.slice(0, splitAt));
    const after = visibleCharacters - before;
    if (
      before < DELIVERY_SPLIT_MIN_PART_CHARACTERS ||
      after < DELIVERY_SPLIT_MIN_PART_CHARACTERS
    ) {
      continue;
    }

    const score = Math.abs(before - after);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = splitAt;
    }
  }
  boundaryPattern.lastIndex = 0;

  return bestIndex;
}

function countVisibleCharacters(value: string): number {
  return Array.from(value.replace(/\s/gu, '')).length;
}

export function inspectReplyBubbleStructure(
  inputSegments: string[]
): ReplyBubbleStructureInspection {
  const issues: ReplyBubbleStructureIssue[] = [];
  const segments: string[] = [];
  const seen = new Set<string>();

  for (const value of inputSegments) {
    const originalSegment = value.trim();
    const stageDirectionResult = stripParentheticalAsides(originalSegment);
    const segment = stageDirectionResult.segment;

    if (!segment) {
      issues.push(
        stageDirectionResult.removed
          ? 'stage_direction_segment'
          : 'empty_segment'
      );
      continue;
    }
    if (stageDirectionResult.removed) {
      issues.push('stage_direction_segment');
    }

    if (seen.has(segment)) {
      issues.push('exact_duplicate_segment');
      continue;
    }

    seen.add(segment);
    segments.push(segment);
  }

  if (segments.length > MAX_ASSISTANT_REPLY_SEGMENTS) {
    issues.push('too_many_segments');
  }
  if (!segments.length) {
    issues.push('no_usable_segments');
  }

  return {
    segments,
    issues: Array.from(new Set(issues)),
    requiresReflow:
      !segments.length || segments.length > MAX_ASSISTANT_REPLY_SEGMENTS,
  };
}

function stripParentheticalAsides(value: string): {
  segment: string;
  removed: boolean;
} {
  let removed = false;
  const segment = value
    .replace(PARENTHETICAL_ASIDE_PATTERN, () => {
      removed = true;
      return '';
    })
    .replace(/\s{2,}/gu, ' ')
    .trim();

  return {
    segment,
    removed,
  };
}

export function compactReplyBubblesPreservingContent(
  inputSegments: string[]
): string[] {
  const segments = inspectReplyBubbleStructure(inputSegments).segments;

  if (segments.length <= MAX_ASSISTANT_REPLY_SEGMENTS) {
    return segments;
  }

  return segments
    .slice(0, MAX_ASSISTANT_REPLY_SEGMENTS - 1)
    .concat(
      segments
        .slice(MAX_ASSISTANT_REPLY_SEGMENTS - 1)
        .join(' ')
        .trim()
    )
    .filter(Boolean);
}

function resolveReplyTurnClosure(currentQuery: string): ReplyTurnClosure {
  if (CLOSING_TURN_PATTERN.test(currentQuery)) {
    return 'close';
  }

  if (CONTINUING_TURN_PATTERN.test(currentQuery)) {
    return 'continue';
  }

  return 'neutral';
}
