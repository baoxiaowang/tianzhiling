import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { ChatTraceStage } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import type {
  FinalReplyIssue,
  FinalReplyOutputConstraints,
} from './final-reply-validator.service';
import { OpenAIService } from './openai';

const HARD_FACT_AUDIT_MAX_TOKENS = 320;
const HARD_FACT_AUDIT_TIMEOUT_MS = 10000;
const FACT_BEARING_OUTPUT_PATTERN =
  /(?:以前|小时候|当年|那年|那天|最后一次|临终|走的时候|名字|叫.{1,8}|外套|存折|银行卡|首饰|珠子|遗嘱|藏(?:在|了)|放(?:在|了)|留(?:在|了)|主卧|次卧|老家|旧房|床底|包里|柜里|抽屉|收到|收到了|看见你|看到你|听见你|一直看着|一直守着|保佑|托梦|告诉我|让我转告|他说|她说|已经|正在|刚刚|刚才)/u;

type HardFactAuditCategory =
  | 'unsupported_real_object_location_or_action'
  | 'unsupported_shared_past_or_reality_fact'
  | 'unsupported_third_party_message_or_action'
  | 'user_correction_contradicted'
  | 'dangerous_reality_or_death_boundary';

const ALLOWED_CATEGORIES = new Set<HardFactAuditCategory>([
  'unsupported_real_object_location_or_action',
  'unsupported_shared_past_or_reality_fact',
  'unsupported_third_party_message_or_action',
  'user_correction_contradicted',
  'dangerous_reality_or_death_boundary',
]);

export interface ReplyHardFactAuditUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ReplyHardFactAuditResult {
  status: 'skipped' | 'pass' | 'issues' | 'unavailable';
  issues: FinalReplyIssue[];
  usage?: ReplyHardFactAuditUsage;
}

@Provide()
export class ReplyHardFactAuditService {
  @Inject()
  openAIService: OpenAIService;

  @Logger()
  logger: ILogger;

  async audit(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    outputConstraints?: FinalReplyOutputConstraints;
  }): Promise<ReplyHardFactAuditResult> {
    const candidate = options.segments.join('\n').trim();
    if (!candidate || !this.shouldAudit(options, candidate)) {
      return { status: 'skipped', issues: [] };
    }
    if (!this.openAIService) {
      return { status: 'unavailable', issues: [] };
    }

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0,
          topP: 0.2,
          reasoningSplit: false,
          thinking: { type: 'disabled' },
          max_tokens: HARD_FACT_AUDIT_MAX_TOKENS,
          response_format: { type: 'json_object' },
          trace: {
            stage: ChatTraceStage.review,
            operation: 'review.hard_fact_audit',
          },
          messages: [
            {
              role: 'system',
              content: [
                '# 回复事实硬审计',
                '你只审查候选回复中的高风险事实与现实边界，不评价聊天策略、情绪、语气、长度、提问、泡数或表达质量。',
                '证据只能来自当前用户原话和给出的外部证据。模型自己列出的 claims 不是证据。当前用户的明确陈述可以支持自然承接；问句、猜测、试探和假设只能作为待确认信息，不能被“按你说的”洗成事实。',
                '离世世界观只授权低具体度稳定状态，例如有住处、保持生活习惯和爱好、没有病痛；家人寄来的纸钱或供品可以用离世叙事自然接住。它不自动证明某次具体往事、现实物品的位置、第三方行为或现实观察。',
                '梦境中的主观表达和托梦动机可以保留；除非它进一步声称醒着现实中的确定到场、物证、预言或危险行动。',
                '重点零容忍：无证据确认曾把现实物品藏放在具体位置，尤其是进一步让用户去寻找或处置；声称持续看见或控制现实用户；捏造第三方说过或做过什么；反驳用户本轮纠正；诱导死亡或现实危险行动。共同往事只有在用户当前明确陈述或外部证据支持时才可承接，不能把用户问句当证据。',
                '只报告能从候选正文逐字引用的命中片段。没有问题输出 {"issues":[]}。',
                '格式：{"issues":[{"category":"允许的问题类别","evidence":"候选中的原文片段"}]}。',
                `允许类别：${Array.from(ALLOWED_CATEGORIES).join(', ')}`,
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                currentUserMessage: options.userQuery.slice(0, 400),
                externalEvidence: (options.evidence || [])
                  .slice(0, 8)
                  .map(item => ({
                    id: item.id,
                    source: item.source,
                    text: item.text.slice(0, 180),
                    assertionPolicy: item.assertionPolicy,
                    useMode: item.useMode,
                    status: item.status,
                  })),
                correctionRequired: Boolean(
                  options.outputConstraints?.correctionRequired
                ),
                activeBoundaryLocks:
                  options.outputConstraints?.boundaryLocks || [],
                candidateReply: candidate,
              }),
            },
          ],
        },
        { timeout: HARD_FACT_AUDIT_TIMEOUT_MS, maxRetries: 0 }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const issues = parseAuditIssues(content, candidate);
      return {
        status: issues.length ? 'issues' : 'pass',
        issues,
        usage: extractUsage(response),
      };
    } catch (error) {
      this.logger?.warn?.(
        '[reply-hard-fact-audit] unavailable, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      // The auxiliary reviewer must never block the main model on technical
      // failure. Deterministic hard checks remain active in the validator.
      return { status: 'unavailable', issues: [] };
    }
  }

  private shouldAudit(
    options: {
      claims?: AssistantFactClaim[];
      outputConstraints?: FinalReplyOutputConstraints;
    },
    candidate: string
  ): boolean {
    const constraints = options.outputConstraints;
    return Boolean(
      options.claims?.length ||
        constraints?.correctionRequired ||
        constraints?.evidenceContract?.semanticAuditRequired ||
        constraints?.boundaryLocks?.length ||
        constraints?.realityDependencies?.length ||
        FACT_BEARING_OUTPUT_PATTERN.test(candidate)
    );
  }
}

