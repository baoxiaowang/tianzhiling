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

  async revise(options: {
    messages: ChatCompletionMessageParam[];
    userQuery: string;
    segments: string[];
    evidence?: AgentEvidenceItem[];
    issue: FinalReplyIssue;
  }): Promise<ReplyRevisionResult | undefined> {
    const originalSpan = options.issue.evidence?.trim() || '';
    const originalText = options.segments.join('\n');
    if (
      !this.openAIService ||
      options.issue.onlineAction !== 'exact_patch' ||
      !options.issue.blockingKind ||
      !isUniqueExactSpan(originalText, originalSpan)
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
          max_tokens: FINAL_PATCH_MAX_TOKENS,
          response_format: { type: 'json_object' },
          trace: {
            stage: ChatTraceStage.revise,
            operation: 'revise.exact_span_patch',
          },
          messages: [
            {
              role: 'system',
              content: [
                '# 最终正文精确补丁',
                '你不是第二个回复作者，也不重新规划这轮聊天。只替换指定的一个高后果片段；原回复其他字符由程序原样保留。',
                'replacementSpan 要像当前亲人角色自然说话，只撤回不可信现实事实、现实能力或替用户拍板的部分。',
                '不得新增事实、地点、物品、共同经历、现实能力、决定、建议、问题、承诺或安全话术。',
                '不得改写长度、泡数、温度、主动贡献、提问、收尾、梦境、供品或普通离世世界内容。',
                'originalSpan 必须逐字复制 requiredOriginalSpan，不得扩大、缩小或改写。',
                '只输出 JSON，不解释。格式：{"originalSpan":"逐字原片段","replacementSpan":"替换文字，可为空","resolvedIssueCode":"问题码"}',
              ].join('\n'),
            },
            ...selectCompactRevisionContext(options.messages),
            {
              role: 'user',
              content: JSON.stringify({
                currentUserMessage: options.userQuery,
                originalReply: originalText,
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
  const indexes = segments
    .map((segment, index) =>
      segment.includes(patch.originalSpan) ? index : -1
    )
    .filter(index => index >= 0);
  if (indexes.length !== 1) {
    return undefined;
  }
  const segmentIndex = indexes[0];
  if (
    segments[segmentIndex].indexOf(patch.originalSpan) !==
    segments[segmentIndex].lastIndexOf(patch.originalSpan)
  ) {
    return undefined;
  }

  const next = [...segments];
  next[segmentIndex] = next[segmentIndex].replace(
    patch.originalSpan,
    patch.replacementSpan
  );
  const compacted = next.filter(segment => segment.trim().length > 0);
  return patchPreservesOutsideSpan(segments, compacted, patch)
    ? compacted
    : undefined;
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
