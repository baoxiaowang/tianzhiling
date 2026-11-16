/**
 * 提示词工程配置的纯函数解析层。
 *
 * 放在 config 目录、不依赖任何运行时对象：config.default.ts 用它把 env 值
 * 归一成"最终生效值 + 是否被钳制"，AgentContextService 只消费结果并在越界时
 * 打一次 warn（避免每轮构建 prompt 都重复告警）。
 */

export const DEFAULT_CONDITIONAL_PROMPT_MAX_CHARS = 1000;
export const MIN_CONDITIONAL_PROMPT_MAX_CHARS = 300;
export const MAX_CONDITIONAL_PROMPT_MAX_CHARS = 2000;

export interface ConditionalPromptMaxCharsResolution {
  /** 最终生效的字符预算。 */
  value: number;
  /** 入参是否越界/非法而被调整（供启动或首轮告警使用）。 */
  adjusted: boolean;
}

/**
 * 解析条件段字符预算：
 * - 缺省/非法值 → 默认 1000（不视为越界，保持静默）；
 * - 越界 → 钳制到 [300, 2000] 并标记 adjusted；
 * - 合法值 → 原样返回。
 */
export function resolveConditionalPromptMaxChars(
  raw: unknown
): ConditionalPromptMaxCharsResolution {
  const parsed =
    typeof raw === 'number'
      ? Math.trunc(raw)
      : Number.parseInt(String(raw ?? '').trim(), 10);

  if (!Number.isFinite(parsed)) {
    return { value: DEFAULT_CONDITIONAL_PROMPT_MAX_CHARS, adjusted: false };
  }

  if (parsed < MIN_CONDITIONAL_PROMPT_MAX_CHARS) {
    return { value: MIN_CONDITIONAL_PROMPT_MAX_CHARS, adjusted: true };
  }
  if (parsed > MAX_CONDITIONAL_PROMPT_MAX_CHARS) {
    return { value: MAX_CONDITIONAL_PROMPT_MAX_CHARS, adjusted: true };
  }
  return { value: parsed, adjusted: false };
}
