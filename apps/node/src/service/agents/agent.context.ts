import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { MongoRepository } from 'typeorm';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageType,
} from '@tzl/entities';
import { AuthenticatedUserPayload } from '../../interface';
import { buildDepartedSystemPrompt } from '../../promte/departed';
import { RetrieveService } from '../rag/retrieve.service';

export interface BuildConversationContextOptions {
  auth: AuthenticatedUserPayload;
  conversation: ConversationEntity;
  agent: AgentEntity | null;
  currentQuery?: string;
}

export interface AgentContextLayer {
  key: 'persona' | 'history' | 'longTermHistory';
  messages: ChatCompletionMessageParam[];
}

export interface AgentConversationContext {
  layers: AgentContextLayer[];
  messages: ChatCompletionMessageParam[];
}

export interface RetrievedContextSnippet {
  content: string;
  createdAt?: string;
  score?: number;
}

const RECENT_HISTORY_MESSAGE_LIMIT = 3;

@Provide()
export class AgentContextService {
  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @Inject()
  retrieveService: RetrieveService;

  async buildConversationContext(
    options: BuildConversationContextOptions
  ): Promise<AgentConversationContext> {
    const conversationMessages = await this.listConversationMessages(
      options.conversation
    );
    const recentHistoryMessages =
      this.buildRecentHistoryMessages(conversationMessages);
    const retrievedMemories = await this.retrieveLongTermHistory(
      options,
      this.resolveLongTermHistoryCutoff(recentHistoryMessages)
    );
    const layers = [
      this.buildSystemLayer(options, retrievedMemories),
      this.buildHistoryLayer(recentHistoryMessages),
    ];

    return {
      layers,
      messages: layers.reduce<ChatCompletionMessageParam[]>(
        (result, layer) => result.concat(layer.messages),
        []
      ),
    };
  }

  private buildSystemLayer(
    options: BuildConversationContextOptions,
    memories?: RetrievedContextSnippet[]
  ): AgentContextLayer {
    const basePrompt = buildDepartedSystemPrompt({
      userId: options.auth.sub,
      agentId: this.stringifyObjectId(
        options.agent?.id ?? options.conversation.agentId
      ),
      agent: options.agent,
    });
    const longTermHistoryPrompt = this.buildLongTermHistoryPrompt(memories);

    const parts: { type: 'text'; text: string }[] = [
      { type: 'text', text: basePrompt },
    ];

    if (longTermHistoryPrompt) {
      parts.push({ type: 'text', text: longTermHistoryPrompt });
    }

    return {
      key: 'persona',
      messages: [
        {
          role: 'system',
          content: parts,
        } as ChatCompletionMessageParam,
      ],
    };
  }

  private buildHistoryLayer(messages: MessageEntity[]): AgentContextLayer {
    return {
      key: 'history',
      messages: messages
        .map(message => this.buildChatMessage(message))
        .filter(Boolean) as ChatCompletionMessageParam[],
    };
  }

  private buildLongTermHistoryPrompt(
    memories?: RetrievedContextSnippet[]
  ): string {
    const items = (memories || [])
      .map(memory => {
        const content = memory.content?.trim();

        if (!content) {
          return '';
        }

        const date = memory.createdAt?.trim();
        return date ? `[${date}] ${content}` : content;
      })
      .filter(Boolean)
      .slice(0, 10);
    if (!items.length) {
      return '';
    }

    return (
      '以下是长期久远的历史，仅在与当前问题确实相关时参考，不要生搬硬套，更不要把不确定的历史当作既定事实。\n' +
      items.map((item, index) => `${index + 1}. ${item}`).join('\n')
    );
  }

  private async retrieveLongTermHistory(
    options: BuildConversationContextOptions,
    createdBeforeTs?: number
  ): Promise<RetrievedContextSnippet[]> {
    const query = options.currentQuery?.trim();

    if (!query) {
      return [];
    }

    return this.retrieveService.retrieveConversationMemories({
      query,
      userId: options.auth.sub,
      conversationId: this.stringifyObjectId(options.conversation.id),
      agentId: this.stringifyObjectId(
        options.agent?.id ?? options.conversation.agentId
      ),
      createdBeforeTs,
    });
  }

  private async listConversationMessages(
    conversation: ConversationEntity
  ): Promise<MessageEntity[]> {
    return this.messageModel.find({
      where: {
        conversationId: conversation.id,
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  private buildRecentHistoryMessages(
    messages: MessageEntity[]
  ): MessageEntity[] {
    return messages.slice(-RECENT_HISTORY_MESSAGE_LIMIT);
  }

  private resolveLongTermHistoryCutoff(
    recentHistoryMessages: MessageEntity[]
  ): number | undefined {
    if (recentHistoryMessages.length < RECENT_HISTORY_MESSAGE_LIMIT) {
      return undefined;
    }

    const oldestRecentMessage = recentHistoryMessages[0];
    const timestamp = oldestRecentMessage?.createdAt?.getTime?.();

    if (
      typeof timestamp !== 'number' ||
      !Number.isFinite(timestamp) ||
      timestamp <= 0
    ) {
      return undefined;
    }

    return Math.floor(timestamp);
  }

  private buildChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    switch (message.role) {
      case MessageRole.assistant:
        if (!message.content?.trim()) {
          return null;
        }
        return {
          role: 'assistant',
          content: message.content,
        };
      case MessageRole.user:
        if (message.type === MessageType.voice) {
          return this.buildVoiceChatMessage(message);
        }
        if (message.type === MessageType.image) {
          return this.buildImageChatMessage(message);
        }
        if (!message.content?.trim()) {
          return null;
        }
        return {
          role: 'user',
          content: message.content,
        };
      case MessageRole.system:
        if (!message.content?.trim()) {
          return null;
        }
        return {
          role: 'system',
          content: message.content,
        };
      default:
        return null;
    }
  }

  private buildImageChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    const analysis = message.mediaAnalysis?.trim();

    if (!analysis) {
      return null;
    }

    return {
      role: 'user',
      content:
        `用户发送了一张图片。\n图片理解：${analysis}\n` +
        '请只围绕图片里可见的行为、场景、物体和氛围来做自然回应。不要猜测图片中的人是谁，不要做人脸或身份识别，不要追问人物身份、关系或背景。尽量只说你看到的内容，用陈述句回复，不要发出提问。',
    };
  }

  private buildVoiceChatMessage(
    message: MessageEntity
  ): ChatCompletionMessageParam | null {
    const transcript = message.mediaTranscript?.trim();

    if (!transcript) {
      return null;
    }

    return {
      role: 'user',
      content:
        `用户发送了一条语音消息。\n语音转写：${transcript}\n` +
        '请把这段转写内容当作用户刚刚说的话，自然回复，不要强调这是转写结果，除非用户自己提到识别错误或转写问题。',
    };
  }

  private stringifyObjectId(value: unknown): string {
    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'object' && value) {
      const objectValue = value as {
        toHexString?: () => string;
        toString?: () => string;
      };

      if (typeof objectValue.toHexString === 'function') {
        return objectValue.toHexString();
      }

      if (typeof objectValue.toString === 'function') {
        return objectValue.toString();
      }
    }

    return String(value);
  }
}
