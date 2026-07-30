export const MAX_ASSISTANT_REPLY_SEGMENTS = 2;

export type ReplyBubbleComplexityHint = 'concise' | 'paired' | 'layered';

export type ReplyTurnClosure = 'close' | 'continue' | 'neutral';

export interface ReplyBubblePlan {
  maxSegments: 2;
  complexityHint: ReplyBubbleComplexityHint;
  turnClosure: ReplyTurnClosure;
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
  /(?:先这样|不聊了|别回了|不用回|晚安|睡了|去睡了|休息了|再见|拜拜|回头聊|下次聊)[。！!…~～]*$/;
const CONTINUING_TURN_PATTERN =
  /[?？]\s*$|(?:你说|告诉我|怎么办|怎么想|还记得吗|可以吗|行吗|好吗)[。！!…~～]*$/;
const PARENTHETICAL_ASIDE_PATTERN = /[（(【[][^）)】\]]{1,64}[）)】\]]/gu;

export function buildReplyBubblePlan(options: {
  currentQuery: string;
  replyMoveCount?: number;
  turnClosureHint?: ReplyTurnClosure;
}): ReplyBubblePlan {
  const currentQuery = options.currentQuery.trim();
  const replyMoveCount = Math.max(0, options.replyMoveCount || 0);
  const ruleClosure = resolveReplyTurnClosure(currentQuery);
  const turnClosure =
    ruleClosure === 'close' ? 'close' : options.turnClosureHint || ruleClosure;
  const complexityHint = EXPLICIT_SINGLE_BUBBLE_PATTERN.test(currentQuery)
    ? 'concise'
    : replyMoveCount >= 3
    ? 'layered'
    : replyMoveCount >= 2
    ? 'paired'
    : 'concise';

  return {
    maxSegments: MAX_ASSISTANT_REPLY_SEGMENTS,
    complexityHint,
    turnClosure,
  };
}

export function buildReplyBubblePlanPrompt(plan: ReplyBubblePlan): string {
  const complexityInstruction: Record<ReplyBubbleComplexityHint, string> = {
    concise: '本轮倾向简洁，能用一颗完整回应就不要拆开。',
    paired: '本轮可能包含两个沟通动作；只有动作确实切换时才考虑第二颗。',
    layered:
      '本轮信息较复杂；本轮仍只选最值得说的一到两个动作，其余留给后续聊天。',
  };
  const closureInstruction: Record<ReplyTurnClosure, string> = {
    close: '用户正在收尾；回应后自然结束，不重新提问或开启新话题。',
    continue: '用户在等待回应；先答当前问题，最多提出一个必要且贴题的问题。',
    neutral: '根据当前表达自然收住，不为维持聊天而追加问题。',
  };

  return [
    complexityInstruction[plan.complexityHint],
    closureInstruction[plan.turnClosure],
    `采用“1 + 可选 1”结构：默认一颗，最多 ${plan.maxSegments} 颗。第二颗必须提供第一颗没有的新动作；删掉后若核心信息和关系感不变，就不要发送。不要按句子、情绪层数或计划动作数量机械分泡。`,
  ].join('\n');
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
