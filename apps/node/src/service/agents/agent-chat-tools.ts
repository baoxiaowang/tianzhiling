import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const AGENT_CHAT_TOOL_VERSION = 'agent_chat_tools_v1' as const;

export const AGENT_CHAT_TOOL_NAMES = ['lookup_chat_evidence'] as const;

export type AgentChatToolName = (typeof AGENT_CHAT_TOOL_NAMES)[number];
export type AgentChatToolConfiguredMode = 'off' | 'shadow' | 'active';
export type AgentChatToolTurnMode = 'off' | 'shadow' | 'active';

export interface AgentChatToolConfig {
  mode?: AgentChatToolConfiguredMode;
  shadowSampleRate?: number;
  activeSampleRate?: number;
  maxCallsPerTurn?: number;
  timeoutMs?: number;
}

export interface AgentChatToolTurnPlan {
  version: typeof AGENT_CHAT_TOOL_VERSION;
  configuredMode: AgentChatToolConfiguredMode;
  mode: AgentChatToolTurnMode;
  eligible: boolean;
  sampled: boolean;
  availableTools: AgentChatToolName[];
  reason: string;
  plannerMemoryRequested: boolean;
  maxCalls: number;
  timeoutMs: number;
}

export interface AgentChatToolDecision {
  name: AgentChatToolName;
  arguments: Record<string, unknown>;
  reason: string;
}

export interface AgentChatToolDecisionParseResult {
  decisions: AgentChatToolDecision[];
  invalidCount: number;
}

export type AgentChatToolConflictStatus =
  | 'none'
  | 'conflicted'
  | 'superseded'
  | 'unknown';

export interface AgentChatToolEvidenceItem {
  id: string;
  source: string;
  sourceAt: string;
  confidence: number;
  relevanceScore?: number;
  sourceMessageId?: string;
  personId?: string;
  memoryKind?: string;
  rank?: number;
  conflictStatus: AgentChatToolConflictStatus;
  subjectRef?: string;
  factKey?: string;
  value: string;
}

export interface AgentChatToolDiagnostics {
  policyVersion: 'person_first_v1';
  requestCount: number;
  candidateCount: number;
  selectedCount: number;
  personResolvedCount: number;
  personUnresolvedCount: number;
  wrongPersonCount: number;
  personScopedCount: number;
  rawFallbackCount: number;
  retrievalFailureCount: number;
  lazyBackfillQueued: number;
  maxScore?: number;
  minScore?: number;
  scoreGap?: number;
}

export interface AgentChatToolResult {
  version: typeof AGENT_CHAT_TOOL_VERSION;
  tool: AgentChatToolName;
  status: 'ok' | 'empty' | 'denied' | 'invalid_arguments' | 'error';
  items: AgentChatToolEvidenceItem[];
  truncated: boolean;
  errorCode?: string;
  diagnostics?: AgentChatToolDiagnostics;
}

const DEFAULT_MAX_CALLS = 1;
const DEFAULT_TIMEOUT_MS = 2500;
const TOOL_NAME_SET = new Set<string>(AGENT_CHAT_TOOL_NAMES);

export const AGENT_CHAT_TOOL_DEFINITIONS: Record<
  AgentChatToolName,
  ChatCompletionTool
> = {
  lookup_chat_evidence: {
    type: 'function',
    function: {
      name: 'lookup_chat_evidence',
      description:
        '仅在当前上下文不足以可靠回答具体事实时，一次批量查找人物资料、家庭事实或已确认的关系记忆。它只补充证据，不决定回复策略。',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requests: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                subjectRef: { type: 'string', maxLength: 40 },
                need: { type: 'string', minLength: 1, maxLength: 80 },
                sources: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 3,
                  items: {
                    type: 'string',
                    enum: [
                      'agent_profile',
                      'family_facts',
                      'relationship_memory',
                      'confirmed_history',
                    ],
                  },
                },
              },
              required: ['subjectRef', 'need', 'sources'],
            },
          },
        },
        required: ['requests'],
      },
    },
  },
};

export function resolveAgentChatToolTurnPlan(options: {
  config?: AgentChatToolConfig;
  stableKey: string;
  currentQuery: string;
  plannerMemoryRequested?: boolean;
  replyBrief?: unknown;
  planningMode?: string;
  planningReason?: string;
}): AgentChatToolTurnPlan {
  const configuredMode = normalizeConfiguredMode(options.config?.mode);
  const enabledMode: AgentChatToolTurnMode = configuredMode;
  const hasCurrentQuery = Boolean(options.currentQuery.trim());
  // The semantic planner is the sole eligibility signal in active mode. This
  // keeps keyword heuristics out of tool exposure and avoids charging every
  // ordinary turn for a tool schema that cannot add useful evidence.
  const eligible =
    hasCurrentQuery &&
    (configuredMode === 'shadow' || Boolean(options.plannerMemoryRequested));
  const sampleRate =
    configuredMode === 'active'
      ? normalizeSampleRate(options.config?.activeSampleRate, 1)
      : configuredMode === 'shadow'
      ? normalizeSampleRate(options.config?.shadowSampleRate, 0.2)
      : 0;
  const sampled =
    enabledMode !== 'off' &&
    eligible &&
    isStableSampleSelected(options.stableKey, sampleRate);
  const mode: AgentChatToolTurnMode = !sampled ? 'off' : enabledMode;

  return {
    version: AGENT_CHAT_TOOL_VERSION,
    configuredMode,
    mode,
    eligible,
    sampled,
    availableTools:
      mode === 'active' || mode === 'shadow' ? [...AGENT_CHAT_TOOL_NAMES] : [],
    reason: !hasCurrentQuery
      ? 'empty_turn'
      : !eligible
      ? 'planner_context_complete'
      : !sampled
      ? 'not_sampled'
      : configuredMode === 'shadow'
      ? 'shadow_observation'
      : 'available',
    plannerMemoryRequested: Boolean(options.plannerMemoryRequested),
    maxCalls: normalizeInteger(
      options.config?.maxCallsPerTurn,
      DEFAULT_MAX_CALLS,
      1,
      DEFAULT_MAX_CALLS
    ),
    timeoutMs: normalizeInteger(
      options.config?.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      300,
      10000
    ),
  };
}

