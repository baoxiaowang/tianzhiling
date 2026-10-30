export interface VoiceTranscriptQuality {
  lowQuality: boolean;
  reason?: 'empty' | 'sparse' | 'filler' | 'repetition';
}

const FILLER_PATTERN = /嗯|啊|哦|呃|额|那个|就是|然后|这个/g;
const REPETITION_PATTERN = /(.{2,8})\1{2,}/u;

/**
 * 只做保守的 ASR 质量门：明显空、明显稀疏、语气词堆叠或异常重复时才判低质量。
 * 不做语义改写，避免把用户真实方言/口癖误判成坏转写。
 */
export function assessVoiceTranscriptQuality(
  transcript: string | undefined,
  durationMs?: number
): VoiceTranscriptQuality {
  const text = (transcript || '').replace(/\s+/g, '').trim();
  if (!text) return { lowQuality: true, reason: 'empty' };

  const meaningful = text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
  const seconds = Math.max(1, Number(durationMs || 0) / 1000);
  const charsPerSecond = meaningful.length / seconds;

  if (seconds >= 5 && meaningful.length < 4) {
    return { lowQuality: true, reason: 'sparse' };
  }
  if (seconds >= 5 && charsPerSecond < 0.8) {
    return { lowQuality: true, reason: 'sparse' };
  }

  const fillerCount = (text.match(FILLER_PATTERN) || []).length;
  if (meaningful.length >= 8 && fillerCount / meaningful.length > 0.35) {
    return { lowQuality: true, reason: 'filler' };
  }
  if (REPETITION_PATTERN.test(text)) {
    return { lowQuality: true, reason: 'repetition' };
  }
  return { lowQuality: false };
}
