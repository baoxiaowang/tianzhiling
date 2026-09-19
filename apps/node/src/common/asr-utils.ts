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

/**
 * 语音转写失败是否值得重试。
 *
 * 「音频格式非法」「参数不合法」这类 4xx 是确定性失败：同一个音频再试一次结果不会变，
 * 只会多打一条日志、多等一次退避。只有 5xx、超时和限流属于瞬时故障。
 * 拿不到状态码时按可重试处理，避免把瞬时故障误判成不可重试。
 */
export function isRetryableTranscriptionError(error: unknown): boolean {
  const status = Number((error as { status?: unknown } | undefined)?.status);

  if (!Number.isInteger(status)) {
    return true;
  }

  if (status === 408 || status === 429) {
    return true;
  }

  return status >= 500;
}
