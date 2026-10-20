/**
 * 高置信规则门的 shadow 记录。
 *
 * 只记录“如果启用会跳过什么”，不改变任何现有行为。
 */

export const RULE_GATE_SHADOW_PREFIX = '[rule-gate-shadow]';

export type RuleGateName =
  | 'memory_retrieval'
  | 'structured_memory_enqueue';

export interface RuleGateShadowRecord {
  gate: RuleGateName;
  action: 'would_skip';
  reason: string;
  textLength: number;
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

export function buildRuleGateShadowRecord(options: {
  gate: RuleGateName;
  reason: string;
  textLength: number;
  now?: Date;
}): RuleGateShadowRecord {
  return {
    gate: options.gate,
    action: 'would_skip',
    reason: options.reason,
    textLength: Math.max(0, Math.round(options.textLength || 0)),
    at: (options.now || new Date()).toISOString(),
  };
}

export function formatRuleGateShadowLine(record: RuleGateShadowRecord): string {
  return `${RULE_GATE_SHADOW_PREFIX} ${JSON.stringify(record)}`;
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
