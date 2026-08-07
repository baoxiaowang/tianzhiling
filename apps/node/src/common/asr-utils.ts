/**
 * 从 OpenAI 兼容 / DashScope 的语音转文字响应中提取纯文本内容。
 *
 * qwen-audio-turbo / qwen3-asr-flash 等模型在 compatible-mode 下可能返回：
 *   - 纯字符串 "这是转写结果"
 *   - 字符串数组 ["第一句", "第二句"]
 *   - 对象数组 [{text: "第一句"}, {text: "第二句"}]
 *   - 单个对象 {text: "结果"}
 *   - 嵌套对象 {content: "...", text: "..."}
 *   - {output: [{text: "..."}]} （部分 ASR 专有格式）
 */
export function extractTranscriptionContent(content: unknown): string {
  if (!content && content !== '') {
    return '';
  }

  // 1. 纯字符串
  if (typeof content === 'string') {
    return content.trim();
  }

  // 2. 数组
  if (Array.isArray(content)) {
    const invalid = content.length === 0;
    const parts = content.map(item => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      // 数组元素是字符串
      if (typeof item === 'string') {
        return item.trim();
      }
      // 数组元素是对象，尝试多个可能的字段名
      const obj = item as Record<string, unknown>;
      const text = obj.text || obj.content || obj.transcript || obj.value || '';
      return typeof text === 'string' ? text.trim() : '';
    });
    const result = parts.filter(Boolean).join('\n').trim();
    return invalid && !result ? '' : result;
  }

  // 3. 对象 — 尝试所有可能的字段名和嵌套路径
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;

    // 直接字段
    for (const key of ['text', 'content', 'transcript', 'value']) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim()) {
        return val.trim();
      }
    }

    // output.text（DashScope ASR 原生格式）
    const output = obj.output;
    if (output && typeof output === 'object') {
      const outObj = output as Record<string, unknown>;
      for (const key of ['text', 'content', 'transcript']) {
        const val = outObj[key];
        if (typeof val === 'string' && val.trim()) {
          return val.trim();
        }
      }
    }

    // choices[0].message.content 的降级（万一外层结构不同）
    const choices = obj.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const firstChoice = choices[0] as Record<string, unknown>;
      const message = firstChoice?.message as Record<string, unknown> | undefined;
      const msgContent = message?.content;
      if (typeof msgContent === 'string' && msgContent.trim()) {
        return msgContent.trim();
      }
      // message.content 可能是对象数组
      if (Array.isArray(msgContent)) {
        const nested = extractTranscriptionContent(msgContent);
        if (nested) return nested;
      }
    }

    // 递归：对象本身可能就是一个需要再解析的结构
    // 兜底：如果整个对象只有一个 value 字段是字符串
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      const onlyVal = obj[keys[0]];
      if (typeof onlyVal === 'string' && onlyVal.trim()) {
        return onlyVal.trim();
      }
    }
  }

  return '';
}
