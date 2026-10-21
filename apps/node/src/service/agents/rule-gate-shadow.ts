/**
 * 高置信规则门的 shadow / active 记录。
 *
 * shadow 只记录“如果启用会跳过什么”；active 才真正跳过。
 */

export const RULE_GATE_PREFIX = '[rule-gate]';
export const LEGACY_RULE_GATE_PREFIX = '[rule-gate-shadow]';

export type RuleGateMode = 'shadow' | 'active';
export type RuleGateName = 'structured_memory_enqueue';

export interface RuleGateShadowRecord {
  gate: RuleGateName;
  mode: RuleGateMode;
  action: 'would_skip' | 'skip';
  reason: string;
  textLength: number;
  messageId?: string;
  at: string;
}

export function isPureSocialTurn(text: string): boolean {
  const compact = (text || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？!?、…~～,.]/g, '');
  if (!compact || compact.length > 12) return false;
  return /^(?:嗯+|恩+|哦+|噢+|好|好的|好呀|好哒|行|可以|收到|知道了|明白了|谢谢|谢谢你|晚安|早安|在吗|在不在|哈哈+|呵呵|唉+|哎+|是嘛|真的吗|然后呢|继续说|你说|没事|没关系)$/.test(
    compact
  );
}

export function shouldSkipStructuredMemoryEnqueue(
  text: string,
  mode: RuleGateMode
): boolean {
  return mode === 'active' && isPureSocialTurn(text);
}

export function getRuleGateMode(
  env: NodeJS.ProcessEnv = process.env
): RuleGateMode {
  const raw = (env.RULE_GATE_MODE || 'active').trim().toLowerCase();
  return raw === 'shadow' ? 'shadow' : 'active';
}

export function buildRuleGateShadowRecord(options: {
  gate: RuleGateName;
  mode?: RuleGateMode;
  action?: 'would_skip' | 'skip';
  reason: string;
  textLength: number;
  messageId?: string;
  now?: Date;
}): RuleGateShadowRecord {
  const mode = options.mode || 'shadow';
  return {
    gate: options.gate,
    mode,
    action: options.action || (mode === 'active' ? 'skip' : 'would_skip'),
    reason: options.reason,
    textLength: Math.max(0, Math.round(options.textLength || 0)),
    ...(options.messageId ? { messageId: options.messageId } : {}),
    at: (options.now || new Date()).toISOString(),
  };
}

export function formatRuleGateShadowLine(record: RuleGateShadowRecord): string {
  return `${RULE_GATE_PREFIX} ${JSON.stringify(record)}`;
}

export function shouldSampleRuleGateShadow(
  env: NodeJS.ProcessEnv = process.env,
  random: () => number = Math.random
): boolean {
  const raw = env.RULE_GATE_SHADOW_SAMPLE_RATE;
  const rate = raw === undefined ? 0.1 : Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) return false;
  return random() < Math.min(1, rate);
}
