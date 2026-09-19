import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { AppError } from '@tzl/shared';
import { MongoObjectId } from '@tzl/entities';
import { AgentVtApiService } from './agent-vt-api.service';

interface AgentVtLlmConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
}

export interface AgentVtChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentVtChatAttachment {
  objectKey: string;
  name?: string;
}

export interface AgentVtChatInput {
  messages: AgentVtChatMessage[];
  attachments?: AgentVtChatAttachment[];
}

export interface AgentVtChatResult {
  reply: string;
  /** 本轮触发的动作摘要，供前端展示状态。 */
  actions: Array<{ action: string; detail?: string; timbreId?: string }>;
}

interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** 对话可用工具白名单（与受限 API 一一对应）。 */
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'list_timbres',
      description:
        '查看当前账号的声音训练列表与每个音色的状态（训练中/成功/失败）、名称、创建时间。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_slots',
      description: '查看当前可用的服务商训练槽位（豆包 Speaker ID 与剩余次数）。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_training',
      description:
        '用用户上传的一段音频创建一次声音训练。用户上传音频后，将其 objectKey 传入此工具。',
      parameters: {
        type: 'object',
        properties: {
          audioObjectKey: {
            type: 'string',
            description: '用户上传音频的 objectKey，必须来自本次对话用户上传的附件。',
          },
          name: {
            type: 'string',
            description: '音色名称（可选，不填自动生成）。',
          },
          provider: {
            type: 'string',
            description: '服务商，默认 doubao（豆包）。',
          },
          speechDialect: {
            type: 'string',
            description: '方言（可选）。',
          },
          speechInstruction: {
            type: 'string',
            description: '补充训练要求（可选）。',
          },
          previewText: {
            type: 'string',
            description: '试听文本（可选）。',
          },
        },
        required: ['audioObjectKey'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'retry_training',
      description: '重试一条训练失败（或成功后需重新训练）的音色。',
      parameters: {
        type: 'object',
        properties: {
          timbreId: { type: 'string', description: '音色 ID。' },
        },
        required: ['timbreId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bind_to_relative',
      description:
        '把一条训练完成的音色绑定到当前账号的 AI 亲人。训练状态为成功（active）后才能绑定。',
      parameters: {
        type: 'object',
        properties: {
          timbreId: { type: 'string', description: '训练成功的音色 ID。' },
        },
        required: ['timbreId'],
      },
    },
  },
] as const;

/**
 * 声音训练 Agent 工作台对话编排。
 *
 * 使用 OpenAI 兼容 Chat Completions + function calling：
 * LLM 解析用户意图 → 调用受限工具（AgentVtApiService，身份已由 token 锁定）→
 * 多轮循环直到模型给出最终回复。未配置 LLM 时降级为关键词路由，保证可用。
 */
@Provide()
export class AgentVtChatService {
  @Logger()
  logger: ILogger;

  @Inject()
  agentVtApiService: AgentVtApiService;

  @Config('llm')
  llmConfig?: AgentVtLlmConfig;

  @Config('agentVt')
  agentVtConfig?: { title?: string };

  async chat(
    input: AgentVtChatInput,
    ctx: { userId: MongoObjectId; agentId: MongoObjectId; agentName?: string }
  ): Promise<AgentVtChatResult> {
    const messages = this.buildMessages(input, ctx);

    if (this.isLlmConfigured()) {
      const llmResult = await this.runLlmLoop(messages, ctx);
      if (llmResult) {
        return llmResult;
      }
    }

    return this.runKeywordFallback(input, ctx);
  }

  // ---------- LLM 主循环 ----------

  private async runLlmLoop(
    messages: Array<Record<string, unknown>>,
    ctx: { userId: MongoObjectId; agentId: MongoObjectId; agentName?: string }
  ): Promise<AgentVtChatResult | undefined> {
    const actions: AgentVtChatResult['actions'] = [];
    const cfg = this.llmConfig!;
    const baseURL = (cfg.baseURL ?? '').replace(/\/$/, '');
    const model = cfg.model || 'gpt-4o-mini';

    // 限制工具循环轮数，防止死循环
    for (let round = 0; round < 8; round += 1) {
      const data = await this.callLlm(baseURL, cfg, model, messages);
      const message = data?.choices?.[0]?.message;
      const text = message?.content?.trim();

      const toolCalls: LlmToolCall[] = Array.isArray(message?.tool_calls)
        ? message.tool_calls
        : [];

      if (toolCalls.length === 0) {
        const reply = text || '（我没有理解你的意思，可以再说一遍吗？）';
        return { reply, actions };
      }

      // 执行工具调用
      messages.push({
        role: 'assistant',
        content: text ?? '',
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const toolCall of toolCalls) {
        const result = await this.executeTool(toolCall, ctx, actions);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
    }

    this.logger.warn('[agent-vt-chat] tool loop exceeded rounds, stop');
    return {
      reply: '处理次数过多，请稍后再试或简化一下请求。',
      actions,
    };
  }

  private async callLlm(
    baseURL: string,
    cfg: AgentVtLlmConfig,
    model: string,
    messages: Array<Record<string, unknown>>
  ): Promise<{
    choices?: Array<{ message?: { content?: string; tool_calls?: LlmToolCall[] } }>;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 60_000);

    try {
      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: TOOL_DEFINITIONS,
          tool_choice: 'auto',
          temperature: 0.3,
          max_tokens: 1024,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        this.logger.error('[agent-vt-chat] llm http %s: %s', resp.status, text.slice(0, 300));
        return {};
      }

      return (await resp.json()) as {
        choices?: Array<{ message?: { content?: string; tool_calls?: LlmToolCall[] } }>;
      };
    } catch (err) {
      this.logger.error('[agent-vt-chat] llm call failed: %s', (err as Error).message);
      return {};
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeTool(
    toolCall: LlmToolCall,
    ctx: { userId: MongoObjectId; agentId: MongoObjectId },
    actions: AgentVtChatResult['actions']
  ): Promise<unknown> {
    const name = toolCall.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(toolCall.function.arguments || '{}');
    } catch {
      args = {};
    }

    try {
      switch (name) {
        case 'list_timbres': {
          const items = await this.agentVtApiService.listTimbres(ctx.userId);
          actions.push({ action: 'list_timbres' });
          return { ok: true, items };
        }
        case 'list_slots': {
          const slots = await this.agentVtApiService.listSlots();
          actions.push({ action: 'list_slots' });
          return { ok: true, slots };
        }
        case 'create_training': {
          const result = await this.agentVtApiService.createTraining(ctx.userId, {
            audioObjectKey: String(args.audioObjectKey ?? ''),
            name: args.name ? String(args.name) : undefined,
            provider: args.provider ? String(args.provider) : undefined,
            speechDialect: args.speechDialect ? String(args.speechDialect) : undefined,
            speechInstruction: args.speechInstruction
              ? String(args.speechInstruction)
              : undefined,
            previewText: args.previewText ? String(args.previewText) : undefined,
          });
          actions.push({ action: 'create_training', detail: String(args.audioObjectKey ?? ''), timbreId: (result as { id?: string } | null)?.id });
          return { ok: true, timbre: result };
        }
        case 'retry_training': {
          const timbreId = String(args.timbreId ?? '');
          const result = await this.agentVtApiService.retryTraining(ctx.userId, timbreId);
          actions.push({ action: 'retry_training', detail: timbreId, timbreId: (result as { id?: string } | null)?.id });
          return { ok: true, timbre: result };
        }
        case 'bind_to_relative': {
          const timbreId = String(args.timbreId ?? '');
          const result = await this.agentVtApiService.bindToRelative(
            ctx.userId,
            timbreId,
            ctx.agentId
          );
          actions.push({ action: 'bind_to_relative', detail: timbreId });
          return { ok: true, bind: result };
        }
        default:
          return { ok: false, error: `unknown tool ${name}` };
      }
    } catch (err) {
      const appErr = err as AppError;
      this.logger.warn('[agent-vt-chat] tool %s failed: %s', name, appErr?.message ?? err);
      return {
        ok: false,
        error: appErr?.message || '操作失败，请稍后再试',
        code: appErr?.code || 'UNKNOWN',
      };
    }
  }

  // ---------- 消息组装 ----------

  private buildMessages(
    input: AgentVtChatInput,
    ctx: { agentName?: string }
  ): Array<Record<string, unknown>> {
    const system = [
      `你是「${this.agentVtConfig?.title ?? '声音训练工作台'}」里的声音训练助手，帮助用户为 AI 亲人「${ctx.agentName || '未命名'}」训练专属声音。`,
      '',
      '训练规则：',
      '- 用户会直接上传音频（通常是 14–30 秒、清晰、单人说话的声音素材），你不需要处理文件本身，只要把音频的 objectKey 用于训练工具。',
      '- 训练免费；创建后自动进入训练队列，通常需要几分钟。',
      '- 音色训练成功（active）后，应主动调用绑定工具，把它绑定到当前账号的 AI 亲人，并明确告知用户已绑定。',
      '- 用户可随时要求查看训练列表、重试失败任务、查看槽位。',
      '',
      '安全与边界：',
      '- 只能操作用户自己的音色，不访问、不猜测其他信息。',
      '- 不要泄露任何密钥、token 或内部实现。',
      '- 回复简洁、温暖，使用中文；先说明发生了什么，再给出下一步。',
    ].join('\n');

    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: system },
    ];

    const history = Array.isArray(input.messages) ? input.messages : [];
    const latestUserIndex = this.findLastUserIndex(history);
    history.forEach((msg, index) => {
      if (index === latestUserIndex && Array.isArray(input.attachments) && input.attachments.length > 0) {
        const attachText = input.attachments
          .map(
            (a) =>
              `（用户本次上传了音频：${a.name || '未命名音频'}，objectKey=${a.objectKey}；如用户要求训练，请直接使用该 objectKey 调用创建训练工具）`
          )
          .join('\n');
        messages.push({
          role: 'user',
          content: `${msg.content || ''}\n${attachText}`.trim(),
        });
      } else {
        messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
      }
    });

    return messages;
  }

  private findLastUserIndex(messages: AgentVtChatMessage[]): number {
    let last = -1;
    messages.forEach((msg, index) => {
      if (msg.role === 'user') {
        last = index;
      }
    });
    return last;
  }

  // ---------- 无 LLM 降级 ----------

  private isLlmConfigured(): boolean {
    const cfg = this.llmConfig;
    return Boolean(cfg?.enabled && cfg.apiKey && cfg.baseURL);
  }

  private async runKeywordFallback(
    input: AgentVtChatInput,
    ctx: { userId: MongoObjectId; agentId: MongoObjectId; agentName?: string }
  ): Promise<AgentVtChatResult> {
    const lastUser = [...(input.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'user');
    const text = lastUser?.content ?? '';
    const attachment = input.attachments?.[0];
    const actions: AgentVtChatResult['actions'] = [];

    try {
      if (/(查看|列表|状态|有哪些)/.test(text) && /(音色|训练|任务)/.test(text)) {
        const items = await this.agentVtApiService.listTimbres(ctx.userId);
        actions.push({ action: 'list_timbres' });
        return {
          reply: this.formatTimbreList(items),
          actions,
        };
      }

      if (/(绑定|亲人)/.test(text)) {
        const items = (await this.agentVtApiService.listTimbres(ctx.userId)) as Array<{
          id?: string;
          name?: string;
          status?: string;
        }>;
        const active = items.find((t) => t.status === 'active');
        if (!active) {
          return { reply: '还没有训练成功的音色，先上传音频训练一个吧。', actions };
        }
        const bind = await this.agentVtApiService.bindToRelative(
          ctx.userId,
          active.id!,
          ctx.agentId
        );
        actions.push({ action: 'bind_to_relative', detail: active.id });
        return {
          reply: `已把音色「${active.name || active.id}」绑定到 AI 亲人「${bind.agentName || ''}」，现在可以用这个声音聊天了。`,
          actions,
        };
      }

      if (attachment && /(训练|开始|用这个|上传)/.test(text)) {
        const created = (await this.agentVtApiService.createTraining(ctx.userId, {
          audioObjectKey: attachment.objectKey,
          name: attachment.name,
        })) as { id?: string };
        actions.push({ action: 'create_training', detail: attachment.objectKey, timbreId: created?.id });
        return {
          reply: `已用你上传的音频「${attachment.name || '这段音频'}」创建声音训练，训练完成后我会自动把它绑定到 AI 亲人「${ctx.agentName || ''}」。请稍等几分钟后问我“训练好了吗”。`,
          actions,
        };
      }

      if (/(重试|失败)/.test(text)) {
        const items = (await this.agentVtApiService.listTimbres(ctx.userId)) as Array<{
          id?: string;
          name?: string;
          status?: string;
        }>;
        const failed = items.find((t) => t.status === 'failed');
        if (!failed) {
          return { reply: '当前没有需要重试的训练任务。', actions };
        }
        await this.agentVtApiService.retryTraining(ctx.userId, failed.id!);
        actions.push({ action: 'retry_training', detail: failed.id });
        return { reply: `已重新提交训练「${failed.name || failed.id}」，稍后可以查看状态。`, actions };
      }
    } catch (err) {
      return {
        reply: `操作没有成功：${(err as AppError).message || '请稍后再试'}`,
        actions,
      };
    }

    return {
      reply:
        '我是声音训练助手。你可以：上传一段音频（14–30 秒清晰人声）让我训练声音、问我“训练好了吗”查看进度，或说“绑定到亲人”把训练好的声音用起来。',
      actions,
    };
  }

  private formatTimbreList(items: unknown[]): string {
    if (!Array.isArray(items) || items.length === 0) {
      return '你还没有训练过声音，先上传一段音频开始吧。';
    }
    const lines = items.map((raw, index) => {
      const t = raw as { name?: string; status?: string; updatedAt?: string; id?: string };
      const statusText: Record<string, string> = {
        pending: '排队中',
        training: '训练中',
        active: '已就绪',
        failed: '失败',
      };
      const time = t.updatedAt ? new Date(t.updatedAt).toLocaleString('zh-CN') : '';
      return `${index + 1}. ${t.name || t.id}｜${statusText[t.status ?? ''] ?? t.status}${time ? `｜${time}` : ''}`;
    });
    return `你的声音训练列表：\n${lines.join('\n')}`;
  }
}
