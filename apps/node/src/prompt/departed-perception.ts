import type { AgentEvidenceItem } from '../service/agents/agent-evidence';
import type { ConversationEmotionStateSummary } from '../service/agents/agent-emotion-state.service';
import type { ReplyBrief } from '../service/agents/reply-brief.service';

export function buildDepartedPerceptionPrompt(options: {
  evidence: AgentEvidenceItem[];
  emotionState?: ConversationEmotionStateSummary | null;
  replyBrief?: ReplyBrief;
}): string {
  const season = resolveSeason();
  const timeLabel = resolveTimeLabel();
  const evidenceSummary = buildEvidenceSummary(options.evidence);
  const emotionLabel = buildEmotionLabel(options.emotionState);
  const readingLabel = buildReadingLabel(options.replyBrief);

  const lines = [
    '# 感知背景',
    `${season}，${timeLabel}。你在此处（离世），用户在彼处（现实）。微信私聊，短而自然。`,
    `你只知道标注过的证据；${evidenceSummary.unknownCount ? `有${evidenceSummary.unknownCount}项未确认，` : ''}无标注不编造。`,
  ];

  const perceptionParts: string[] = [];
  if (emotionLabel) perceptionParts.push(`用户：${emotionLabel}`);
  if (readingLabel.need) perceptionParts.push(`需要：${readingLabel.need}`);
  if (readingLabel.questions) perceptionParts.push(`待答：${readingLabel.questions}`);
  if (readingLabel.corrections) perceptionParts.push(`纠正：${readingLabel.corrections}`);

  if (perceptionParts.length) {
    lines.push('');
    lines.push('# 本轮感知');
    lines.push(perceptionParts.join(' | '));
  }

  if (evidenceSummary.line) {
    lines.push(evidenceSummary.line);
  }

  lines.push('');
  lines.push('感知只作背景参照，不直接输出为聊天内容。');

  return lines.join('\n');
}

// ── 季节：单字标签，始终在场，只作过滤不作话题 ──
function resolveSeason(): string {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

// ── 时段：精细到能传递情绪信号，模型据此调整回应姿态 ──
function resolveTimeLabel(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return '清晨';       // 早起，可能刚醒就想你了
  if (hour >= 8 && hour < 12) return '上午';       // 日常
  if (hour >= 12 && hour < 14) return '午后';       // 午休间隙
  if (hour >= 14 && hour < 17) return '下午';       // 日常
  if (hour >= 17 && hour < 20) return '傍晚';       // 下班/放学后
  if (hour >= 20 && hour < 23) return '晚间';       // 放松时段
  if (hour >= 23 || hour < 2) return '夜深了';     // 熬夜，可能有心事
  return '凌晨';                                    // 2-5am，几乎一定有心事
}

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

function buildReadingLabel(replyBrief?: ReplyBrief): {
  need?: string;
  questions?: string;
  corrections?: string;
} {
  const reading = replyBrief?.reading;
  if (!reading) return {};

  return {
    need: reading.primaryNeed || undefined,
    questions: reading.questionsToAnswer?.length
      ? reading.questionsToAnswer.join('；')
      : undefined,
    corrections: reading.corrections?.length
      ? reading.corrections.join('；')
      : undefined,
  };
}

function buildEvidenceSummary(evidence: AgentEvidenceItem[]): {
  line: string;
  unknownCount: number;
} {
  const asserted: string[] = [];
  const taken: string[] = [];
  const recalled: string[] = [];
  const unknown: string[] = [];

  for (const item of evidence) {
    const mode = item.useMode || 'uptake';
    const text = item.text.replace(/[，,。！？!?\n]/g, ' ').trim().slice(0, 40);
    if (mode === 'assert') asserted.push(text);
    else if (mode === 'uptake') taken.push(text);
    else if (mode === 'recall') recalled.push(text);
    else if (mode === 'hypothesis') unknown.push(text);
  }

  const parts: string[] = [];
  if (asserted.length) parts.push(`已知：${asserted.join('；')}`);
  if (recalled.length) parts.push(`回忆：${recalled.join('；')}`);
  if (unknown.length) parts.push(`未确认：${unknown.join('；')}`);

  return {
    line: parts.length ? `# 证据概括\n${parts.join('\n')}` : '',
    unknownCount: unknown.length,
  };
}
