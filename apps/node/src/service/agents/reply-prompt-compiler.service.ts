import { Provide } from '@midwayjs/core';

export const REPLY_PROMPT_COMPILER_VERSION =
  'reply_prompt_compiler_v1' as const;

export interface CompiledReplyPrompt {
  version: typeof REPLY_PROMPT_COMPILER_VERSION;
  content: string;
  stableCharacters: number;
  taskCharacters: number;
}

@Provide()
export class ReplyPromptCompilerService {
  compile(options: {
    stableParts: Array<string | undefined>;
    taskParts: Array<string | undefined>;
    includeTask: boolean;
  }): CompiledReplyPrompt {
    const stablePrompt = joinPromptParts(options.stableParts);
    const taskPrompt = options.includeTask
      ? joinPromptParts(options.taskParts)
      : '';
    const content = [stablePrompt, taskPrompt].filter(Boolean).join('\n\n');

    return {
      version: REPLY_PROMPT_COMPILER_VERSION,
      content,
      stableCharacters: stablePrompt.length,
      taskCharacters: taskPrompt.length,
    };
  }
}

function joinPromptParts(parts: Array<string | undefined>): string {
  return parts
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join('\n\n');
}
