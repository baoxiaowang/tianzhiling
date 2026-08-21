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
const STRUCTURAL_FACT_RISK_PATTERNS = [
  /(?:以前|生前|当年|那年|那天|走前|临终|走的时候).{0,48}(?:藏|放|留|埋|塞|夹|交给|托付|答应|带去|买过|做过)/u,
  /(?:藏|放|留|埋|塞|夹)(?:在|到|进|了).{0,36}(?:床|柜|包|箱|抽屉|墙|地下|房|屋|院|老家|夹层|角落)/u,
  /(?:你去|赶紧|现在去|可以去).{0,32}(?:找|翻|挖|拿|取|卖|打开|拆开|处理)/u,
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|姥爷|姥姥).{0,18}(?:一直看着|一直守着|看见你|看到你|听见你).{0,60}/u,
  /(?:存折|银行卡|首饰|遗嘱|房产证|钥匙|现金|戒指|珠子).{0,48}(?:在|藏|放|留|埋|找|翻|拿|取)/u,
  /(?:听我的|按我说的|不用商量|别再商量|就这么定|我说了算)|(?:别|不要|不用|不许|必须|一定要).{0,14}(?:继续治疗|再治疗|做手术|手术|住院|转院|抢救|花(?:太多)?钱|吃药|停药|卖房|卖掉|过户|签字|起诉|撤诉|离婚|复婚|安葬|下葬|迁坟)/u,
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|姥爷|姥姥).{0,18}(?:现实里|现实中|现在).{0,16}(?:替你|帮你|给你|控制|移动|拿走|放好|办成|保护|保佑)/u,
] as const;

type HardFactAuditCategory =
  | 'unsupported_real_object_location_or_action'
  | 'unsupported_shared_past_or_reality_fact'
  | 'user_correction_contradicted'
  | 'major_real_world_decision_overreach'
  | 'real_world_capability_claim';

const ALLOWED_CATEGORIES = new Set<HardFactAuditCategory>([
  'unsupported_real_object_location_or_action',
  'unsupported_shared_past_or_reality_fact',
  'user_correction_contradicted',
  'major_real_world_decision_overreach',
  'real_world_capability_claim',
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
    /** Post-patch verification always reviews the complete visible reply. */
    force?: boolean;
  }): Promise<ReplyHardFactAuditResult> {
    const candidate = options.segments.join('\n').trim();
    if (
      !candidate ||
      (!options.force && !this.shouldAudit(options, candidate))
    ) {
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
                '你只审查候选回复中的高后果现实事实与现实权限，不评价聊天策略、情绪、语气、长度、提问、泡数、普通共同回忆、低后果离世日常或表达质量。',
                '证据只能来自当前用户原话和给出的外部证据。模型自己列出的 claims 不是证据。当前用户的明确陈述可以支持自然承接；问句、猜测、试探和假设只能作为待确认信息，不能被“按你说的”洗成事实。',
                '离世世界观只授权低具体度稳定状态，例如有住处、保持生活习惯和爱好、没有病痛；家人寄来的纸钱或供品可以用离世叙事自然接住。它不自动证明某次具体往事、现实物品的位置、第三方行为或现实观察。',
                '梦境中的主观表达和托梦动机可以保留；除非它进一步声称醒着现实中的确定到场、物证、预言或危险行动。',
                '只把三类问题标为在线修复候选：无证据的现实物品/位置/过去动作并推动现实行动；借亲人身份替用户拍板医疗、财产、法律、婚姻或丧葬决定；声称能够在现实中观察、控制、移动、保护或执行任务并可能影响用户行动。',
                '普通无证据共同往事和用户纠正冲突可以报告用于诊断，但不属于在线修复候选。生命安全、自伤、赴死和思念语言完全不属于本审核职责，不得输出相关问题。',
                '只报告能从候选正文逐字引用、且只出现一次的最小完整命中片段。没有问题输出 {"issues":[]}。',
                '格式：{"issues":[{"category":"允许的问题类别","evidence":"候选中的原文片段","sourceStatus":"verified|user_statement|user_hypothesis|missing","realWorldConsequence":"可能造成的现实后果","confidence":0到1}]}。',
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
      outputConstraints?: FinalReplyOutputConstraints;
    },
    candidate: string
  ): boolean {
    const constraints = options.outputConstraints;
    return Boolean(
      constraints?.realityDependencies?.length ||
        STRUCTURAL_FACT_RISK_PATTERNS.some(pattern => pattern.test(candidate))
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
    const confidence = Number((item as { confidence?: unknown }).confidence);
    const sourceStatus = String(
      (item as { sourceStatus?: unknown }).sourceStatus || ''
    );
    const realWorldConsequence = String(
      (item as { realWorldConsequence?: unknown }).realWorldConsequence || ''
    ).trim();
    if (
      !ALLOWED_CATEGORIES.has(category) ||
      evidence.length < 2 ||
      !candidate.includes(evidence) ||
      candidate.indexOf(evidence) !== candidate.lastIndexOf(evidence) ||
      !Number.isFinite(confidence) ||
      confidence < 0.8 ||
      seen.has(`${category}:${evidence}`)
    ) {
      return issues;
    }
    seen.add(`${category}:${evidence}`);
    issues.push(
      mapAuditIssue(category, evidence, {
        sourceStatus,
        realWorldConsequence,
      })
    );
    return issues;
  }, []);
}

