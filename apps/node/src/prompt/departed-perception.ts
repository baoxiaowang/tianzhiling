import type { AgentEvidenceItem } from '../service/agents/agent-evidence';
import type { ConversationEmotionStateSummary } from '../service/agents/agent-emotion-state.service';
import type { ReplyBrief } from '../service/agents/reply-brief.service';

// ── 感知维度注册表 ──────────────────────────────────────────────
// 每个维度独立控制：id、中文标签、在不同输出级别下的表达粒度
// salience: "always"=始终出场 "contextual"=有内容才出场 "suppressible"=可被场景压制

export interface PerceptionDimension {
  id: string;
  label: string;
  salience: 'always' | 'contextual' | 'suppressible';
}

export const PERCEPTION_DIMENSIONS: PerceptionDimension[] = [
  { id: 'season',      label: '季节',     salience: 'suppressible' },
  { id: 'timeOfDay',   label: '时段',     salience: 'always' },
  { id: 'spatial',     label: '空间',     salience: 'always' },
  { id: 'medium',      label: '媒介',     salience: 'always' },
  { id: 'knowledge',   label: '知识边界', salience: 'suppressible' },
  { id: 'emotion',     label: '情绪',     salience: 'always' },
  { id: 'task',        label: '本轮任务', salience: 'contextual' },
  { id: 'corrections', label: '纠正',     salience: 'contextual' },
  { id: 'evidence',    label: '证据',     salience: 'suppressible' },
];

// ── 输出级别 ─────────────────────────────────────────────────────
// light:  日常寒暄、短消息、低复杂度。token 预算 ~25。
// standard: 中等情绪、日常分享。token 预算 ~40。
// full:   深度痛苦、纠正、高复杂度。token 预算 ~65。
// 选择逻辑：风险 → 深度 → 是否有纠正 → 默认 light。

type PerceptionTier = 'light' | 'standard' | 'full';

// ── 入口 ─────────────────────────────────────────────────────────

export function buildDepartedPerceptionPrompt(options: {
  evidence: AgentEvidenceItem[];
  emotionState?: ConversationEmotionStateSummary | null;
  replyBrief?: ReplyBrief;
}): string {
  const tier = resolveTier(options.replyBrief);
  const now = new Date();
  const month = now.getMonth() + 1;
  const hour = now.getHours();

  const dims = resolveDimensionValues({
    month,
    hour,
    tier,
    evidence: options.evidence,
    emotionState: options.emotionState,
    replyBrief: options.replyBrief,
  });

  const backgroundLines: string[] = [];
  const taskLines: string[] = [];

  for (const dim of dims) {
    if (!dim.value) continue;
    if (dim.section === 'background') backgroundLines.push(dim.value);
    if (dim.section === 'task') taskLines.push(dim.value);
  }

  const blocks: string[] = [];

  if (backgroundLines.length) {
    blocks.push('# 感知背景');
    blocks.push(backgroundLines.join('。'));
  }

  if (taskLines.length) {
    blocks.push('');
    blocks.push('# 本轮感知');
    blocks.push(taskLines.join(' | '));
  }

  if (blocks.length) {
    blocks.push('');
    blocks.push('感知只作背景参照，不直接输出为聊天内容。');
  }

  return blocks.join('\n');
}

// ── 级别判定 ─────────────────────────────────────────────────────

function resolveTier(replyBrief?: ReplyBrief): PerceptionTier {
  if (!replyBrief) return 'light';

  // full: 危机、深度痛苦、纠正、修复关系
  if (replyBrief.riskLevel === 'high') return 'full';
  if (replyBrief.mode === 'safety' || replyBrief.mode === 'boundary') return 'full';
  if (replyBrief.correctionPolicy) return 'full';

  const reading = replyBrief.reading;
  if (reading?.corrections?.length) return 'full';
  if (reading?.emotionalSource?.includes('强烈痛苦')) return 'full';

  // standard: 中等情绪、记忆、家庭话题
  if (
    replyBrief.mode === 'emotional' ||
    replyBrief.mode === 'memory' ||
    replyBrief.mode === 'family' ||
    replyBrief.mode === 'relationship'
  ) return 'standard';

  if (reading?.questionsToAnswer?.length) return 'standard';

  // light: 日常、短消息、状态问候
  return 'light';
}

// ── 维度值解析 ───────────────────────────────────────────────────

interface ResolvedDimension {
  section: 'background' | 'task';
  value: string;
}

interface DimensionInputs {
  month: number;
  hour: number;
  tier: PerceptionTier;
  evidence: AgentEvidenceItem[];
  emotionState?: ConversationEmotionStateSummary | null;
  replyBrief?: ReplyBrief;
}

