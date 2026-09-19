/**
 * 统一的模型调用边界：所有分支（v1/v2/narrow/concrete/two-step）都从这里走。
 *
 * 要求（来自复核）：
 * - 在**调用前**登记一条 attempted 记录；成功/失败再更新状态，不能把"准备调用"写成已获服务端接收；
 * - 记录实际解析后的模型名、生成参数、请求 hash、提示版本；不含密钥、不含 baseURL 全量；
 * - 失败也要留记录（含两步模式第一步成功、第二步失败的两次记录）；
 * - 复用旧 raw 时明确 not_sent，不伪造 system/user。
 */
import { createHash } from 'crypto';

export type RequestStatus = 'attempted' | 'succeeded' | 'failed' | 'not_sent';

export interface ModelRequest {
  fragmentId: string;
  mode: string;
  protocol: string;
  inputMode: string;
  step: number;
  model: string;
  params: { temperature: number; topP: number; maxTokens: number };
  system: string;
  user: string;
  messageIds: string[];
  promptSource: string;
}

export interface RequestEntry extends ModelRequest {
  status: RequestStatus;
  /** 服务端返回的模型名；没有返回就是 null，绝不用请求名回填。 */
  resolvedModel: string | null;
  /** 请求体（model+参数+system+user）的 hash。 */
  requestHash: string;
  /** 提示内容（system+user）的 hash，用于定位"当时用的是哪份提示"。 */
  promptContentHash: string;
  /** 源码/提交标识（可为 null，表示本地拿不到），不是固定字符串。 */
  sourceCommit: string | null;
  inputChars: number;
  attemptedAt: string;
  settledAt?: string;
  error?: string;
}

export interface ChatClient {
  chat: { completions: { create(args: unknown): Promise<any> } };
}

/** 脱敏：把疑似密钥替换掉；不能用"截断 200 字"来代替脱敏。 */
export function redactSecrets(message: string): string {
  return String(message || '')
    .replace(/sk-[A-Za-z0-9._-]{6,}/gu, 'sk-***')
    .replace(
      /((?:api[_-]?key|apikey|token|secret)\s*["'\s:=]+)[A-Za-z0-9._-]{6,}/giu,
      '$1***'
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{6,}/giu, '$1***');
}

export function promptContentHash(system: string, user: string): string {
  return createHash('sha256').update(`${system}\u0000${user}`).digest('hex');
}

export function requestHash(request: ModelRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        model: request.model,
        params: request.params,
        system: request.system,
        user: request.user,
      })
    )
    .digest('hex');
}

export function createModelInvoker(deps: {
  client: ChatClient;
  /** 源码/提交标识，可为 null。 */
  sourceCommit?: string | null;
}) {
  const entries: RequestEntry[] = [];
  const byFragment = new Map<string, RequestEntry[]>();

  const push = (entry: RequestEntry) => {
    entries.push(entry);
    if (!byFragment.has(entry.fragmentId)) byFragment.set(entry.fragmentId, []);
    byFragment.get(entry.fragmentId)!.push(entry);
    return entry;
  };

  return {
    async invoke(
      request: ModelRequest
    ): Promise<{ raw: string; finishReason: string; usage: unknown }> {
      const entry = push({
        ...request,
        status: 'attempted',
        resolvedModel: null,
        requestHash: requestHash(request),
        promptContentHash: promptContentHash(request.system, request.user),
        sourceCommit: deps.sourceCommit ?? null,
        inputChars: request.user.length,
        attemptedAt: new Date().toISOString(),
      });
      try {
        const completion = await deps.client.chat.completions.create({
          model: request.model,
          temperature: request.params.temperature,
          top_p: request.params.topP,
          max_tokens: request.params.maxTokens,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        });
        entry.status = 'succeeded';
        entry.settledAt = new Date().toISOString();
        entry.resolvedModel = completion?.model
          ? String(completion.model)
          : null;
        return {
          raw: completion?.choices?.[0]?.message?.content || '',
          finishReason: completion?.choices?.[0]?.finish_reason || 'unknown',
          usage: completion?.usage || null,
        };
      } catch (error) {
        entry.status = 'failed';
        entry.settledAt = new Date().toISOString();
        entry.error = redactSecrets(
          error instanceof Error ? error.message : String(error)
        ).slice(0, 200);
        throw error;
      }
    },
    markNotSent(options: {
      fragmentId: string;
      mode: string;
      protocol: string;
      inputMode: string;
      model: string;
      params: ModelRequest['params'];
      promptSource: string;
    }) {
      return push({
        ...options,
        step: -1,
        system: '',
        user: '',
        messageIds: [],
        status: 'not_sent',
        resolvedModel: null,
        requestHash: '',
        promptContentHash: promptContentHash('', ''),
        sourceCommit: deps.sourceCommit ?? null,
        inputChars: 0,
        attemptedAt: new Date().toISOString(),
      });
    },
    all: () => entries.slice(),
    forFragment: (fragmentId: string) => byFragment.get(fragmentId) || [],
    toJsonl: () =>
      entries.map(item => JSON.stringify(item)).join('\n') +
      (entries.length ? '\n' : ''),
  };
}

/** 离线假客户端：不访问网络，用于验证"所有分支与失败路径都留档"。 */
export function createFakeClient(options?: {
  failAtStep?: number;
  responseFor?: (call: number) => string;
}): ChatClient {
  let call = 0;
  return {
    chat: {
      completions: {
        async create(args: unknown) {
          call += 1;
          if (options?.failAtStep && call === options.failAtStep) {
            throw new Error('fake_client_failure');
          }
          const user = String(
            (args as any)?.messages?.find(
              (message: any) => message.role === 'user'
            )?.content || ''
          );
          const content = options?.responseFor
            ? options.responseFor(call)
            : user.includes('operations')
            ? JSON.stringify({
                schemaVersion: 'return_extract_output_v2',
                operations: [],
                unresolvedReferences: [],
              })
            : JSON.stringify({ items: [] });
          return {
            model: 'fake-model-1',
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { total_tokens: 1 },
          };
        },
      },
    },
  } as unknown as ChatClient;
}
