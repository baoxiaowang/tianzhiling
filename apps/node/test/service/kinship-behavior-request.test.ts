import { readFileSync, writeFileSync } from 'node:fs';
import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { AgentContextService } from '../../src/service/agents/agent.context';

/**
 * 行为验证的“候选请求生成器”：用真实 `buildConversationContext` 产出模型请求，
 * 而不是手写 system prompt。
 *
 * 默认跳过；只有显式提供输入/输出路径时才运行，避免依赖本机证据文件：
 *   TZL_KINSHIP_BEHAVIOR_INPUT=/path/behavior-input.json \
 *   TZL_KINSHIP_BEHAVIOR_OUTPUT=/path/behavior-output.json \
 *   npx jest test/service/kinship-behavior-request.test.ts
 *
 * 输入文件为生产只读导出的角色、会话、消息与请求列表；本测试不调用模型。
 */
const inputPath = process.env.TZL_KINSHIP_BEHAVIOR_INPUT;
const outputPath = process.env.TZL_KINSHIP_BEHAVIOR_OUTPUT;
const runIfConfigured = inputPath && outputPath ? describe : describe.skip;

interface RawMessage {
  _id: string;
  role: MessageRole;
  type: MessageType;
  content: string;
  createdAt: string;
  replyGroupId?: string;
  replySegmentIndex?: number;
  mediaTranscript?: string;
  mediaAnalysis?: string;
}

function toMessage(
  raw: RawMessage,
  ids: { conversationId: MongoObjectId; userId: MongoObjectId; agentId: MongoObjectId }
): MessageEntity {
  const message = new MessageEntity();
  Object.assign(message, {
    id: new MongoObjectId(raw._id),
    conversationId: ids.conversationId,
    userId: ids.userId,
    agentId: ids.agentId,
    role: raw.role,
    type: raw.type || MessageType.text,
    content: raw.content || '',
    status: MessageStatus.sent,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.createdAt),
    replyGroupId: raw.replyGroupId || '',
    ...(typeof raw.replySegmentIndex === 'number'
      ? { replySegmentIndex: raw.replySegmentIndex }
      : {}),
    mediaTranscript: raw.mediaTranscript || '',
    mediaAnalysis: raw.mediaAnalysis || '',
    isArchived: false,
  });
  return message;
}

runIfConfigured(
  'kinship behavior request generation (real buildConversationContext)',
  () => {
    it('builds candidate model requests from the real context pipeline', async () => {
      const input = JSON.parse(readFileSync(inputPath as string, 'utf8'));
      const conversationId = new MongoObjectId(input.conversation.id);
      const userId = new MongoObjectId(input.conversation.userId);
      const agentId = new MongoObjectId(input.conversation.agentId);

      const agent = new AgentEntity();
      Object.assign(agent, {
        id: agentId,
        ...input.agent,
        createdAt: input.agent.createdAt
          ? new Date(input.agent.createdAt)
          : undefined,
      });

      const messages: MessageEntity[] = (input.messages as RawMessage[]).map(
        raw => toMessage(raw, { conversationId, userId, agentId })
      );

      const results: unknown[] = [];

      for (const request of input.requests as Array<{
        label: string;
        currentQuery: string;
        currentMessageId: string;
      }>) {
        const currentIndex = messages.findIndex(
          message => String(message.id) === request.currentMessageId
        );
        expect(currentIndex).toBeGreaterThanOrEqual(0);
        // 模拟该轮当时的库状态：只取到当前消息为止，并保留最近 66 条有界加载量。
        const visible = messages.slice(0, currentIndex + 1).slice(-66);

        const service = new AgentContextService();
        service.messageModel = {
          find: jest.fn().mockResolvedValue([...visible].reverse()),
          findByIds: jest.fn().mockResolvedValue([]),
        } as never;
        service.retrieveService = {
          retrieveConversationMemories: jest.fn().mockResolvedValue([]),
        } as never;
        service.agentProfileFactService = {
          listFactsForPrompt: jest
            .fn()
            .mockResolvedValue(input.profileFacts || []),
        } as never;

        const conversation = new ConversationEntity();
        Object.assign(conversation, {
          id: conversationId,
          userId,
          agentId,
          continuitySummary: input.conversation.continuitySummary,
          continuitySummaryCoveredMessageId:
            input.conversation.continuitySummaryCoveredMessageId &&
            MongoObjectId.isValid(
              input.conversation.continuitySummaryCoveredMessageId
            )
              ? new MongoObjectId(
                  input.conversation.continuitySummaryCoveredMessageId
                )
              : undefined,
        });

        const context = await service.buildConversationContext({
          auth: {
            sub: String(userId),
            accountId: String(userId),
            account: 'kinship-behavior',
            iat: 0,
            exp: 0,
            nonce: 'kinship-behavior',
          },
          conversation,
          agent,
          currentQuery: request.currentQuery,
          currentTurnMessageIds: [request.currentMessageId],
          effectiveChatModel: 'doubao-seed-character-260628',
        } as never);

        results.push({
          label: request.label,
          currentQuery: request.currentQuery,
          visibleMessageCount: visible.length,
          diagnostics: {
            historyMessageCount: context.diagnostics.historyMessageCount,
            historyTurnCount: context.diagnostics.historyTurnCount,
            historyCoverageBoundaryVerifiable:
              context.diagnostics.historyCoverageBoundaryVerifiable,
            historyCoversSummaryBoundary:
              context.diagnostics.historyCoversSummaryBoundary,
            historySummaryGapMessageCount:
              context.diagnostics.historySummaryGapMessageCount,
            historyLoadBoundaryTruncated:
              context.diagnostics.historyLoadBoundaryTruncated,
            historyLoadBoundaryTurnUnconfirmed:
              context.diagnostics.historyLoadBoundaryTurnUnconfirmed,
          },
          messages: context.messages,
        });
      }

      writeFileSync(
        outputPath as string,
        JSON.stringify({ generatedBy: 'buildConversationContext', results }, null, 2)
      );
    }, 120000);
  }
);