export function buildAgentChatToolPrompt(plan: AgentChatToolTurnPlan): string {
  if (plan.mode === 'shadow') {
    return [
      '# 工具决策影子',
      '本轮不执行工具，但请输出你会调用哪些工具。判断时把长期检索结果视为尚未提供；近期消息和已确认资料仍算已有。',
      '只按“缺失概念”决定，不要按触发词。当前消息或最近对话已经提到的事实禁止查询。足够时用 []。',
      '工具：lookup_chat_evidence（一次批量查询外部证据）。',
      '输出格式：[{"name":"工具名","arguments":{...},"reason":"为什么需要/不需要"}]，最多两项。',
    ].join('\n');
  }

  if (plan.mode === 'active') {
    return [
      '# 外部证据工具（非决策信息）',
      '你是本轮回复的唯一决策者。只有当前对话与已提供资料不足以可靠回答具体事实时，才调用 lookup_chat_evidence。',
      '工具结果只补充证据，不替你判断情绪、安排动作、决定是否提问或收尾；已有信息不要重复查询。最多调用一次，取得结果后结合完整上下文自然回复。',
    ].join('\n');
  }

  return '';
}

export function buildAgentChatToolDecisionSchema(
  plan: AgentChatToolTurnPlan
): Record<string, unknown> | undefined {
  if (plan.mode !== 'shadow') {
    return undefined;
  }

  return {
    name: AGENT_CHAT_TOOL_NAMES.join('|'),
    arguments: {},
    reason: '缺失概念或无需调用的判断依据',
  };
}

export function normalizeAgentChatToolDecisions(
  value: unknown,
  allowedNames: AgentChatToolName[] = [...AGENT_CHAT_TOOL_NAMES]
): AgentChatToolDecisionParseResult {
  if (!Array.isArray(value)) {
    return { decisions: [], invalidCount: value == null ? 0 : 1 };
  }

  const allowed = new Set<string>(allowedNames);
  const decisions: AgentChatToolDecision[] = [];
  let invalidCount = 0;

  for (const item of value.slice(0, 4)) {
    if (!item || typeof item !== 'object') {
      invalidCount += 1;
      continue;
    }

    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    const args = normalizeAgentChatToolArguments(name, raw.arguments);

    if (!allowed.has(name) || !TOOL_NAME_SET.has(name) || !args) {
      invalidCount += 1;
      continue;
    }

    decisions.push({
      name: name as AgentChatToolName,
      arguments: args,
      reason: reason.slice(0, 120),
    });
  }

  invalidCount += Math.max(0, value.length - 4);
  return { decisions: decisions.slice(0, 2), invalidCount };
}

export function normalizeAgentChatToolArguments(
  name: string,
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;

  if (name === 'lookup_chat_evidence') {
    if (!hasOnlyKeys(raw, ['requests']) || !Array.isArray(raw.requests)) {
      return null;
    }
    const requests = raw.requests
      .slice(0, 3)
      .map(item => normalizeEvidenceRequest(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    return requests.length ? { requests } : null;
  }

  return null;
}

export function getAgentChatToolDefinitions(
  names: AgentChatToolName[]
): ChatCompletionTool[] {
  return Array.from(new Set(names)).map(
    name => AGENT_CHAT_TOOL_DEFINITIONS[name]
  );
}

function normalizeEvidenceRequest(
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!hasOnlyKeys(raw, ['subjectRef', 'need', 'sources'])) return null;
  const subjectRef = normalizeString(raw.subjectRef, 40);
  const need = normalizeString(raw.need, 80);
  const allowedSources = new Set([
    'agent_profile',
    'family_facts',
    'relationship_memory',
    'confirmed_history',
  ]);
  const sources = normalizeStringArray(raw.sources, 3, 30).filter(source =>
    allowedSources.has(source)
  );
  return need && sources.length ? { subjectRef, need, sources } : null;
}

function normalizeConfiguredMode(
  value: AgentChatToolConfiguredMode | undefined
): AgentChatToolConfiguredMode {
  return value === 'shadow' || value === 'active' ? value : 'off';
}

function normalizeSampleRate(
  value: number | undefined,
  fallback: number
): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(1, Number(value)))
    : fallback;
}

function isStableSampleSelected(value: string, rate: number): boolean {
  if (rate <= 0) {
    return false;
  }
  if (rate >= 1) {
    return true;
  }

  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff < rate;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: string[]
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === allowed.length && keys.every(key => allowed.includes(key))
  );
}

function normalizeString(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function normalizeStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.map(item => normalizeString(item, maxLength)).filter(Boolean))
  ).slice(0, maxItems);
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.max(min, Math.min(max, parsed))
    : fallback;
}
