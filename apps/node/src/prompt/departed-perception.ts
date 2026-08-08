import type { AgentEvidenceItem } from '../service/agents/agent-evidence';
import type { ConversationEmotionStateSummary } from '../service/agents/agent-emotion-state.service';
import type { ReplyBrief } from '../service/agents/reply-brief.service';

export function buildDepartedPerceptionPrompt(options: {
  evidence: AgentEvidenceItem[];
  emotionState?: ConversationEmotionStateSummary | null;
  replyBrief?: ReplyBrief;
}): string {
  const season = resolveSeason();
  const timeOfDay = resolveTimeOfDay();
  const evidenceSummary = buildEvidenceSummary(options.evidence);
  const emotionLabel = buildEmotionLabel(options.emotionState);
  const readingLabel = buildReadingLabel(options.replyBrief);

  const lines = [
    '# 感知背景',
    `${season}${timeOfDay}。你在此处（离世），用户在彼处（现实）。微信私聊，短而自然。`,
    `你只知道标注过的证据；${evidenceSummary.unknownCount ? `有${evidenceSummary.unknownCount}项未确认，` : ''}无标注不编造。`,
  ];

  // Current perception line
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

function resolveSeason(): string {
  const month = new Date().getMonth() + 1;
  if (month >= 3 && month <= 5) return '春日';
  if (month >= 6 && month <= 8) return '夏夜' in resolveTimeOfDayObj() ? '夏日' : '夏季';
  if (month >= 9 && month <= 11) return '秋日';
  return '冬日';
}

function resolveTimeOfDayObj(): { label: string; isNight: boolean } {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return { label: '清晨', isNight: false };
  if (hour >= 8 && hour < 12) return { label: '上午', isNight: false };
  if (hour >= 12 && hour < 14) return { label: '午后', isNight: false };
  if (hour >= 14 && hour < 18) return { label: '下午', isNight: false };
  if (hour >= 18 && hour < 23) return { label: '晚上', isNight: true };
  return { label: '深夜', isNight: true };
}

function resolveTimeOfDay(): string {
  const { label } = resolveTimeOfDayObj();
  return label;
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
