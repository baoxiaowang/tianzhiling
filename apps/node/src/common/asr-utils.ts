export function extractTranscriptionContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return (content as Array<{ text?: unknown }>)
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
