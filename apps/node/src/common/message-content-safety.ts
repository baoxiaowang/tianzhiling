const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/i;
const MEDIA_FILE_PATTERN =
  /(?:^|[\s"'(])\S+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;
const LEGACY_MEDIA_PATH_PATTERN =
  /(?:^|[\s"'(])(?:images\/)?aiDeceased\/[A-Za-z0-9._/-]+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;

export function containsUnsafeAssistantMessageContent(value?: string): boolean {
  const content = value?.trim();

  if (!content) {
    return false;
  }

  return (
    URL_PATTERN.test(content) ||
    MEDIA_FILE_PATTERN.test(content) ||
    LEGACY_MEDIA_PATH_PATTERN.test(content)
  );
}
