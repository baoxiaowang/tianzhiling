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
    maxSegments: 2, // 模型输出合同保持 2 泡；程序层可追加到 MAX(3)
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
    concise: '能用一颗就不拆。',
    paired: '仅在两个动作确实切换时用第二颗。',
    layered: '只选最重要的一到两个动作，其余留到后续。',
  };
  const closureInstruction: Record<ReplyTurnClosure, string> = {
    close:
      '自然收尾；先确认收到用户要走/要哭/要停的信号（"嗯，去吧""哭出来也好"），再给温暖回应；不提问或开新话题。',
    continue: '先答当前问题；必要时最多问一个。',
    neutral: '自然收住，不为续聊而提问。',
  };

  const complexityPrefix = plan.preferTwoSegments
    ? '用两颗完成两个不同动作。'
    : complexityInstruction[plan.complexityHint];
  const segmentInstruction = plan.preferTwoSegments
    ? '本轮需要两颗气泡：第一颗直接回应，第二颗优先贴着本轮具体事物给亲人侧感受、态度或不同反应；每颗约10-15字且能独立成句，不把一句话截成两半。第二颗不能空泡、旁白或复读第一颗；即使本轮主题是思念，也不能两颗都只表达想念，第一颗明确回应后，第二颗必须给不同内容，不用“记着你、想着你、一直想你、陪着你”充数。'
    : plan.encourageTwoSegments
    ? '优先用两颗：第一颗接住用户，第二颗给亲人侧心意或具体关心；一颗更自然时可不拆。'
    : `默认一颗，最多 ${plan.maxSegments} 颗；第二颗须新增不可替代的动作。`;

  return [
    `${complexityPrefix}${closureInstruction[plan.turnClosure]}`,
    `${segmentInstruction}勿按句子、情绪或计划拆泡。`,
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