function resolveDimensionValues(inputs: DimensionInputs): ResolvedDimension[] {
  const { tier, month, hour, evidence, emotionState, replyBrief } = inputs;
  const results: ResolvedDimension[] = [];
  const reading = replyBrief?.reading;

  // ── 时令：季节 × 时段 ──
  const season = resolveSeason(month);
  const timeOfDay = resolveTimeOfDay(hour);

  if (tier === 'light') {
    // light 级：单字季节，时段不出现在背景行，仅通过标签传递
    results.push({ section: 'background', value: season });
  } else if (tier === 'standard') {
    results.push({ section: 'background', value: `${season}，${timeOfDay}` });
  } else {
    // full 级：季节可展开为环境提示
    const seasonDetail = resolveSeasonDetail(month, hour);
    results.push({ section: 'background', value: seasonDetail });
  }

  // ── 空间 + 媒介（始终在场，不可压制）──
  results.push({ section: 'background', value: '你在此处（离世），用户在彼处（现实）。微信私聊，短而自然' });

  // ── 知识边界 ──
  if (tier !== 'light') {
    const unconfirmed = evidence.filter(e => (e.useMode || 'uptake') === 'hypothesis').length;
    const boundary = unconfirmed > 0
      ? `有${unconfirmed}项未确认，无标注不编造`
      : '无标注不编造';
    results.push({ section: 'background', value: boundary });
  }

  // ── 情绪 ──
  const emotionLabel = buildEmotionLabel(emotionState);
  if (emotionLabel) {
    results.push({ section: 'task', value: `用户：${emotionLabel}` });
  }

  // ── 本轮需求 ──
  if (reading?.primaryNeed) {
    results.push({ section: 'task', value: `需要：${reading.primaryNeed}` });
  }

  // ── 待答问题 ──
  if (reading?.questionsToAnswer?.length) {
    results.push({ section: 'task', value: `待答：${reading.questionsToAnswer.join('；')}` });
  }

  // ── 纠正 ──
  if (reading?.corrections?.length) {
    results.push({ section: 'task', value: `纠正：${reading.corrections.join('；')}` });
  }

  // ── 证据概括（仅 full 级）──
  if (tier === 'full' && evidence.length > 0) {
    const summary = buildEvidenceSummary(evidence);
    if (summary.line) {
      results.push({ section: 'background', value: summary.line });
    }
  }

  return results;
}

// ── 季节 / 时段 ──────────────────────────────────────────────────

function resolveSeason(month: number): string {
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

function resolveSeasonDetail(month: number, _hour: number): string {
  // full 级展开：季节 + 时段 + 暗示环境
  const season = resolveSeason(month);
  const timeLabel = resolveTimeOfDay(_hour);
  if (month >= 6 && month <= 8) return `夏，${timeLabel}（暑热未消）`;
  if (month >= 12 || month <= 2) return `冬，${timeLabel}（天冷）`;
  return `${season}，${timeLabel}`;
}

function resolveTimeOfDay(hour: number): string {
  if (hour >= 5 && hour < 8) return '清晨';
  if (hour >= 8 && hour < 12) return '上午';
  if (hour >= 12 && hour < 14) return '午后';
  if (hour >= 14 && hour < 17) return '下午';
  if (hour >= 17 && hour < 20) return '傍晚';
  if (hour >= 20 && hour < 23) return '晚间';
  if (hour >= 23 || hour < 2) return '夜深了';
  return '凌晨';
}

// ── 情绪 ─────────────────────────────────────────────────────────

function buildEmotionLabel(
  state?: ConversationEmotionStateSummary | null
): string | undefined {
  if (!state?.primaryEmotion) return undefined;

  const labels: Record<string, string> = {
    missing: '思念',
    sadness: '悲伤',
    guilt: '愧疚',
    anger_blame: '愤怒',
    fear: '害怕',
    stable: '平缓',
    expecting_presence: '期待陪伴',
    attachment: '依恋',
    crisis_risk: '强烈痛苦',
  };

  return labels[state.primaryEmotion] || state.primaryEmotion;
}

// ── 证据 ─────────────────────────────────────────────────────────

function buildEvidenceSummary(evidence: AgentEvidenceItem[]): {
  line: string;
} {
  const asserted: string[] = [];
  const recalled: string[] = [];
  const unknown: string[] = [];

  for (const item of evidence) {
    const mode = item.useMode || 'uptake';
    const text = item.text.replace(/[，,。！？!?\n]/g, ' ').trim().slice(0, 40);
    if (mode === 'assert') asserted.push(text);
    else if (mode === 'recall') recalled.push(text);
    else if (mode === 'hypothesis') unknown.push(text);
  }

  const parts: string[] = [];
  if (asserted.length) parts.push(`已知：${asserted.join('；')}`);
  if (recalled.length) parts.push(`回忆：${recalled.join('；')}`);
  if (unknown.length) parts.push(`未确认：${unknown.join('；')}`);

  return {
    line: parts.length ? parts.join(' | ') : '',
  };
}
