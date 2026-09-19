/**
 * 请求留档：保存**真正发送**的请求。
 *
 * 背景：上一版把 `inputs.jsonl` 在落盘时用 `buildV1Input` 重新构造了一遍，
 * 对 v2/concrete/narrow 这些模式来说，存下来的根本不是发出去的请求。
 * 这里改成在调用点抓取，system/user 原样记录；没有真正发送（如复用旧 raw）时不伪造。
 */
export interface RequestEntry {
  fragmentId: string;
  mode: string;
  protocol: string;
  inputMode: string;
  model: string;
  /** 调用序号：0 为单次调用；两步模式为 0/1。 */
  step: number;
  system: string;
  user: string;
  messageIds: string[];
  inputChars: number;
  capturedAt: string;
}

export interface RequestLog {
  record(
    entry: Omit<RequestEntry, 'capturedAt'> & { capturedAt?: string }
  ): RequestEntry;
  all(): RequestEntry[];
  toJsonl(): string;
}

/** 捕获一次真实请求；system/user 必须与传给模型客户端的字符串完全相同。 */
export function createRequestLog(): RequestLog {
  const entries: RequestEntry[] = [];
  return {
    record(entry) {
      const row: RequestEntry = {
        ...entry,
        capturedAt: entry.capturedAt || new Date().toISOString(),
      };
      entries.push(row);
      return row;
    },
    all() {
      return entries.slice();
    },
    toJsonl() {
      return (
        entries.map(item => JSON.stringify(item)).join('\n') +
        (entries.length ? '\n' : '')
      );
    },
  };
}

/** 复用旧 raw 的情况：明确标记"本轮没有发送请求"，不伪造 system/user。 */
export function markNotSent(options: {
  fragmentId: string;
  mode: string;
  protocol: string;
  inputMode: string;
  model: string;
  reason: string;
}): RequestEntry {
  return {
    fragmentId: options.fragmentId,
    mode: options.mode,
    protocol: options.protocol,
    inputMode: options.inputMode,
    model: options.model,
    step: -1,
    system: '',
    user: '',
    messageIds: [],
    inputChars: 0,
    capturedAt: new Date().toISOString(),
  };
}
