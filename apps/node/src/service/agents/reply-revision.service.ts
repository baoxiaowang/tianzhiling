import { Inject, Provide } from '@midwayjs/core';
import { ChatTraceStage } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AgentEvidenceItem, AssistantFactClaim } from './agent-evidence';
import type {
  FinalReplyIssue,
  FinalReplyOutputConstraints,
} from './final-reply-validator.service';
import { OpenAIService } from './openai';
import type { TurnDecision } from './turn-decision';

const FINAL_REVISION_MAX_TOKENS = 520;
const FINAL_REVISION_TIMEOUT_MS = 18000;

export interface ReplyRevisionUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ReplyRevisionResult {
  segments: string[];
  claims: AssistantFactClaim[];
  resolvedIssueCodes: string[];
  usage: ReplyRevisionUsage;
}

@Provide()
export class ReplyRevisionService {
  @Inject()
  openAIService: OpenAIService;

  async revise(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    claims?: AssistantFactClaim[];
    evidence?: AgentEvidenceItem[];
    issues: FinalReplyIssue[];
    turnDecision?: TurnDecision;
    outputConstraints?: FinalReplyOutputConstraints;
  }): Promise<ReplyRevisionResult | undefined> {
    if (!this.openAIService || !options.issues.length) {
      return undefined;
    }

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0,
          topP: 0.2,
          max_tokens: FINAL_REVISION_MAX_TOKENS,
          response_format: { type: 'json_object' },
          trace: {
            stage: ChatTraceStage.review,
            operation: 'review.final_revision',
          },
          messages: [
            ...selectCompactRevisionContext(options.messages),
            {
              role: 'system',
              content: [
                '# 最终修订',
                '只修复列出的最终问题，保留初稿已经正确的回答、情绪和关系语气。',
                '不得新增事实、共同经历、现实能力、问题、劝告或承诺。',
                '修复 unsupported_fact_claim 时，不得把一个无证据地点或动作换成另一个；用户要求角色讲自己时，可保留主观感受、态度或不影响现实的离世日常写意，后者 claims 使用 soft_imagination。',
                ...buildIssueSpecificRevisionInstructions(options.issues),
                ...buildRevisionConstraintInstructions(
                  options.outputConstraints
                ),
                '最多改写一次；只输出 JSON，不解释。',
                '格式：{"segments":["可直接发送的正文"],"claims":[],"resolvedIssueCodes":["问题码"]}',
                'claims 只列修订后正文仍保留的具体事实，并绑定证据 ID；没有具体事实就用空数组。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                currentUserMessage: options.userQuery,
                turnDecision: options.turnDecision,
                originalSegments: options.segments,
                originalClaims: options.claims || [],
                evidence: (options.evidence || []).map(item => ({
                  id: item.id,
                  text: item.text,
                  source: item.source,
                  assertionPolicy: item.assertionPolicy,
                  subjectRef: item.subjectRef,
                  factKey: item.factKey,
                  useMode: item.useMode,
                })),
                issues: options.issues,
                outputConstraints: options.outputConstraints,
              }),
            },
          ],
        },
        {
          timeout: FINAL_REVISION_TIMEOUT_MS,
          maxRetries: 0,
        }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const parsed = parseRevision(content);

      if (!parsed?.segments.length) {
        return undefined;
      }

      const usage = response.usage;
      return {
        ...parsed,
        usage: {
          model:
            typeof response.model === 'string' ? response.model : undefined,
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          totalTokens: usage?.total_tokens,
        },
      };
    } catch {
      return undefined;
    }
  }
}

function buildIssueSpecificRevisionInstructions(
  issues: FinalReplyIssue[]
): string[] {
  const codes = new Set(issues.map(issue => issue.code));
  const instructions: string[] = [];

  if (codes.has('care_rebuffed_with_dismissal')) {
    instructions.push(
      '用户正在关心当前角色：先正面回答，再接纳关心。不得出现“别挂心、别担心、别惦记、别操心”及同义表达，也不要马上把关心反转成对用户的叮嘱。'
    );
  }
  return instructions;
}

function selectCompactRevisionContext(
  messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-4);
}

function buildRevisionConstraintInstructions(
  constraints?: FinalReplyOutputConstraints
): string[] {
  if (!constraints) {
    return [];
  }

  const instructions: string[] = [];
  if (constraints.requiredSegmentCount) {
    instructions.push(
      `segments 必须恰好 ${constraints.requiredSegmentCount} 项；每项都是可独立发送的完整气泡，不能把一句话截成两半。`
    );
  }
  if (constraints.preferredRange) {
    instructions.push(
      `segments 全部正文去掉空白后合计必须为 ${constraints.preferredRange.minCharacters}-${constraints.preferredRange.maxCharacters} 个可见字符；优先补贴着本轮具体事物的角色侧感受或不同反应，不复读、不用空话凑字数。`
    );
  }
  if (constraints.mustKeepTurnWithAssistant) {
    instructions.push(
      '用户本轮要求角色主动说内容：删除反问、“你来说”和把话题推回用户的句子；由角色正面给一个具体但轻量的当下内容，不用通用在场、想念或叮嘱充数。'
    );
  }
  return instructions;
}

function parseRevision(
  content: string
): Omit<ReplyRevisionResult, 'usage'> | undefined {
  try {
    const parsed = JSON.parse(content) as {
      segments?: unknown;
      claims?: unknown;
      resolvedIssueCodes?: unknown;
    };
    const segments = Array.isArray(parsed.segments)
      ? parsed.segments
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const claims = Array.isArray(parsed.claims)
      ? parsed.claims.filter(isAssistantFactClaim)
      : [];
    const resolvedIssueCodes = Array.isArray(parsed.resolvedIssueCodes)
      ? parsed.resolvedIssueCodes
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
      : [];

    return segments.length
      ? { segments, claims, resolvedIssueCodes }
      : undefined;
  } catch {
    return undefined;
  }
}

function isAssistantFactClaim(value: unknown): value is AssistantFactClaim {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const claim = value as Partial<AssistantFactClaim>;
  return (
    typeof claim.text === 'string' &&
    typeof claim.kind === 'string' &&
    Array.isArray(claim.evidenceIds) &&
    claim.evidenceIds.every(item => typeof item === 'string')
  );
}
