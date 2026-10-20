/**
 * 只读 prompt 体积采样。
 *
 * 只记录 stable/task/total 字符数、证据数和估算 token，不记录 prompt 内容。
 */

export const PROMPT_SIZE_PREFIX = '[prompt-size]';
const CHARS_PER_TOKEN = 1.14;

export interface PromptSizeRecord {
  stableChars: number;
  taskChars: number;
  totalChars: number;
  estimatedTokens: number;
  stableShare: number;
  evidenceCount: number;
  mode?: string;
  at: string;
}

export function buildPromptSizeRecord(options: {
  stableChars: number;
  taskChars: number;
  totalChars: number;
  evidenceCount?: number;
  mode?: string;
  now?: Date;
}): PromptSizeRecord {
  const totalChars = Math.max(0, Math.round(options.totalChars || 0));
  return {
    stableChars: Math.max(0, Math.round(options.stableChars || 0)),
    taskChars: Math.max(0, Math.round(options.taskChars || 0)),
    totalChars,
    estimatedTokens: Math.round(totalChars / CHARS_PER_TOKEN),
    stableShare: totalChars
      ? Number((Math.max(0, options.stableChars || 0) / totalChars).toFixed(3))
      : 0,
    evidenceCount: Math.max(0, Math.round(options.evidenceCount || 0)),
    ...(options.mode ? { mode: options.mode } : {}),
    at: (options.now || new Date()).toISOString(),
  };
}

export function formatPromptSizeLine(record: PromptSizeRecord): string {
  return `${PROMPT_SIZE_PREFIX} ${JSON.stringify(record)}`;
}

export function shouldSamplePromptSize(
  env: NodeJS.ProcessEnv = process.env,
  random: () => number = Math.random
): boolean {
  const raw = env.PROMPT_SIZE_SAMPLE_RATE;
  const rate = raw === undefined ? 0.02 : Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) return false;
  return random() < Math.min(1, rate);
}
