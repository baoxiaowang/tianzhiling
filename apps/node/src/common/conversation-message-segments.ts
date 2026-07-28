const FENGE_TOKEN_PATTERN =
  'f[e\\u00e8\\u00e9\\u00ea\\u0113\\u011b]n?g[e\\u00e8\\u00e9\\u00ea\\u0113\\u011b]';

export const CONVERSATION_MESSAGE_SEGMENT_SEPARATOR_PATTERN = new RegExp(
  `<\\/?\\s*${FENGE_TOKEN_PATTERN}\\s*(?:>|\\])?|\\[\\/?\\s*${FENGE_TOKEN_PATTERN}\\s*\\]?`,
  'gi'
);

export function hasConversationMessageSegmentSeparator(
  value?: string
): boolean {
  return new RegExp(
    `<\\/?\\s*${FENGE_TOKEN_PATTERN}\\s*(?:>|\\])?|\\[\\/?\\s*${FENGE_TOKEN_PATTERN}\\s*\\]?`,
    'i'
  ).test(value || '');
}

export function splitConversationMessageSegments(value?: string): string[] {
  const content = value?.trim();

  if (!content) {
    return [];
  }

  return content
    .split(CONVERSATION_MESSAGE_SEGMENT_SEPARATOR_PATTERN)
    .map(item => item.trim())
    .filter(Boolean);
}

export function stripConversationMessageSegmentMarkup(value: string): string {
  return value.replace(CONVERSATION_MESSAGE_SEGMENT_SEPARATOR_PATTERN, ' ');
}
