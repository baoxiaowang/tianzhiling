import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ReplyBrief } from './reply-brief.service';
import type {
  ReplyPlanningDecision,
  ReplyPlanningMode,
} from './reply-intent-classifier.service';

export const AGENT_CHAT_TOOL_VERSION = 'agent_chat_tools_v1' as const;

export const AGENT_CHAT_TOOL_NAMES = [
  'search_relationship_memory',
  'get_family_facts',
  'get_persona_evidence',
  'record_user_correction',
] as const;

export type AgentChatToolName = (typeof AGENT_CHAT_TOOL_NAMES)[number];
export type AgentChatToolConfiguredMode = 'off' | 'shadow' | 'active';
export type AgentChatToolTurnMode =
  | 'off'
  | 'shadow'
  | 'active'
  | 'planner_fallback';

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
  conflictStatus: AgentChatToolConflictStatus;
  subjectRef?: string;
  factKey?: string;
  value: string;
}

export interface AgentChatToolResult {
  version: typeof AGENT_CHAT_TOOL_VERSION;
  tool: AgentChatToolName;
  status: 'ok' | 'empty' | 'denied' | 'invalid_arguments' | 'error';
  items: AgentChatToolEvidenceItem[];
  truncated: boolean;
  errorCode?: string;
}

const DEFAULT_MAX_CALLS = 4;
const DEFAULT_TIMEOUT_MS = 2500;
const TOOL_NAME_SET = new Set<string>(AGENT_CHAT_TOOL_NAMES);

export const AGENT_CHAT_TOOL_DEFINITIONS: Record<
  AgentChatToolName,
  ChatCompletionTool
> = {
  search_relationship_memory: {
    type: 'function',
    function: {
      name: 'search_relationship_memory',
      description:
        '仅在当前上下文缺少共同经历或关系记忆时，按缺失概念检索；已有信息不得重复查询。',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          missingConcepts: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string', minLength: 1, maxLength: 40 },
          },
          subjectRef: { type: 'string', maxLength: 40 },
          limit: { type: 'integer', minimum: 1, maximum: 6 },
        },
        required: ['missingConcepts', 'subjectRef', 'limit'],
      },
    },
  },
  get_family_facts: {
    type: 'function',
    function: {
      name: 'get_family_facts',
      description:
        '读取已确认的家庭关系和家庭成员当前事实；不读取或推断共同往事。',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subjectRefs: {
            type: 'array',
            maxItems: 4,
            items: { type: 'string', minLength: 1, maxLength: 40 },
          },
          limit: { type: 'integer', minimum: 1, maximum: 8 },
        },
        required: ['subjectRefs', 'limit'],
      },
    },
  },
  get_persona_evidence: {
    type: 'function',
    function: {
      name: 'get_persona_evidence',
      description:
        '读取支持本轮说话方式的人物证据，只回答怎么说，不提供现实事实或共同经历。',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dimensions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'string',
              enum: ['tone', 'wording', 'temperament', 'values', 'habits'],
            },
          },
          situation: { type: 'string', minLength: 1, maxLength: 80 },
          limit: { type: 'integer', minimum: 1, maximum: 6 },
        },
        required: ['dimensions', 'situation', 'limit'],
      },
    },
  },
  record_user_correction: {
    type: 'function',
    function: {
      name: 'record_user_correction',
      description:
        '仅在用户本轮明确否定旧说法时，记录被否定事实和用户明确给出的替代事实；没有替代就留空。',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subjectRef: { type: 'string', minLength: 1, maxLength: 40 },
          correctionKind: {
            type: 'string',
            enum: ['fact', 'relationship', 'memory', 'persona'],
          },
          rejectedFact: { type: 'string', minLength: 1, maxLength: 160 },
          replacementFact: { type: 'string', maxLength: 160 },
        },
        required: [
          'subjectRef',
          'correctionKind',
          'rejectedFact',
          'replacementFact',
        ],
      },
    },
  },
};

