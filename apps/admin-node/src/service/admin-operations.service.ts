import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type {
  AdminChatQualityDTO,
  AdminOperationsAlertDTO,
  AdminOperationsOverviewDTO,
  AdminOperationsTaskListDTO,
  AdminSystemRuntimeDTO,
} from '@tzl/shared';
import {
  AgentEntity,
  ChatTraceEntity,
  ChatTraceStatus,
  ConversationChatImportBatchEntity,
  ConversationChatImportStatus,
  ConversationEntity,
  ConversationMessageFeedbackEntity,
  MongoObjectId,
  PostEntity,
  UserEntity,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

type TaskQuery = {
  page?: string | number;
  pageSize?: string | number;
  status?: string;
};

const ACTIVE_IMPORT_STATUSES = [
  ConversationChatImportStatus.uploading,
  ConversationChatImportStatus.queued,
  ConversationChatImportStatus.recognizing,
  ConversationChatImportStatus.importing,
  ConversationChatImportStatus.extractingMemory,
];

const FAILED_IMPORT_STATUSES = [
  ConversationChatImportStatus.failed,
  ConversationChatImportStatus.partialFailed,
];

@Provide()
export class AdminOperationsService {
  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(PostEntity)
  postModel: MongoRepository<PostEntity>;

  @InjectEntityModel(ConversationMessageFeedbackEntity)
  feedbackModel: MongoRepository<ConversationMessageFeedbackEntity>;

  @InjectEntityModel(ChatTraceEntity)
  chatTraceModel: MongoRepository<ChatTraceEntity>;

  @InjectEntityModel(ConversationChatImportBatchEntity)
  chatImportModel: MongoRepository<ConversationChatImportBatchEntity>;

  async getOverview(): Promise<AdminOperationsOverviewDTO> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      userCount,
      agentCount,
      conversationCount,
      postCount,
      activeImports,
      failedImports,
      feedbackCount,
      failedChats,
      alerts,
    ] = await Promise.all([
      this.userModel.count({}),
      this.agentModel.count({
        $or: [
          { messengerOfAgentId: { $exists: false } },
          { messengerOfAgentId: null },
        ],
      } as never),
      this.conversationModel.count({}),
      this.postModel.count({ isDeleted: { $ne: true } } as never),
      this.chatImportModel.count({
        status: { $in: ACTIVE_IMPORT_STATUSES },
      } as never),
      this.chatImportModel.count({
        status: { $in: FAILED_IMPORT_STATUSES },
        updatedAt: { $gte: last24Hours },
      } as never),
      this.feedbackModel.count({ createdAt: { $gte: last7Days } } as never),
      this.chatTraceModel.count({
        status: ChatTraceStatus.failed,
        updatedAt: { $gte: last24Hours },
      } as never),
      this.getRecentAlerts(),
    ]);

    return {
      generatedAt: now.toISOString(),
      metrics: [
        {
          key: 'users',
          label: '用户总数',
          value: userCount,
          tone: 'default',
          hint: '当前系统用户',
        },
        {
          key: 'agents',
          label: '智能体总数',
          value: agentCount,
          tone: 'default',
          hint: '不含内部小使者',
        },
        {
          key: 'conversations',
          label: '关系会话',
          value: conversationCount,
          tone: 'success',
          hint: '累计建立的会话',
        },
        {
          key: 'posts',
          label: '有效动态',
          value: postCount,
          tone: 'default',
          hint: '未删除的动态',
        },
        {
          key: 'activeImports',
          label: '处理中任务',
          value: activeImports,
          tone: activeImports > 0 ? 'warning' : 'success',
          hint: '聊天截图导入',
        },
        {
          key: 'attention',
          label: '待关注异常',
          value: failedImports + failedChats + feedbackCount,
          tone:
            failedImports + failedChats + feedbackCount > 0
              ? 'danger'
              : 'success',
          hint: '24 小时失败及 7 天反馈',
        },
      ],
      alerts,
    };
  }

  async getChatQuality(): Promise<AdminChatQualityDTO> {
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [feedbackLast7Days, failedChatsLast24Hours, feedback, failedTraces] =
      await Promise.all([
        this.feedbackModel.count({ createdAt: { $gte: last7Days } } as never),
        this.chatTraceModel.count({
          status: ChatTraceStatus.failed,
          updatedAt: { $gte: last24Hours },
        } as never),
        this.feedbackModel.find({
          order: { createdAt: 'DESC' },
          take: 30,
        }),
        this.chatTraceModel.find({
          where: { status: ChatTraceStatus.failed },
          order: { updatedAt: 'DESC' },
          take: 30,
        }),
      ]);
    const [userMap, agentMap] = await Promise.all([
      this.getUserNameMap(feedback.map(item => item.userId)),
      this.getAgentNameMap(feedback.map(item => item.agentId)),
    ]);

    return {
      generatedAt: now.toISOString(),
      feedbackLast7Days,
      failedChatsLast24Hours,
      feedback: feedback.map(item => ({
        id: this.stringifyObjectId(item.id),
        type: item.type ?? '',
        content: item.content?.trim() ?? '',
        assistantContent: item.assistantContent?.trim() ?? '',
        userId: this.stringifyObjectId(item.userId),
        userName: userMap.get(this.stringifyObjectId(item.userId)) ?? '',
        agentId: this.stringifyObjectId(item.agentId),
        agentName: agentMap.get(this.stringifyObjectId(item.agentId)) ?? '',
        conversationId: this.stringifyObjectId(item.conversationId),
        messageId: this.stringifyObjectId(item.messageId),
        createdAt: this.formatDate(item.createdAt),
      })),
      failedTraces: failedTraces.map(item => ({
        id: this.stringifyObjectId(item.id),
        traceId: item.traceId ?? '',
        conversationId: item.conversationId ?? '',
        userId: item.userId ?? '',
        agentId: item.agentId ?? '',
        status: item.status ?? '',
        failureStage: item.failureStage?.trim() ?? '',
        errorCode: item.errorCode?.trim() ?? '',
        visibleLatencyMs: item.visibleLatencyMs,
        totalLatencyMs: item.totalLatencyMs,
        totalTokens: item.totalTokens ?? 0,
        releaseVersion: item.releaseVersion?.trim() ?? '',
        updatedAt: this.formatDate(item.updatedAt),
      })),
    };
  }

  async listTasks(query: TaskQuery): Promise<AdminOperationsTaskListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const status = query?.status?.trim();
    const where = status ? { status } : {};
    const [total, items] = await Promise.all([
      this.chatImportModel.count(where),
      this.chatImportModel.find({
        where: where as never,
        order: { updatedAt: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      items: items.map(item => ({
        id: this.stringifyObjectId(item.id),
        type: 'chat_import',
        title: `聊天截图导入 · ${item.screenshotCount ?? 0} 张`,
        status: item.status ?? '',
        userId: this.stringifyObjectId(item.userId),
        agentId: this.stringifyObjectId(item.agentId),
        conversationId: this.stringifyObjectId(item.conversationId),
        progressCurrent: item.recognizedCount ?? 0,
        progressTotal: item.screenshotCount ?? 0,
        duplicateCount: item.duplicateCount ?? 0,
        retryCount: item.retryCount ?? 0,
        errorCode: item.errorCode?.trim() ?? '',
        errorDetail: item.errorDetail?.trim() ?? '',
        startedAt: this.formatDate(item.submittedAt ?? item.createdAt),
        completedAt: this.formatDate(item.completedAt),
        updatedAt: this.formatDate(item.updatedAt),
      })),
      total,
      page,
      pageSize,
    };
  }

  async getSystemRuntime(): Promise<AdminSystemRuntimeDTO> {
    const memory = process.memoryUsage();
    const [
      activeChatImports,
      failedChatImports,
      runningChatTraces,
      failedChatTraces,
    ] = await Promise.all([
      this.chatImportModel.count({
        status: { $in: ACTIVE_IMPORT_STATUSES },
      } as never),
      this.chatImportModel.count({
        status: { $in: FAILED_IMPORT_STATUSES },
      } as never),
      this.chatTraceModel.count({ status: ChatTraceStatus.running }),
      this.chatTraceModel.count({ status: ChatTraceStatus.failed }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      service: 'admin-node',
      status: 'ok',
      releaseVersion: process.env.RELEASE_VERSION?.trim() || 'unknown',
      nodeEnv: process.env.NODE_ENV?.trim() || 'unknown',
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: this.bytesToMb(memory.rss),
        heapUsedMb: this.bytesToMb(memory.heapUsed),
        heapTotalMb: this.bytesToMb(memory.heapTotal),
      },
      queues: {
        activeChatImports,
        failedChatImports,
        runningChatTraces,
        failedChatTraces,
      },
    };
  }

  private async getRecentAlerts(): Promise<AdminOperationsAlertDTO[]> {
    const [feedback, traces, imports] = await Promise.all([
      this.feedbackModel.find({ order: { createdAt: 'DESC' }, take: 4 }),
      this.chatTraceModel.find({
        where: { status: ChatTraceStatus.failed },
        order: { updatedAt: 'DESC' },
        take: 4,
      }),
      this.chatImportModel.find({
        where: { status: { $in: FAILED_IMPORT_STATUSES } } as never,
        order: { updatedAt: 'DESC' },
        take: 4,
      }),
    ]);

    return [
      ...feedback.map(item => ({
        id: `feedback:${this.stringifyObjectId(item.id)}`,
        category: 'feedback' as const,
        title: '用户提交了聊天反馈',
        description:
          item.content?.trim() || item.assistantContent?.trim() || item.type,
        occurredAt: this.formatDate(item.createdAt),
        targetType: 'agent' as const,
        targetId: this.stringifyObjectId(item.agentId),
      })),
      ...traces.map(item => ({
        id: `trace:${item.traceId}`,
        category: 'chat' as const,
        title: '聊天生成失败',
        description: [item.failureStage, item.errorCode]
          .filter(Boolean)
          .join(' · '),
        occurredAt: this.formatDate(item.updatedAt),
        targetType: item.agentId ? ('agent' as const) : undefined,
        targetId: item.agentId,
      })),
      ...imports.map(item => ({
        id: `import:${this.stringifyObjectId(item.id)}`,
        category: 'import' as const,
        title: '聊天截图导入失败',
        description:
          item.errorCode?.trim() || item.errorDetail?.trim() || '待检查',
        occurredAt: this.formatDate(item.updatedAt),
        targetType: 'agent' as const,
        targetId: this.stringifyObjectId(item.agentId),
      })),
    ]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, 8);
  }

  private async getUserNameMap(
    ids: MongoObjectId[]
  ): Promise<Map<string, string>> {
    const uniqueIds = this.uniqueObjectIds(ids);
    if (uniqueIds.length === 0) return new Map();
    const users = await this.userModel.find({
      where: { id: { $in: uniqueIds } as never } as never,
    });
    return new Map(
      users.map(user => [
        this.stringifyObjectId(user.id),
        user.name?.trim() ?? '',
      ])
    );
  }

  private async getAgentNameMap(
    ids: MongoObjectId[]
  ): Promise<Map<string, string>> {
    const uniqueIds = this.uniqueObjectIds(ids);
    if (uniqueIds.length === 0) return new Map();
    const agents = await this.agentModel.find({
      where: { id: { $in: uniqueIds } as never } as never,
    });
    return new Map(
      agents.map(agent => [
        this.stringifyObjectId(agent.id),
        agent.name?.trim() ?? '',
      ])
    );
  }

  private uniqueObjectIds(ids: MongoObjectId[]): MongoObjectId[] {
    const result = new Map<string, MongoObjectId>();
    ids
      .filter(Boolean)
      .forEach(id => result.set(this.stringifyObjectId(id), id));
    return [...result.values()];
  }

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private stringifyObjectId(value?: MongoObjectId | string): string {
    if (!value) return '';
    return typeof value === 'string' ? value : value.toHexString();
  }

  private formatDate(value?: Date): string {
    return value instanceof Date && !Number.isNaN(value.getTime())
      ? value.toISOString()
      : '';
  }

  private bytesToMb(value: number): number {
    return Math.round((value / 1024 / 1024) * 10) / 10;
  }
}
