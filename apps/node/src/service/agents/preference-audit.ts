/**
 * 偏好规则的 shadow/write 审计记录。
 *
 * 只记录判断结果、key 和消息 ID，不记录用户原话，方便抽样和调规则。
 */

export const PREFERENCE_AUDIT_PREFIX = '[preference-audit]';

export type PreferenceAuditDecision = 'shadow' | 'write' | 'skip';

export interface PreferenceAuditRecord {
  decision: PreferenceAuditDecision;
  kind: string;
  keys: string[];
  messageId?: string;
  userId?: string;
  agentId?: string;
  reason?: string;
  at: string;
}

export function buildPreferenceAuditRecord(options: {
  decision: PreferenceAuditDecision;
  kind: string;
  keys?: string[];
  messageId?: string;
  userId?: string;
  agentId?: string;
  reason?: string;
  now?: Date;
}): PreferenceAuditRecord {
  return {
    decision: options.decision,
    kind: options.kind,
    keys: Array.from(new Set((options.keys || []).filter(Boolean))).slice(0, 8),
    ...(options.messageId ? { messageId: options.messageId } : {}),
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.agentId ? { agentId: options.agentId } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
    at: (options.now || new Date()).toISOString(),
  };
}

export function formatPreferenceAuditLine(record: PreferenceAuditRecord): string {
  return `${PREFERENCE_AUDIT_PREFIX} ${JSON.stringify(record)}`;
}