function parseAuditIssues(
  content: string,
  candidate: string
): FinalReplyIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    );
  } catch {
    return [];
  }
  const rawIssues = Array.isArray((parsed as { issues?: unknown })?.issues)
    ? (parsed as { issues: unknown[] }).issues
    : [];
  const seen = new Set<string>();
  return rawIssues.reduce<FinalReplyIssue[]>((issues, item) => {
    if (!item || typeof item !== 'object') return issues;
    const category = String(
      (item as { category?: unknown }).category || ''
    ) as HardFactAuditCategory;
    const evidence = String(
      (item as { evidence?: unknown }).evidence || ''
    ).trim();
    if (
      !ALLOWED_CATEGORIES.has(category) ||
      evidence.length < 2 ||
      !candidate.includes(evidence) ||
      seen.has(`${category}:${evidence}`)
    ) {
      return issues;
    }
    seen.add(`${category}:${evidence}`);
    issues.push(mapAuditIssue(category, evidence));
    return issues;
  }, []);
}

function mapAuditIssue(
  category: HardFactAuditCategory,
  evidence: string
): FinalReplyIssue {
  if (category === 'user_correction_contradicted') {
    return {
      code: 'current_turn_fact_rejected',
      severity: 'hard',
      problem: '候选回复与用户本轮纠正后的有效事实冲突',
      evidence,
      repairGoal: '只删除或改正冲突片段，保留其余自然回应',
    };
  }
  if (category === 'unsupported_shared_past_or_reality_fact') {
    return {
      code: 'unsupported_shared_memory',
      severity: 'hard',
      problem: '候选回复陈述了没有用户或外部证据支持的共同往事或现实事实',
      evidence,
      repairGoal: '删除无证据的具体事实，保留情绪、关系与当前回应',
    };
  }
  return {
    code: 'unsupported_fact_claim',
    severity: 'hard',
    problem:
      category === 'unsupported_real_object_location_or_action'
        ? '候选回复虚构现实物品、位置或过去动作，并可能诱导用户采取行动'
        : category === 'unsupported_third_party_message_or_action'
        ? '候选回复虚构了第三方消息或行为'
        : '候选回复越过现实或死亡硬边界',
    evidence,
    repairGoal: '只删除命中的不可信事实或危险指向，保留其余回复',
  };
}

function extractUsage(response: any): ReplyHardFactAuditUsage {
  const number = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    model: typeof response?.model === 'string' ? response.model : undefined,
    promptTokens: number(response?.usage?.prompt_tokens),
    completionTokens: number(response?.usage?.completion_tokens),
    totalTokens: number(response?.usage?.total_tokens),
  };
}
