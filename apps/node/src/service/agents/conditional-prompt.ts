/**
 * 低频条件提示编译器。
 *
 * 只负责“本轮哪些可选提示块能进 prompt”：按优先级、抑制关系、块数和字符预算裁剪。
 * 规则本身仍是同步纯判断；这里不做任何 IO，也不生成回复。
 */
export interface ConditionalPromptCandidate {
  id: string;
  priority: number;
  text: string;
  /** 命中后压掉哪些低优先级块（只对已命中块生效）。 */
  suppresses?: string[];
}

export interface ConditionalPromptCompileOptions {
  maxBlocks?: number;
  maxChars?: number;
}

export interface ConditionalPromptCompileResult {
  prompt: string;
  fired: string[];
  dropped: string[];
  suppressed: string[];
  chars: number;
}

const DEFAULT_MAX_BLOCKS = 3;
const DEFAULT_MAX_CHARS = 300;

export function compileConditionalPrompts(
  candidates: ConditionalPromptCandidate[],
  options: ConditionalPromptCompileOptions = {}
): ConditionalPromptCompileResult {
  const maxBlocks = Math.max(0, options.maxBlocks ?? DEFAULT_MAX_BLOCKS);
  const maxChars = Math.max(0, options.maxChars ?? DEFAULT_MAX_CHARS);

  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => Boolean(candidate.text && candidate.text.trim()))
    .sort((a, b) => {
      if (b.candidate.priority !== a.candidate.priority) {
        return b.candidate.priority - a.candidate.priority;
      }
      return a.index - b.index;
    });

  const fired: string[] = [];
  const dropped: string[] = [];
  const suppressed: string[] = [];
  const suppressedIds = new Set<string>();
  const firedTexts: string[] = [];
  let chars = 0;

  for (const { candidate } of ordered) {
    if (suppressedIds.has(candidate.id)) {
      suppressed.push(candidate.id);
      continue;
    }
    if (fired.length >= maxBlocks) {
      dropped.push(candidate.id);
      continue;
    }
    const separator = firedTexts.length ? 1 : 0;
    if (chars + separator + candidate.text.length > maxChars) {
      dropped.push(candidate.id);
      continue;
    }

    fired.push(candidate.id);
    firedTexts.push(candidate.text);
    chars += separator + candidate.text.length;
    for (const id of candidate.suppresses || []) {
      suppressedIds.add(id);
    }
  }

  return {
    prompt: firedTexts.join('\n'),
    fired,
    dropped,
    suppressed,
    chars,
  };
}
