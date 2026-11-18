import { Inject, Provide } from '@midwayjs/core';
import { ChatTraceStage } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { AgentEvidenceItem } from './agent-evidence';
import type { FinalReplyIssue } from './final-reply-validator.service';
import { OpenAIService } from './openai';

const FINAL_PATCH_MAX_TOKENS = 220;
const FINAL_PATCH_TIMEOUT_MS = 12000;

export interface ReplyRevisionUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ReplyRevisionPatch {
  originalSpan: string;
  replacementSpan: string;
  resolvedIssueCode: string;
}

export interface ReplyRevisionResult extends ReplyRevisionPatch {
  usage: ReplyRevisionUsage;
}

@Provide()
export class ReplyRevisionService {
  @Inject()
  openAIService: OpenAIService;

  /** One bounded repair; the caller must validate the result before delivery. */
  async reviseRepeatedReply(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
  }): Promise<{ segments: string[]; usage: ReplyRevisionUsage } | undefined> {
    if (!this.openAIService) return undefined;
    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0.3,
          topP: 0.8,
          reasoningSplit: false,
          thinking: { type: 'disabled' },
          max_tokens: FINAL_PATCH_MAX_TOKENS,
          response_format: { type: 'json_object' },
          trace: {
            stage: ChatTraceStage.revise,
            operation: 'revise.exact_repeated_reply',
          },
          messages: [
            ...options.messages,
            {
              role: 'user',
              content: JSON.stringify({
                instruction:
                  '候选整条回复与之前的回复完全重复。结合完整对话和用户最新表达重新回应一次；理解可能的纠正并更新前提，不强制道歉、提问、建议或安慰，不编造事实。保持原角色及事实、安全边界。只输出 JSON：{"segments":["自然回复"]}。',
                currentUserMessage: options.userQuery,
                repeatedReply: options.segments,
              }),
            },
          ],
        },
        { timeout: FINAL_PATCH_TIMEOUT_MS, maxRetries: 0 }
      );
      const content = response.choices?.[0]?.message?.content;
      let parsed: { segments?: unknown } | undefined;
      try {
        parsed = typeof content === 'string' ? JSON.parse(content) : undefined;
      } catch {
        /* usage still belongs to this attempt */
      }
      const segments = parsed?.segments;
      return {
        segments:
          Array.isArray(segments) &&
          segments.length <= 4 &&
          segments.every(value => typeof value === 'string' && value.trim())
            ? segments.map(value => value.trim())
            : [],
        usage: extractUsage(response),
      };
    } catch {
      return undefined;
    }
  }

  async revise(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    evidence?: AgentEvidenceItem[];
    issue: FinalReplyIssue;
  }): Promise<ReplyRevisionResult | undefined> {
    const issueSpan = options.issue.evidence?.trim() || '';
    const originalSpan = options.segments.join('\n');
    const originalText = options.segments.join('\n');
    if (
      !this.openAIService ||
      options.issue.onlineAction !== 'exact_patch' ||
      !options.issue.blockingKind ||
      !isUniqueExactSpan(originalText, issueSpan)
    ) {
      return undefined;
    }

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0,
          topP: 0.2,
          reasoningSplit: false,
          thinking: { type: 'disabled' },
          max_tokens: 600,
          response_format: { type: 'json_object' },
          trace: {
            stage: ChatTraceStage.revise,
            operation: 'revise.coherent_reply_patch',
          },
          messages: [
            {
              role: 'system',
              content: [
                '# 最终回复组一致性修复',
                '只修复已指出的事实或权限问题，但以完整回复组为单位组织自然表达，避免局部替换后前后矛盾、指代断裂或残留错误前提。',
                '保留原角色、当前问题的有效回答及有依据的内容；不要用叮嘱、认错姿态或审查说明代替回答。',
                '普通喜好、思念与亲密表达可以自然保留；不能编造具体共同经历、现实能力、物品位置或新的行动建议。',
                '撤回错误前提即可，不编造“我其实想说”的理由。不要输出“不能凭空认下来”等内部审核话术。',
                'originalSpan 必须逐字复制 requiredOriginalSpan（完整回复组），replacementSpan 是修复后的完整回复，不能只返回命中片段。',
                '只输出 JSON，不解释。格式：{"originalSpan":"逐字原片段","replacementSpan":"完整自然回复","resolvedIssueCode":"问题码"}',
              ].join('\n'),
            },
            ...selectCompactRevisionContext(options.messages),
            {
              role: 'user',
              content: JSON.stringify({
                currentUserMessage: options.userQuery,
                originalReply: originalText,
                problematicSpan: issueSpan,
                requiredOriginalSpan: originalSpan,
                issue: {
                  code: options.issue.code,
                  blockingKind: options.issue.blockingKind,
                  problem: options.issue.problem,
                  repairGoal: options.issue.repairGoal,
                  sourceStatus: options.issue.sourceStatus,
                  realWorldConsequence: options.issue.realWorldConsequence,
                },
                relevantEvidence: selectRelevantEvidence(
                  options.evidence || [],
                  originalSpan
                ),
              }),
            },
          ],
        },
        { timeout: FINAL_PATCH_TIMEOUT_MS, maxRetries: 0 }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const patch = parseRevisionPatch(content, originalSpan, options.issue);
      if (!patch) {
        return undefined;
      }

      return {
        ...patch,
        usage: extractUsage(response),
      };
    } catch {
      return undefined;
    }
  }
}

