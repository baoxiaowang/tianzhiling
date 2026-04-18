export function extractTranscriptionContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const parts = content as Array<{ text?: unknown }>;

    return parts
      .map(item => {
        if (!item || typeof item !== 'object') {
          return '';
        }

        const text = (item as { text?: unknown }).text;
        return typeof text === 'string' ? text.trim() : '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}