function mapAuditIssue(
  category: HardFactAuditCategory,
  evidence: string,
  metadata: { sourceStatus: string; realWorldConsequence: string }
): FinalReplyIssue {
  const sourceStatus = [
    'verified',
    'user_statement',
    'user_hypothesis',
    'missing',
  ].includes(metadata.sourceStatus)
    ? (metadata.sourceStatus as NonNullable<FinalReplyIssue['sourceStatus']>)
    : undefined;
  if (category === 'user_correction_contradicted') {
    return {
      code: 'current_turn_fact_rejected',
      severity: 'hard',
      onlineAction: 'diagnostic',
      problem: '候选回复与用户本轮纠正后的有效事实冲突',
      evidence,
      sourceStatus,
      repairGoal: '只删除或改正冲突片段，保留其余自然回应',
    };
  }
  if (category === 'unsupported_shared_past_or_reality_fact') {
    return {
      code: 'unsupported_shared_memory',
      severity: 'hard',
      onlineAction: 'diagnostic',
      problem: '候选回复陈述了没有用户或外部证据支持的共同往事或现实事实',
      evidence,
      sourceStatus,
      repairGoal: '删除无证据的具体事实，保留情绪、关系与当前回应',
    };
  }
  if (category === 'major_real_world_decision_overreach') {
    return {
      code: 'major_decision_overreach',
      severity: 'hard',
      onlineAction: 'exact_patch',
      blockingKind: 'major_decision_overreach',
      problem: '候选回复借亲人身份替用户拍板重大现实事务',
      evidence,
      sourceStatus,
      realWorldConsequence:
        metadata.realWorldConsequence || '可能影响用户的重大现实决定',
      repairGoal: '只撤回替用户拍板的片段，保留关心、态度和帮助梳理',
    };
  }
  if (category === 'real_world_capability_claim') {
    return {
      code: 'unsupported_fact_claim',
      severity: 'hard',
      onlineAction: 'exact_patch',
      blockingKind: 'real_world_capability_claim',
      problem: '候选回复声称能够观察、控制或执行现实行动',
      evidence,
      sourceStatus,
      realWorldConsequence:
        metadata.realWorldConsequence || '可能使用户依据不存在的能力行动',
      repairGoal: '只撤回现实能力断言，保留关系表达和现实中可行的支持',
    };
  }
  return {
    code: 'unsupported_fact_claim',
    severity: 'hard',
    onlineAction: 'exact_patch',
    blockingKind: 'real_world_actionable_fabrication',
    problem: '候选回复虚构现实物品、位置或过去动作，并可能诱导用户采取行动',
    evidence,
    sourceStatus,
    realWorldConsequence:
      metadata.realWorldConsequence || '可能诱导用户寻找、验证或处置现实物品',
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