function selectCompactRevisionContext(
  messages: ChatCompletionMessageParam[]
): ChatCompletionMessageParam[] {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-4);
}

function selectRelevantEvidence(
  evidence: AgentEvidenceItem[],
  originalSpan: string
): Array<
  Pick<AgentEvidenceItem, 'id' | 'source' | 'text' | 'useMode' | 'status'>
> {
  const spanTerms = new Set(
    originalSpan.match(/[\u3400-\u9fff]{2,}|[a-z0-9]{2,}/gi) || []
  );
  return evidence
    .filter(item => {
      const terms = item.text.match(/[\u3400-\u9fff]{2,}|[a-z0-9]{2,}/gi) || [];
      return terms.some(term => spanTerms.has(term));
    })
    .slice(0, 6)
    .map(item => ({
      id: item.id,
      source: item.source,
      text: item.text.slice(0, 180),
      useMode: item.useMode,
      status: item.status,
    }));
}

function parseRevisionPatch(
  content: string,
  requiredOriginalSpan: string,
  issue: FinalReplyIssue
): ReplyRevisionPatch | undefined {
  try {
    const parsed = JSON.parse(
      content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
    ) as {
      originalSpan?: unknown;
      replacementSpan?: unknown;
      resolvedIssueCode?: unknown;
    };
    const originalSpan =
      typeof parsed.originalSpan === 'string' ? parsed.originalSpan : '';
    const replacementSpan =
      typeof parsed.replacementSpan === 'string'
        ? parsed.replacementSpan.trim()
        : '';
    const resolvedIssueCode =
      typeof parsed.resolvedIssueCode === 'string'
        ? parsed.resolvedIssueCode.trim()
        : '';

    if (
      originalSpan !== requiredOriginalSpan ||
      resolvedIssueCode !== issue.code ||
      replacementSpan === originalSpan ||
      looksLikeProtocolLeak(replacementSpan)
    ) {
      return undefined;
    }

    return { originalSpan, replacementSpan, resolvedIssueCode };
  } catch {
    return undefined;
  }
}

export function applyExactReplyPatch(
  segments: string[],
  patch: ReplyRevisionPatch
): string[] | undefined {
  const original = segments.join('\n');
  if (!isUniqueExactSpan(original, patch.originalSpan)) return undefined;
  const replaced = original.replace(patch.originalSpan, () => patch.replacementSpan);
  if (!replaced.trim()) return undefined;
  // Group-level repair precedes the delivery renderer; no per-bubble patching.
  const next = [replaced];
  return patchPreservesOutsideSpan(segments, next, patch) ? next : undefined;
}

export function patchPreservesOutsideSpan(
  before: string[],
  after: string[],
  patch: ReplyRevisionPatch
): boolean {
  const beforeText = before.join('\n');
  const afterText = after.join('\n');
  if (!isUniqueExactSpan(beforeText, patch.originalSpan)) {
    return false;
  }
  const index = beforeText.indexOf(patch.originalSpan);
  const prefix = beforeText.slice(0, index);
  const suffix = beforeText.slice(index + patch.originalSpan.length);
  return afterText === `${prefix}${patch.replacementSpan}${suffix}`;
}

function isUniqueExactSpan(content: string, span: string): boolean {
  return Boolean(
    span &&
      content.includes(span) &&
      content.indexOf(span) === content.lastIndexOf(span)
  );
}

function looksLikeProtocolLeak(value: string): boolean {
  return /(?:"segments"|"claims"|tool_calls|function|arguments|<analysis>|用户说.{0,20}(?:首先|然后)|作为AI)/s.test(
    value
  );
}

function extractUsage(response: any): ReplyRevisionUsage {
  const number = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    model: typeof response?.model === 'string' ? response.model : undefined,
    promptTokens: number(response?.usage?.prompt_tokens),
    completionTokens: number(response?.usage?.completion_tokens),
    totalTokens: number(response?.usage?.total_tokens),
  };
}
