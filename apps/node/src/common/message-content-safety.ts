const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/i;
const MEDIA_FILE_PATTERN =
  /(?:^|[\s"'(])\S+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;
const LEGACY_MEDIA_PATH_PATTERN =
  /(?:^|[\s"'(])(?:images\/)?aiDeceased\/[A-Za-z0-9._/-]+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;
const PROMPT_LEAKAGE_PATTERNS = [
  /历史助手回复/,
  /仅供理解对话顺序和语气/,
  /不是事实来源/,
  /事实来源白名单/,
  /用户原话或角色资料/,
  /角色资料确认/,
  /输出必须是严格\s*JSON/i,
  /最终格式必须是/,
  /segments\s*必须/i,
  /系统提示/,
  /提示词/,
  /生成规则/,
];
const BRACKETED_PROMPT_LEAKAGE_PATTERN =
  /[【\[][^】\]]*(?:历史助手回复|事实来源|角色资料|用户原话|输出格式|系统提示|提示词|生成规则)[^】\]]*[】\]]/g;
const PROMPT_LEAKAGE_PREFIX_PATTERN =
  /^(?:仅供理解对话顺序和语气|不是事实来源|其中具体回忆[^】\]\n]*确认才可使用|必须有用户原话或角色资料确认才可使用)[】\]\s、，。；;:：-]*/;

export function stripPromptLeakageContent(value?: string): string {
  let content = value?.trim() || '';

  if (!content) {
    return '';
  }

  content = content.replace(BRACKETED_PROMPT_LEAKAGE_PATTERN, ' ');

  while (PROMPT_LEAKAGE_PREFIX_PATTERN.test(content.trim())) {
    content = content.trim().replace(PROMPT_LEAKAGE_PREFIX_PATTERN, ' ');
  }

  return content.replace(/\s+/g, ' ').trim();
}

export function containsPromptLeakageContent(value?: string): boolean {
  const content = value?.trim();

  if (!content) {
    return false;
  }

  return PROMPT_LEAKAGE_PATTERNS.some(pattern => pattern.test(content));
}

export function containsUnsafeAssistantMessageContent(value?: string): boolean {
  const content = value?.trim();

  if (!content) {
    return false;
  }

  return (
    URL_PATTERN.test(content) ||
    MEDIA_FILE_PATTERN.test(content) ||
    LEGACY_MEDIA_PATH_PATTERN.test(content) ||
    containsPromptLeakageContent(content)
  );
}
