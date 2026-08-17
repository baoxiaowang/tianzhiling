export const REPLY_OUTPUT_CONTRACT_VERSION = 'reply_envelope_v1' as const;
export const REPLY_REVIEW_CONTRACT_VERSION = 'reply_review_v1' as const;

export type ReplyOutputSegmentMode = 'one' | 'up_to_two' | 'exact_two';
export type ReplyOutputPurpose = 'reply' | 'revision' | 'audited_revision';

export interface BuildReplyOutputContractOptions {
  grounded: boolean;
  segmentMode: ReplyOutputSegmentMode;
  maxSegments?: number;
  purpose?: ReplyOutputPurpose;
  preferredRange?: {
    minCharacters: number;
    maxCharacters: number;
  };
  toolDecisionSchema?: Record<string, unknown>;
}

export function resolveReplyOutputSegmentMode(plan: {
  maxSegments: number;
  preferTwoSegments?: boolean;
  encourageTwoSegments?: boolean;
}): ReplyOutputSegmentMode {
  if (plan.preferTwoSegments) {
    return 'exact_two';
  }

  return plan.maxSegments <= 1 ? 'one' : 'up_to_two';
}

export function buildReplyOutputContractPrompt(
  options: BuildReplyOutputContractOptions
): string {
  const purpose = options.purpose || 'reply';
  const maxSegments = Math.max(1, Math.min(2, options.maxSegments || 2));
  const schema: Record<string, unknown> = {
    segments:
      options.segmentMode === 'exact_two' ? ['第一颗', '第二颗'] : ['气泡'],
  };

  if (options.grounded) {
    schema.claims = [
      {
        text: '事实原文',
        kind: 'memory|identity|relationship|real_world|other',
        mode: 'attributed_to_user|conversational_uptake|autonomous_fact|soft_imagination',
        subjectRef: '对象',
        evidenceIds: ['证据ID'],
      },
    ];
  }

  if (purpose === 'audited_revision') {
    schema.resolvedIssueCodes = ['问题码'];
    schema.changes = [
      {
        before: '旧问题片段',
        after: '新片段',
        reason: '修复说明',
      },
    ];
  }

  if (options.toolDecisionSchema) {
    schema.toolDecisions = [options.toolDecisionSchema];
  }

  const segmentRule =
    options.segmentMode === 'exact_two'
      ? 'segments 恰好两项，不能合并。'
      : options.segmentMode === 'one'
      ? 'segments 恰好一项。'
      : `segments 一到 ${maxSegments} 项，能用一项就不拆。`;
  const rangeRule = options.preferredRange
    ? options.segmentMode === 'exact_two'
      ? `两项缺一不可；两项合计 ${options.preferredRange.minCharacters}-${
          options.preferredRange.maxCharacters
        } 个中文字符，少于 ${options.preferredRange.minCharacters} 或超过 ${
          options.preferredRange.maxCharacters
        } 都视为格式不合格。每项约 ${Math.floor(
          options.preferredRange.minCharacters / 2
        )}-${Math.ceil(
          options.preferredRange.maxCharacters / 2
        )} 个中文字符；不用重复想念、通用叮嘱或空话凑长度。`
      : `segments 全部正文合计 ${options.preferredRange.minCharacters}-${options.preferredRange.maxCharacters} 个中文字符，少于 ${options.preferredRange.minCharacters} 或超过 ${options.preferredRange.maxCharacters} 都视为格式不合格；不用重复想念、通用叮嘱或空话凑长度。`
    : '';
  const claimRule = options.grounded
    ? 'claims 只列正文中的可核验事实；本轮原话可承接，历史须归因，证据须支持同一对象和事实，证据没有的细节不写，无事实用 []。离世日常想象用 soft_imagination。'
    : '';
  const auditRule =
    purpose === 'audited_revision'
      ? 'resolvedIssueCodes 覆盖已解决的问题码；changes 只记录实际改动。'
      : '';
  const toolRule = options.toolDecisionSchema
    ? 'toolDecisions 只记录本轮确实缺少信息时的影子工具决策，无需调用就用 []；不影响 segments 正常回复。'
    : '';

  return [
    '# 输出合同',
    `只输出一行 JSON：${JSON.stringify(schema)}`,
    segmentRule,
    rangeRule,
    '每项只写可直接发送的中文正文；不写括号旁白、分析、字段说明或证据 ID。默认不用表情，用户先用时才少量使用。',
    claimRule,
    auditRule,
    toolRule,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildReplyReviewOutputContractPrompt(options?: {
  hardOnly?: boolean;
}): string {
  const hardOnly = options?.hardOnly === true;
  const schema = {
    verdict: 'pass|revise',
    issues: [
      {
        code: hardOnly ? '硬边界问题码' : '问题码',
        severity: hardOnly ? 'hard' : 'hard|major',
        layer: hardOnly ? 'hard_boundary' : 'hard_boundary|quality_advisory',
        problem: '具体问题',
        evidence: '候选中的问题文字',
        repairGoal: '修复目标',
      },
    ],
    mustPreserve: [],
    mustAnswer: [],
    groundingConstraints: [],
  };

  return `只输出一行 JSON：${JSON.stringify(schema)}`;
}