export function resolveAgentChatToolTurnPlan(options: {
  config?: AgentChatToolConfig;
  stableKey: string;
  currentQuery: string;
  replyBrief: ReplyBrief;
  planningMode: ReplyPlanningMode;
  planningReason: ReplyPlanningDecision['reason'];
  plannerMemoryRequested: boolean;
}): AgentChatToolTurnPlan {
  const configuredMode = normalizeConfiguredMode(options.config?.mode);
  const eligible = isToolDecisionEligible(options);
  const difficult = isDifficultActiveScene(options.replyBrief);
  const sampleRate =
    configuredMode === 'active'
      ? normalizeSampleRate(options.config?.activeSampleRate, 0)
      : normalizeSampleRate(options.config?.shadowSampleRate, 0.2);
  const sampled =
    configuredMode !== 'off' &&
    eligible &&
    isStableSampleSelected(options.stableKey, sampleRate);
  const mode: AgentChatToolTurnMode = !sampled
    ? 'off'
    : configuredMode === 'active' && difficult
    ? 'planner_fallback'
    : configuredMode;

  return {
    version: AGENT_CHAT_TOOL_VERSION,
    configuredMode,
    mode,
    eligible,
    sampled,
    availableTools:
      mode === 'shadow' || mode === 'active' ? [...AGENT_CHAT_TOOL_NAMES] : [],
    reason: !eligible
      ? 'ineligible_turn'
      : !sampled
      ? 'not_sampled'
      : mode === 'planner_fallback'
      ? 'difficult_scene'
      : options.planningReason,
    plannerMemoryRequested: options.plannerMemoryRequested,
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
      '工具：search_relationship_memory（按缺失概念查关系记忆，最多4个概念）; get_family_facts（读取已确认家庭事实）; get_persona_evidence（读取人物风格证据）; record_user_correction（记录用户明确纠正）。',
      '输出格式：[{"name":"工具名","arguments":{...},"reason":"为什么需要/不需要"}]，最多两项。',
    ].join('\n');
  }

  if (plan.mode === 'active') {
    return [
      '# 工具使用',
      '仅在当前上下文确有缺失时调用已注册工具；已有信息禁止重复查询。最多一轮，取得结果后直接回复。',
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

  if (name === 'search_relationship_memory') {
    if (!hasOnlyKeys(raw, ['missingConcepts', 'subjectRef', 'limit'])) {
      return null;
    }
    const missingConcepts = normalizeStringArray(raw.missingConcepts, 4, 40);
    const subjectRef = normalizeString(raw.subjectRef, 40);
    const limit = normalizeInteger(raw.limit, 0, 1, 6);
    return missingConcepts.length && limit
      ? { missingConcepts, subjectRef, limit }
      : null;
  }

  if (name === 'get_family_facts') {
    if (!hasOnlyKeys(raw, ['subjectRefs', 'limit'])) {
      return null;
    }
    const subjectRefs = normalizeStringArray(raw.subjectRefs, 4, 40);
    const limit = normalizeInteger(raw.limit, 0, 1, 8);
    return limit ? { subjectRefs, limit } : null;
  }

  if (name === 'get_persona_evidence') {
    if (!hasOnlyKeys(raw, ['dimensions', 'situation', 'limit'])) {
      return null;
    }
    const dimensions = normalizeStringArray(raw.dimensions, 3, 20).filter(
      item =>
        ['tone', 'wording', 'temperament', 'values', 'habits'].includes(item)
    );
    const situation = normalizeString(raw.situation, 80);
    const limit = normalizeInteger(raw.limit, 0, 1, 6);
    return dimensions.length && situation && limit
      ? { dimensions, situation, limit }
      : null;
  }

  if (name === 'record_user_correction') {
    if (
      !hasOnlyKeys(raw, [
        'subjectRef',
        'correctionKind',
        'rejectedFact',
        'replacementFact',
      ])
    ) {
      return null;
    }
    const subjectRef = normalizeString(raw.subjectRef, 40);
    const correctionKind = normalizeString(raw.correctionKind, 20);
    const rejectedFact = normalizeString(raw.rejectedFact, 160);
    const replacementFact = normalizeString(raw.replacementFact, 160);
    return subjectRef &&
      ['fact', 'relationship', 'memory', 'persona'].includes(correctionKind) &&
      rejectedFact
      ? { subjectRef, correctionKind, rejectedFact, replacementFact }
      : null;
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

function isToolDecisionEligible(options: {
  currentQuery: string;
  replyBrief: ReplyBrief;
  planningMode: ReplyPlanningMode;
  plannerMemoryRequested: boolean;
}): boolean {
  if (options.planningMode === 'semantic') {
    return true;
  }

  if (options.plannerMemoryRequested || options.replyBrief.strictGrounding) {
    return true;
  }

  return (
    options.replyBrief.mode === 'family' ||
    options.replyBrief.mode === 'memory' ||
    Boolean(options.replyBrief.correctionPolicy) ||
    /不像你|你以前|你记得|咱们|我们以前|家里|孩子|爸爸|妈妈/.test(
      options.currentQuery
    )
  );
}

function isDifficultActiveScene(brief: ReplyBrief): boolean {
  return (
    brief.riskLevel !== 'none' ||
    brief.realityDependencies.length > 0 ||
    (brief.objectPlan?.ambiguousMentions.length || 0) > 0 ||
    brief.intents.length > 2
  );
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
