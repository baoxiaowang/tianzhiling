import type {
  MemoryOpenItemState,
  MemoryOpenItemStateEvent,
} from '@tzl/entities';

export const MEMORY_MODULE_VERSION = 'memory_module_v1' as const;

export type MemorySwitchMode = 'off' | 'shadow' | 'active';

export type MemoryEvidenceKind =
  | 'utterance'
  | 'group_member'
  | 'group_summary'
  | 'fact';

/**
 * 一条可用的记忆证据。
 * 三条硬约束：只返回用户原话；必须能回到原话（sourceMessageIds 非空）；
 * 引擎只负责"找出来"，过滤与人物对齐由策略层统一做。
 */
export interface MemoryEvidence {
  id: string;
  kind: MemoryEvidenceKind;
  text: string;
  role?: 'user' | 'assistant';
  occurredAt?: string;
  sourceMessageIds: string[];
  groupId?: string;
  groupTitle?: string;
  personRef?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  score?: number;
  /** quote=可按原话引用；context=只能当背景，不得作为用户说过的事实断言。 */
  assertPolicy: 'quote' | 'context';
  engine: string;
}

export interface MemoryRecallDiagnostics {
  engine: string;
  mode: MemorySwitchMode;
  candidateCount: number;
  selectedCount: number;
  groupCount?: number;
  skipReason?: string;
  errorCode?: string;
  elapsedMs?: number;
}

export interface MemoryRecallRequest {
  userId: string;
  conversationId: string;
  agentId: string;
  /** 用户这一轮的原话（未经拼接）。过滤与人物对齐都基于它。 */
  currentUserText: string;
  /** 当前这轮消息 id，必须排除。 */
  currentTurnMessageIds: string[];
  /** 这一轮在说谁（由上层人物对齐给出）。引擎可据此缩小范围，不得自己认定人物关系。 */
  focusPersonRef?: string;
  /** 已经在上下文里的最近消息，用于去重。 */
  recentMessages?: Array<{
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
  }>;
  limit: number;
  now?: Date;
}

export interface MemoryShadowDiagnostics {
  engine: string;
  status: MemoryRecallResult['status'];
  candidateCount: number;
  selectedCount: number;
  evidenceIds: string[];
  /** 只留极短片段便于人工抽检；正文仍按 id 回原话取。 */
  evidencePreviews: string[];
  errorCode?: string;
  elapsedMs?: number;
}

export interface MemoryRecallResult {
  evidence: MemoryEvidence[];
  status: 'ok' | 'empty' | 'skipped' | 'failed';
  diagnostics: MemoryRecallDiagnostics;
  /** shadow 模式下影子引擎的对照结果：只记录，不注入。 */
  shadow?: MemoryShadowDiagnostics;
}

export interface MemoryIngestRequest {
  userId: string;
  conversationId: string;
  agentId: string;
  /** 只传用户原话（AI 的话不作为用户记忆）。 */
  messages: Array<{
    messageId: string;
    content: string;
    occurredAt: Date;
  }>;
  now?: Date;
}

export interface MemoryIngestResult {
  status: 'accepted' | 'skipped' | 'deferred' | 'failed';
  taskIds?: string[];
  reason?: string;
  groupIds?: string[];
}

export interface MemoryOpenItemView {
  id: string;
  groupId?: string;
  /** 事项类别（就医/学业/家人/纪念日……），只用于分组与展示。 */
  topicKey?: string;
  summary: string;
  subjectRef?: string;
  state: MemoryOpenItemState;
  stateHistory: MemoryOpenItemStateEvent[];
  importance: number;
  dueAt?: string;
  lastRaisedAt?: string;
  raisedCount: number;
  sourceMessageIds: string[];
  updatedAt: string;
}

export interface MemoryOpenItemsRequest {
  userId: string;
  conversationId: string;
  agentId: string;
  /** 默认只给"待跟进的事"；纪念日这类"日子"要显式打开才返回。 */
  includeCalendar?: boolean;
  now?: Date;
}

export interface MemoryOpenItemsResult {
  items: MemoryOpenItemView[];
  status: 'ok' | 'empty' | 'failed';
  diagnostics: { engine: string; total: number; errorCode?: string };
}

export interface MemoryUpdateOpenItemRequest {
  userId: string;
  itemId: string;
  /** 状态判定只能由离线抽取任务写；回复链路只写 raised。 */
  state?: MemoryOpenItemState;
  note?: string;
  evidenceMessageId?: string;
  raised?: boolean;
  source?: MemoryOpenItemStateEvent['source'];
  now?: Date;
}

export interface MemoryUpdateOpenItemResult {
  status: 'updated' | 'not_found' | 'failed';
  item?: MemoryOpenItemView;
}

export type MemoryMaintenanceAction =
  | {
      action: 'rebuild';
      scope: 'user' | 'all';
      userId?: string;
      fromMessageAt?: Date;
    }
  | {
      action: 'regroup';
      userId: string;
      groupIds?: string[];
      fromMessageAt?: Date;
    }
  | {
      action: 'forget';
      userId: string;
      evidenceIds?: string[];
      groupIds?: string[];
      messageIds?: string[];
    }
  | { action: 'inspect'; userId: string; conversationId?: string }
  | { action: 'purgeUser'; userId: string };

export interface MemoryMaintenanceResult {
  status: 'ok' | 'accepted' | 'failed';
  affected?: number;
  detail?: Record<string, unknown>;
}

export interface MemoryCapabilities {
  engine: string;
  supports: {
    events: boolean;
    openItems: boolean;
    timeIntervals: boolean;
    shadowRecord: boolean;
    rebuild: boolean;
    audit: boolean;
  };
  limits: {
    maxEvidencePerRecall: number;
    maxGroupMembers: number;
    recallBudgetMs: number;
  };
}

/** 上层唯一入口。切换引擎只换这个接口背后的实现。 */
export interface MemoryModule {
  capabilities(): MemoryCapabilities;
  ingest(request: MemoryIngestRequest): Promise<MemoryIngestResult>;
  recall(request: MemoryRecallRequest): Promise<MemoryRecallResult>;
  listOpenItems(
    request: MemoryOpenItemsRequest
  ): Promise<MemoryOpenItemsResult>;
  updateOpenItem(
    request: MemoryUpdateOpenItemRequest
  ): Promise<MemoryUpdateOpenItemResult>;
  maintain(request: MemoryMaintenanceAction): Promise<MemoryMaintenanceResult>;
}

export interface MemorySwitchConfig {
  mode: MemorySwitchMode;
  primary: string;
  shadow?: string;
  scope: {
    userIds: string[];
    cohortSha256?: string;
  };
  policy: {
    injectLimit: number;
    minEvidenceCharacters: number;
    requireRetrievalKey: boolean;
    personAlignment: boolean;
    dropEmotional: boolean;
    dropQuestion: boolean;
  };
}

export function emptyRecallDiagnostics(
  engine: string,
  mode: MemorySwitchMode,
  errorCode?: string
): MemoryRecallDiagnostics {
  return {
    engine,
    mode,
    candidateCount: 0,
    selectedCount: 0,
    ...(errorCode ? { errorCode } : {}),
  };
}
