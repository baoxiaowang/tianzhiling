import type { ReplyEvidenceContract } from './world-boundary-policy';
import type { DeliberateLongReplyCandidateAssessment } from './deliberate-long-reply';

export const REPLY_OUTPUT_CONTRACT_VERSION = 'reply_envelope_v2' as const;
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
  evidenceContract?: ReplyEvidenceContract;
  deliberateLongReplyCandidate?: DeliberateLongReplyCandidateAssessment;
}

export function resolveReplyOutputSegmentMode(plan: {
  maxSegments: number;
  preferTwoSegments?: boolean;
  encourageTwoSegments?: boolean;
}): ReplyOutputSegmentMode {
  // 气泡是最终展示适配，不再由生成模型承担版式设计。
  // 保留 plan 入参，避免节奏规划与输出合同产生两套调用方式。
  void plan;
  return 'one';
}

export function buildReplyOutputContractPrompt(
  options: BuildReplyOutputContractOptions
): string {
  const purpose = options.purpose || 'reply';
  const maxSegments = Math.max(1, Math.min(2, options.maxSegments || 2));
  const schema: Record<string, unknown> = {
    segments:
      options.segmentMode === 'exact_two'
        ? ['第一段正文', '第二段正文']
        : ['完整正文'],
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

  if (options.deliberateLongReplyCandidate?.eligible) {
    schema.deliberateFollowUp = {
      action: 'schedule_next_morning|none',
      reason:
        'personal_disclosure|relationship_letter|multi_event_life_update|mixed_personal_and_quote|poetry_or_quotation|forwarded_or_reference_material|transactional_or_factual|already_complete|other',
      focus: ['最多三个来自用户原文的关注点'],
    };
  }

  const segmentRule =
    options.segmentMode === 'exact_two'
      ? 'segments 恰好两项，不能合并。'
      : options.segmentMode === 'one'
      ? 'segments 恰好一项。'
      : `segments 一到 ${maxSegments} 项，能用一项就不拆。`;
  // preferredRange 继续作为调用兼容与离线观测字段，但不进入生成合同。
  // 展示层会在正文完成后自行拆泡，不能让目标字数反向塑造内容。
  void options.preferredRange;
  const claimRule = options.grounded
    ? 'claims 是证据使用的辅助申报，不决定正文是否安全；仍须如实列出正文中的可核验事实。本轮原话可承接，历史须归因，证据须支持同一对象和事实，证据没有的细节不写，无事实用 []。离世生活框架内的当前事实用 soft_imagination。'
    : '';
  const evidenceContractRule = options.evidenceContract
    ? [
        `证据契约：${options.evidenceContract.policy}；允许内容域=${
          options.evidenceContract.allowedClaimKinds.join('、') || '无'
        }。`,
        options.evidenceContract.semanticAuditRequired
          ? '本轮属于高风险事实问答：正文只要确定写出死因/临终心理、在世家人状态或动机、财产归属、共同往事、现实迹象或化身，就必须在 claims 逐条申报；不能靠省略 claims 绕过证据。'
          : '',
        '离世生活稳定设定、离世日常写意和梦内陪伴不是现实证据；需要写 claims 时用 soft_imagination，不绑定现实证据。',
      ]
        .filter(Boolean)
        .join('\n')
    : '';
  const auditRule =
    purpose === 'audited_revision'
      ? 'resolvedIssueCodes 覆盖已解决的问题码；changes 只记录实际改动。'
      : '';
  const toolRule = options.toolDecisionSchema
    ? 'toolDecisions 只记录本轮确实缺少信息时的影子工具决策，无需调用就用 []；不影响 segments 正常回复。'
    : '';
  const deliberateFollowUpRule = options.deliberateLongReplyCandidate?.eligible
    ? 'deliberateFollowUp 只决定是否建立次日回应任务，不组织正文；action 按上面的次日慎重回应候选判断。focus 最多三项，只能来自用户原文。'
    : '';

  return [
    '# 输出合同',
    `只输出一行 JSON：${JSON.stringify(schema)}`,
    segmentRule,
    '每项只写可直接发送的中文正文；不写括号旁白、分析、字段说明或证据 ID。默认不用表情，用户先用时才少量使用。',
    claimRule,
    evidenceContractRule,
    auditRule,
    toolRule,
    deliberateFollowUpRule,
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
