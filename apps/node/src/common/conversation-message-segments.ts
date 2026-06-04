export const CONVERSATION_MESSAGE_SEGMENT_SEPARATOR_PATTERN =
  /<\/?\s*fenge\s*(?:>|\])|\[\/?\s*fenge\s*\]/gi;

export function hasConversationMessageSegmentSeparator(value?: string): boolean {
  return /<\/?\s*fenge\s*(?:>|\])|\[\/?\s*fenge\s*\]/i.test(value || '');
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
