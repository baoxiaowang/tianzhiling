import { Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import type {
  AdminAuthenticatedPayload,
  AdminChatQualityDTO,
  AdminOperationsAlertDTO,
  AdminOrderAnalyticsDTO,
  AdminOperationsOverviewDTO,
  AdminOperationsReportDTO,
  AdminOperationsTaskListDTO,
  AdminSystemRuntimeDTO,
  AdminUserValueReportDTO,
  UpdateAdminChatFeedbackRequestDTO,
} from '@tzl/shared';
import { AppError, getDouyinPromotionExpense } from '@tzl/shared';
import {
  AgentEntity,
  ChatTraceEntity,
  ChatTraceStatus,
  ConversationChatImportBatchEntity,
  ConversationChatImportStatus,
  ConversationEntity,
  ConversationMessageFeedbackHandlingStatus,
  ConversationMessageFeedbackEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MongoObjectId,
  OrderEntity,
  OrderRefundEntity,
  OrderRefundStatus,
  OrderStatus,
  PostEntity,
  TableName,
  UserEntity,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';

type TaskQuery = {
  page?: string | number;
  pageSize?: string | number;
  status?: string;
};

type DailyCountRow = { _id: string; count: number };
type DailyAmountRow = { _id: string; amount: number };
type HourlyCountRow = { _id: string; count: number };
type DailyMessageStatsRow = {
  _id: string;
  allChatUsers: number;
  userMessages: number;
  newUserChatUsers: number;
  newUserMessages: number;
  newUserFiveMessageUsers: number;
};
type DailyOrderStatsRow = {
  _id: string;
  paidUsers: number;
  paidOrders: number;
  paidAmount: number;
  sameDayPayingUsers: number;
};
type PeriodOrderStatsRow = {
  paidUsers: number;
  paidOrders: number;
  paidAmount: number;
};
type AllTimeChatStatsRow = { chatUsers: number; userMessages: number };
type UserAmountRow = { _id: MongoObjectId; amount: number };
type CohortUserCountRow = { _id: string; count: number };
type CohortOrderStatsRow = {
  _id: string;
  payingUsers: number;
  revenue: number;
  revenue7Day: number;
  revenue30Day: number;
};

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const BEIJING_TIMEZONE = 'Asia/Shanghai' as const;
const NEW_USER_CHAT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

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
  private readonly reportCache = new Map<
    string,
    { expiresAt: number; value: AdminOperationsReportDTO }
  >();
  private readonly userValueCache = new Map<
    string,
    { expiresAt: number; value: AdminUserValueReportDTO }
  >();
  private readonly orderAnalyticsCache = new Map<
    string,
    { expiresAt: number; value: AdminOrderAnalyticsDTO }
  >();
  private allTimeCache?: {
    expiresAt: number;
    value: AdminOperationsReportDTO['allTime'];
  };

  @InjectEntityModel(UserEntity)
  userModel: MongoRepository<UserEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(ConversationEntity)
  conversationModel: MongoRepository<ConversationEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  @InjectEntityModel(OrderEntity)
  orderModel: MongoRepository<OrderEntity>;

  @InjectEntityModel(OrderRefundEntity)
  orderRefundModel: MongoRepository<OrderRefundEntity>;

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
      this.feedbackModel.count({
        createdAt: { $gte: last7Days },
        $or: [
          { handlingStatus: { $exists: false } },
          { handlingStatus: null },
          {
            handlingStatus: {
              $in: [
                ConversationMessageFeedbackHandlingStatus.pending,
                ConversationMessageFeedbackHandlingStatus.processing,
              ],
            },
          },
        ],
      } as never),
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
        handlingStatus:
          item.handlingStatus ??
          ConversationMessageFeedbackHandlingStatus.pending,
        handlingNote: item.handlingNote?.trim() ?? '',
        handledBy: item.handledBy?.trim() ?? '',
        handledAt: this.formatDate(item.handledAt),
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

  async updateFeedback(
    feedbackId: string,
    payload: UpdateAdminChatFeedbackRequestDTO,
    operator: AdminAuthenticatedPayload
  ) {
    if (!MongoObjectId.isValid(feedbackId)) {
      throw new AppError('INVALID_FEEDBACK_ID', 'invalid feedback id', 400);
    }
    const objectId = new MongoObjectId(feedbackId);
    const feedback =
      (await this.feedbackModel.findOne({ where: { id: objectId } })) ??
      (await this.feedbackModel.findOne({
        where: { _id: objectId } as never,
      }));

    if (!feedback) {
      throw new AppError('FEEDBACK_NOT_FOUND', 'feedback not found', 404);
    }

    const status = payload?.status;
    if (
      !Object.values(ConversationMessageFeedbackHandlingStatus).includes(
        status as ConversationMessageFeedbackHandlingStatus
      )
    ) {
      throw new AppError(
        'INVALID_FEEDBACK_STATUS',
        'invalid feedback status',
        400
      );
    }

    const now = new Date();
    feedback.handlingStatus =
      status as ConversationMessageFeedbackHandlingStatus;
    feedback.handlingNote = payload?.note?.trim().slice(0, 1000) ?? '';
    feedback.handledBy = operator?.account?.trim() || operator?.sub || '';
    feedback.handledAt = now;
    feedback.updatedAt = now;
    await this.feedbackModel.save(feedback);

    return {
      id: feedbackId,
      handlingStatus: feedback.handlingStatus,
      handlingNote: feedback.handlingNote,
      handledBy: feedback.handledBy,
      handledAt: now.toISOString(),
    };
  }

  async getReport(month?: string): Promise<AdminOperationsReportDTO> {
    const now = new Date();
    const beijingNow = new Date(now.getTime() + BEIJING_OFFSET_MS);
    const currentMonth = `${beijingNow.getUTCFullYear()}-${String(
      beijingNow.getUTCMonth() + 1
    ).padStart(2, '0')}`;
    const normalizedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')
      ? (month as string)
      : currentMonth;
    const cached = this.reportCache.get(normalizedMonth);
    if (cached && cached.expiresAt > now.getTime()) {
      return cached.value;
    }
    const [yearText, monthText] = normalizedMonth.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const monthStart = new Date(
      Date.UTC(year, monthIndex, 1) - BEIJING_OFFSET_MS
    );
    const monthEnd = new Date(
      Date.UTC(year, monthIndex + 1, 1) - BEIJING_OFFSET_MS
    );
    const today = `${beijingNow.getUTCFullYear()}-${String(
      beijingNow.getUTCMonth() + 1
    ).padStart(2, '0')}-${String(beijingNow.getUTCDate()).padStart(2, '0')}`;
    const todayStart = new Date(
      Date.UTC(
        beijingNow.getUTCFullYear(),
        beijingNow.getUTCMonth(),
        beijingNow.getUTCDate()
      ) - BEIJING_OFFSET_MS
    );
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const liveUserMessageMatch = {
      role: MessageRole.user,
      status: MessageStatus.sent,
      $or: [{ source: { $exists: false } }, { source: 'live' }],
    };
    const realOrderMatch = {
      targetCode: { $ne: 'voice_one' },
      source: { $ne: 'admin' },
      paymentProvider: { $ne: 'admin_manual' },
    };

    const [
      users,
      agents,
      messageStats,
      orderStats,
      periodOrderStats,
      refunded,
      legacyRefunded,
      hourlyUsers,
      hourlyMessages,
      allTime,
      cohortDaily,
    ] = await Promise.all([
      this.aggregateDailyCount(this.userModel, monthStart, monthEnd),
      this.aggregateDailyCount(this.agentModel, monthStart, monthEnd, {
        $or: [
          { messengerOfAgentId: { $exists: false } },
          { messengerOfAgentId: null },
        ],
      }),
      this.aggregateDailyMessageStats(
        monthStart,
        monthEnd,
        liveUserMessageMatch
      ),
      this.aggregateDailyOrderStats(monthStart, monthEnd, realOrderMatch),
      this.aggregatePeriodOrderStats(monthStart, monthEnd, realOrderMatch),
      this.aggregateDailyAmount(
        this.orderRefundModel,
        {
          ...realOrderMatch,
          status: OrderRefundStatus.completed,
          requestedAt: { $gte: monthStart, $lt: monthEnd },
        },
        '$requestedAt',
        '$amount'
      ),
      this.aggregateLegacyDailyRefundAmounts(
        monthStart,
        monthEnd,
        realOrderMatch
      ),
      this.aggregateHourlyCount(this.userModel, todayStart, todayEnd),
      this.aggregateHourlyCount(
        this.messageModel,
        todayStart,
        todayEnd,
        liveUserMessageMatch
      ),
      this.getAllTimeStats(liveUserMessageMatch, realOrderMatch),
      this.aggregateCohortDailyRevenue(monthStart, monthEnd, realOrderMatch),
    ]);

    const dailyMaps = {
      users: this.countMap(users),
      agents: this.countMap(agents),
      messages: new Map(messageStats.map(row => [row._id, row])),
      orders: new Map(orderStats.map(row => [row._id, row])),
      refunded: this.mergeAmountMaps(refunded, legacyRefunded),
      cohortDaily: new Map(
        cohortDaily.map(row => [row._id, Number(row.revenue) || 0])
      ),
    };
    const daysInMonth = new Date(
      Date.UTC(year, monthIndex + 1, 0)
    ).getUTCDate();
    const lastDay =
      normalizedMonth === currentMonth
        ? Math.min(beijingNow.getUTCDate(), daysInMonth)
        : daysInMonth;
    const daily = Array.from({ length: lastDay }, (_, index) => {
      const date = `${normalizedMonth}-${String(index + 1).padStart(2, '0')}`;
      const messageRow = dailyMaps.messages.get(date);
      const orderRow = dailyMaps.orders.get(date);
      const paidRevenue = this.centsToYuan(orderRow?.paidAmount ?? 0);
      const refundedRevenue = this.centsToYuan(
        dailyMaps.refunded.get(date) ?? 0
      );
      const cohortRevenue = this.centsToYuan(
        dailyMaps.cohortDaily.get(date) ?? 0
      );
      const promotionExpense = getDouyinPromotionExpense(date);
      return {
        date,
        newUsers: dailyMaps.users.get(date) ?? 0,
        newAgents: dailyMaps.agents.get(date) ?? 0,
        newUserChatUsers: messageRow?.newUserChatUsers ?? 0,
        newUserMessages: messageRow?.newUserMessages ?? 0,
        newUserFiveMessageUsers: messageRow?.newUserFiveMessageUsers ?? 0,
        allChatUsers: messageRow?.allChatUsers ?? 0,
        userMessages: messageRow?.userMessages ?? 0,
        paidUsers: orderRow?.paidUsers ?? 0,
        paidOrders: orderRow?.paidOrders ?? 0,
        sameDayPayingUsers: orderRow?.sameDayPayingUsers ?? 0,
        paidRevenue,
        refundedRevenue,
        netRevenue: this.roundMoney(paidRevenue - refundedRevenue),
        cohortRevenue,
        promotionExpense,
        profit: this.roundMoney(cohortRevenue - promotionExpense),
      };
    });
    const hourlyUserMap = this.countMap(hourlyUsers);
    const hourlyMessageMap = this.countMap(hourlyMessages);
    const hourly = Array.from({ length: 24 }, (_, hour) => {
      const key = String(hour).padStart(2, '0');
      return {
        hour: `${key}:00`,
        newUsers: hourlyUserMap.get(key) ?? 0,
        userMessages: hourlyMessageMap.get(key) ?? 0,
      };
    });
    const totals = daily.reduce(
      (result, item) => ({
        newUsers: result.newUsers + item.newUsers,
        newAgents: result.newAgents + item.newAgents,
        newUserChatUsers: result.newUserChatUsers + item.newUserChatUsers,
        newUserMessages: result.newUserMessages + item.newUserMessages,
        allChatUsers: result.allChatUsers + item.allChatUsers,
        userMessages: result.userMessages + item.userMessages,
        paidUsers: result.paidUsers,
        paidOrders: result.paidOrders,
        paidRevenue: result.paidRevenue,
        refundedRevenue: this.roundMoney(
          result.refundedRevenue + item.refundedRevenue
        ),
        netRevenue: this.roundMoney(result.netRevenue + item.netRevenue),
      }),
      {
        newUsers: 0,
        newAgents: 0,
        newUserChatUsers: 0,
        newUserMessages: 0,
        allChatUsers: 0,
        userMessages: 0,
        paidUsers: periodOrderStats.paidUsers,
        paidOrders: periodOrderStats.paidOrders,
        paidRevenue: this.centsToYuan(periodOrderStats.paidAmount),
        refundedRevenue: 0,
        netRevenue: 0,
      }
    );
    const todayRow = daily.find(item => item.date === today);

    const result: AdminOperationsReportDTO = {
      generatedAt: now.toISOString(),
      timezone: BEIJING_TIMEZONE,
      month: normalizedMonth,
      today,
      totals,
      todayTotals: {
        newUsers: todayRow?.newUsers ?? 0,
        newAgents: todayRow?.newAgents ?? 0,
        newUserChatUsers: todayRow?.newUserChatUsers ?? 0,
        newUserMessages: todayRow?.newUserMessages ?? 0,
        newUserFiveMessageUsers: todayRow?.newUserFiveMessageUsers ?? 0,
        allChatUsers: todayRow?.allChatUsers ?? 0,
        userMessages: todayRow?.userMessages ?? 0,
        paidUsers: todayRow?.paidUsers ?? 0,
        paidOrders: todayRow?.paidOrders ?? 0,
        sameDayPayingUsers: todayRow?.sameDayPayingUsers ?? 0,
        netRevenue: todayRow?.netRevenue ?? 0,
      },
      allTime,
      daily,
      hourly,
    };
    this.reportCache.set(normalizedMonth, {
      expiresAt: now.getTime() + 5 * 60 * 1000,
      value: result,
    });
    return result;
  }

  async getUserValueReport(
    endMonth?: string,
    rawMonths?: string | number
  ): Promise<AdminUserValueReportDTO> {
    const now = new Date();
    const currentMonth = this.getBeijingMonth(now);
    const requestedEndMonth = this.normalizeMonth(endMonth, currentMonth);
    const normalizedEndMonth =
      requestedEndMonth > currentMonth ? currentMonth : requestedEndMonth;
    const months = Math.min(this.normalizePositiveInteger(rawMonths, 6), 24);
    const cacheKey = `${normalizedEndMonth}:${months}`;
    const cached = this.userValueCache.get(cacheKey);

    if (cached && cached.expiresAt > now.getTime()) {
      return cached.value;
    }

    const [endYearText, endMonthText] = normalizedEndMonth.split('-');
    const endYear = Number(endYearText);
    const endMonthIndex = Number(endMonthText) - 1;
    const rangeStart = new Date(
      Date.UTC(endYear, endMonthIndex - months + 1, 1) - BEIJING_OFFSET_MS
    );
    const rangeEnd = new Date(
      Date.UTC(endYear, endMonthIndex + 1, 1) - BEIJING_OFFSET_MS
    );
    const realOrderMatch = this.buildRealOrderMatch();
    const [userRows, orderRows] = await Promise.all([
      this.userModel
        .aggregate<CohortUserCountRow>([
          { $match: { createdAt: { $gte: rangeStart, $lt: rangeEnd } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$createdAt',
                  timezone: '+08:00',
                },
              },
              count: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      this.aggregateCohortOrderStats(rangeStart, rangeEnd, realOrderMatch),
    ]);
    const userMap = new Map(
      userRows.map(row => [row._id, Number(row.count) || 0])
    );
    const orderMap = new Map(orderRows.map(row => [row._id, row]));
    const items = Array.from({ length: months }, (_, index) => {
      const monthDate = new Date(
        Date.UTC(endYear, endMonthIndex - months + 1 + index, 1)
      );
      const month = `${monthDate.getUTCFullYear()}-${String(
        monthDate.getUTCMonth() + 1
      ).padStart(2, '0')}`;
      const monthStart = new Date(
        Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1) -
          BEIJING_OFFSET_MS
      );
      const monthEnd = new Date(
        Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1) -
          BEIJING_OFFSET_MS
      );
      const observedDays = Math.max(
        0,
        Math.min(
          Math.round((monthEnd.getTime() - monthStart.getTime()) / 86400000),
          Math.floor((now.getTime() - monthStart.getTime()) / 86400000) + 1
        )
      );
      const newUsers = userMap.get(month) ?? 0;
      const orderRow = orderMap.get(month);
      const payingUsers = Number(orderRow?.payingUsers) || 0;
      const revenue = this.centsToYuan(Number(orderRow?.revenue) || 0);
      const revenue7Day = this.centsToYuan(Number(orderRow?.revenue7Day) || 0);
      const revenue30Day = this.centsToYuan(
        Number(orderRow?.revenue30Day) || 0
      );
      const is7DayMature = now.getTime() >= monthEnd.getTime() + 7 * 86400000;
      const is30DayMature = now.getTime() >= monthEnd.getTime() + 30 * 86400000;

      return {
        month,
        observedDays,
        newUsers,
        payingUsers,
        payRate: this.roundRate(payingUsers, newUsers),
        revenue,
        userValue: this.roundAverage(revenue, newUsers),
        value7Day: is7DayMature
          ? this.roundAverage(revenue7Day, newUsers)
          : undefined,
        value30Day: is30DayMature
          ? this.roundAverage(revenue30Day, newUsers)
          : undefined,
        is7DayMature,
        is30DayMature,
      };
    });
    const result: AdminUserValueReportDTO = {
      generatedAt: now.toISOString(),
      timezone: BEIJING_TIMEZONE,
      endMonth: normalizedEndMonth,
      months,
      items,
    };

    this.userValueCache.set(cacheKey, {
      expiresAt: now.getTime() + 5 * 60 * 1000,
      value: result,
    });

    return result;
  }

  async getOrderAnalytics(month?: string): Promise<AdminOrderAnalyticsDTO> {
    const now = new Date();
    const currentMonth = this.getBeijingMonth(now);
    const normalizedMonth = this.normalizeMonth(month, currentMonth);
    const cached = this.orderAnalyticsCache.get(normalizedMonth);

    if (cached && cached.expiresAt > now.getTime()) {
      return cached.value;
    }

    const [yearText, monthText] = normalizedMonth.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const monthStart = new Date(
      Date.UTC(year, monthIndex, 1) - BEIJING_OFFSET_MS
    );
    const monthEnd = new Date(
      Date.UTC(year, monthIndex + 1, 1) - BEIJING_OFFSET_MS
    );
    const realOrderMatch = this.buildRealOrderMatch();
    const [
      createdOrders,
      paidCreatedOrders,
      orderRows,
      periodOrderStats,
      refundedRows,
      legacyRefundedRows,
      firstTimePayingUsers,
    ] = await Promise.all([
      this.orderModel.count({
        ...realOrderMatch,
        createdAt: { $gte: monthStart, $lt: monthEnd },
      } as never),
      this.orderModel.count({
        ...realOrderMatch,
        createdAt: { $gte: monthStart, $lt: monthEnd },
        paidAt: { $type: 'date' },
      } as never),
      this.aggregateDailyOrderStats(monthStart, monthEnd, realOrderMatch),
      this.aggregatePeriodOrderStats(monthStart, monthEnd, realOrderMatch),
      this.aggregateDailyAmount(
        this.orderRefundModel,
        {
          ...realOrderMatch,
          status: OrderRefundStatus.completed,
          requestedAt: { $gte: monthStart, $lt: monthEnd },
        },
        '$requestedAt',
        '$amount'
      ),
      this.aggregateLegacyDailyRefundAmounts(
        monthStart,
        monthEnd,
        realOrderMatch
      ),
      this.aggregateFirstTimePayingUsers(monthStart, monthEnd, realOrderMatch),
    ]);
    const orderMap = new Map(orderRows.map(row => [row._id, row]));
    const refundMap = this.mergeAmountMaps(refundedRows, legacyRefundedRows);
    const beijingNow = new Date(now.getTime() + BEIJING_OFFSET_MS);
    const daysInMonth = new Date(
      Date.UTC(year, monthIndex + 1, 0)
    ).getUTCDate();
    const lastDay =
      normalizedMonth === currentMonth
        ? Math.min(beijingNow.getUTCDate(), daysInMonth)
        : daysInMonth;
    const daily = Array.from({ length: lastDay }, (_, index) => {
      const date = `${normalizedMonth}-${String(index + 1).padStart(2, '0')}`;
      const orderRow = orderMap.get(date);
      const paidRevenue = this.centsToYuan(orderRow?.paidAmount ?? 0);
      const refundedRevenue = this.centsToYuan(refundMap.get(date) ?? 0);

      return {
        date,
        paidUsers: orderRow?.paidUsers ?? 0,
        paidOrders: orderRow?.paidOrders ?? 0,
        paidRevenue,
        refundedRevenue,
        netRevenue: this.roundMoney(paidRevenue - refundedRevenue),
      };
    });
    const refundedRevenue = this.roundMoney(
      daily.reduce((sum, item) => sum + item.refundedRevenue, 0)
    );
    const paidRevenue = this.centsToYuan(periodOrderStats.paidAmount);
    const result: AdminOrderAnalyticsDTO = {
      generatedAt: now.toISOString(),
      timezone: BEIJING_TIMEZONE,
      month: normalizedMonth,
      totals: {
        createdOrders,
        paidOrders: periodOrderStats.paidOrders,
        payingUsers: periodOrderStats.paidUsers,
        firstTimePayingUsers,
        paidRevenue,
        refundedRevenue,
        netRevenue: this.roundMoney(paidRevenue - refundedRevenue),
        averageOrderAmount: this.roundAverage(
          paidRevenue,
          periodOrderStats.paidOrders
        ),
        paymentSuccessRate: this.roundRate(paidCreatedOrders, createdOrders),
        refundRate: this.roundRate(refundedRevenue, paidRevenue),
      },
      daily,
    };

    this.orderAnalyticsCache.set(normalizedMonth, {
      expiresAt: now.getTime() + 5 * 60 * 1000,
      value: result,
    });

    return result;
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
      this.feedbackModel.find({
        where: {
          $or: [
            { handlingStatus: { $exists: false } },
            { handlingStatus: null },
            {
              handlingStatus: {
                $in: [
                  ConversationMessageFeedbackHandlingStatus.pending,
                  ConversationMessageFeedbackHandlingStatus.processing,
                ],
              },
            },
          ],
        } as never,
        order: { createdAt: 'DESC' },
        take: 4,
      }),
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

  private async aggregateDailyMessageStats(
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown>
  ): Promise<DailyMessageStatsRow[]> {
    return this.messageModel
      .aggregate<DailyMessageStatsRow>([
        {
          $match: {
            ...extraMatch,
            createdAt: { $gte: start, $lt: end },
          },
        },
        {
          $lookup: {
            from: TableName.user,
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: '+08:00',
              },
            },
            userId: 1,
            isNewUser: {
              $and: [
                { $gte: ['$createdAt', '$user.createdAt'] },
                {
                  $lt: [
                    '$createdAt',
                    { $add: ['$user.createdAt', NEW_USER_CHAT_WINDOW_MS] },
                  ],
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              date: '$date',
              userId: '$userId',
            },
            messageCount: { $sum: 1 },
            newUserMessageCount: {
              $sum: { $cond: ['$isNewUser', 1, 0] },
            },
          },
        },
        {
          $group: {
            _id: '$_id.date',
            allChatUsers: { $sum: 1 },
            userMessages: { $sum: '$messageCount' },
            newUserChatUsers: {
              $sum: {
                $cond: [{ $gt: ['$newUserMessageCount', 0] }, 1, 0],
              },
            },
            newUserMessages: { $sum: '$newUserMessageCount' },
            newUserFiveMessageUsers: {
              $sum: {
                $cond: [{ $gte: ['$newUserMessageCount', 5] }, 1, 0],
              },
            },
          },
        },
      ])
      .toArray();
  }

  private async aggregateDailyOrderStats(
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown>
  ): Promise<DailyOrderStatsRow[]> {
    return this.orderModel
      .aggregate<DailyOrderStatsRow>([
        {
          $match: {
            ...extraMatch,
            paidAt: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: {
              date: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$paidAt',
                  timezone: '+08:00',
                },
              },
              userId: '$userId',
            },
            paidOrders: { $sum: 1 },
            paidAmount: {
              $sum: { $ifNull: ['$paidAmount', '$payableAmount'] },
            },
          },
        },
        {
          $lookup: {
            from: TableName.user,
            localField: '_id.userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            date: '$_id.date',
            paidOrders: 1,
            paidAmount: 1,
            isSameDayUser: {
              $eq: [
                '$_id.date',
                {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$user.createdAt',
                    timezone: '+08:00',
                  },
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: '$date',
            paidUsers: { $sum: 1 },
            paidOrders: { $sum: '$paidOrders' },
            paidAmount: { $sum: '$paidAmount' },
            sameDayPayingUsers: {
              $sum: { $cond: ['$isSameDayUser', 1, 0] },
            },
          },
        },
      ])
      .toArray();
  }

  private async aggregatePeriodOrderStats(
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown>
  ): Promise<PeriodOrderStatsRow> {
    const rows = await this.orderModel
      .aggregate<PeriodOrderStatsRow>([
        {
          $match: {
            ...extraMatch,
            paidAt: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: '$userId',
            paidOrders: { $sum: 1 },
            paidAmount: {
              $sum: { $ifNull: ['$paidAmount', '$payableAmount'] },
            },
          },
        },
        {
          $group: {
            _id: null,
            paidUsers: { $sum: 1 },
            paidOrders: { $sum: '$paidOrders' },
            paidAmount: { $sum: '$paidAmount' },
          },
        },
      ])
      .toArray();

    return rows[0] ?? { paidUsers: 0, paidOrders: 0, paidAmount: 0 };
  }

  private async getAllTimeStats(
    liveUserMessageMatch: Record<string, unknown>,
    realOrderMatch: Record<string, unknown>
  ): Promise<AdminOperationsReportDTO['allTime']> {
    const now = Date.now();

    if (this.allTimeCache && this.allTimeCache.expiresAt > now) {
      return this.allTimeCache.value;
    }

    const [users, agents, chatRows, orderRows, refundRows, legacyRefundRows] =
      await Promise.all([
        this.userModel.count({}),
        this.agentModel.count({
          $or: [
            { messengerOfAgentId: { $exists: false } },
            { messengerOfAgentId: null },
          ],
        } as never),
        this.messageModel
          .aggregate<AllTimeChatStatsRow>([
            { $match: liveUserMessageMatch },
            { $group: { _id: '$userId', messages: { $sum: 1 } } },
            {
              $group: {
                _id: null,
                chatUsers: { $sum: 1 },
                userMessages: { $sum: '$messages' },
              },
            },
          ])
          .toArray(),
        this.orderModel
          .aggregate<UserAmountRow>([
            {
              $match: {
                ...realOrderMatch,
                paidAt: { $type: 'date' },
              },
            },
            {
              $group: {
                _id: '$userId',
                amount: {
                  $sum: { $ifNull: ['$paidAmount', '$payableAmount'] },
                },
              },
            },
          ])
          .toArray(),
        this.orderRefundModel
          .aggregate<UserAmountRow>([
            {
              $match: {
                ...realOrderMatch,
                status: OrderRefundStatus.completed,
              },
            },
            { $group: { _id: '$userId', amount: { $sum: '$amount' } } },
          ])
          .toArray(),
        this.aggregateLegacyRefundAmountsByUser(realOrderMatch),
      ]);
    const chat = chatRows[0];
    const refundMap = new Map<string, number>();

    for (const row of [...refundRows, ...legacyRefundRows]) {
      const userId = this.stringifyObjectId(row._id);

      refundMap.set(
        userId,
        (refundMap.get(userId) ?? 0) + (Number(row.amount) || 0)
      );
    }
    const netAmounts = orderRows.map(row =>
      Math.max(
        (Number(row.amount) || 0) -
          (Number(refundMap.get(this.stringifyObjectId(row._id))) || 0),
        0
      )
    );
    const value = {
      users,
      agents,
      chatUsers: Number(chat?.chatUsers) || 0,
      userMessages: Number(chat?.userMessages) || 0,
      payingUsers: netAmounts.filter(amount => amount > 0).length,
      netRevenue: this.centsToYuan(
        netAmounts.reduce((sum, amount) => sum + amount, 0)
      ),
    };

    this.allTimeCache = { expiresAt: now + 5 * 60 * 1000, value };

    return value;
  }

  private async aggregateCohortOrderStats(
    userStart: Date,
    userEnd: Date,
    extraMatch: Record<string, unknown>
  ): Promise<CohortOrderStatsRow[]> {
    const sevenDaysMs = 7 * 86400000;
    const thirtyDaysMs = 30 * 86400000;

    return this.orderModel
      .aggregate<CohortOrderStatsRow>([
        {
          $match: {
            ...extraMatch,
            paidAt: { $type: 'date' },
          },
        },
        {
          $project: {
            userId: 1,
            occurredAt: '$paidAt',
            signedAmount: { $ifNull: ['$paidAmount', '$payableAmount'] },
          },
        },
        {
          $unionWith: {
            coll: TableName.order_refund,
            pipeline: [
              {
                $match: {
                  ...extraMatch,
                  status: OrderRefundStatus.completed,
                  requestedAt: { $type: 'date' },
                },
              },
              {
                $project: {
                  userId: 1,
                  occurredAt: '$requestedAt',
                  signedAmount: { $multiply: ['$amount', -1] },
                },
              },
            ],
          },
        },
        {
          $unionWith: {
            coll: TableName.order,
            pipeline: [
              {
                $match: {
                  ...extraMatch,
                  $or: [
                    { refundAmount: { $gt: 0 } },
                    { status: OrderStatus.refunded },
                  ],
                },
              },
              {
                $lookup: {
                  from: TableName.order_refund,
                  localField: '_id',
                  foreignField: 'originalOrderId',
                  as: 'independentRefundOrders',
                },
              },
              {
                $match: {
                  'independentRefundOrders.0': { $exists: false },
                },
              },
              {
                $project: {
                  userId: 1,
                  occurredAt: { $ifNull: ['$refundedAt', '$updatedAt'] },
                  signedAmount: {
                    $multiply: [
                      {
                        $cond: [
                          { $gt: [{ $ifNull: ['$refundAmount', 0] }, 0] },
                          '$refundAmount',
                          { $ifNull: ['$paidAmount', '$payableAmount'] },
                        ],
                      },
                      -1,
                    ],
                  },
                },
              },
            ],
          },
        },
        {
          $lookup: {
            from: TableName.user,
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $match: {
            'user.createdAt': { $gte: userStart, $lt: userEnd },
          },
        },
        {
          $project: {
            userId: 1,
            userCreatedAt: '$user.createdAt',
            month: {
              $dateToString: {
                format: '%Y-%m',
                date: '$user.createdAt',
                timezone: '+08:00',
              },
            },
            occurredAt: 1,
            netAmount: '$signedAmount',
          },
        },
        {
          $project: {
            userId: 1,
            month: 1,
            netAmount: 1,
            ageMs: { $subtract: ['$occurredAt', '$userCreatedAt'] },
          },
        },
        {
          $group: {
            _id: { month: '$month', userId: '$userId' },
            revenue: { $sum: '$netAmount' },
            revenue7Day: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$ageMs', 0] },
                      { $lte: ['$ageMs', sevenDaysMs] },
                    ],
                  },
                  '$netAmount',
                  0,
                ],
              },
            },
            revenue30Day: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$ageMs', 0] },
                      { $lte: ['$ageMs', thirtyDaysMs] },
                    ],
                  },
                  '$netAmount',
                  0,
                ],
              },
            },
          },
        },
        {
          $group: {
            _id: '$_id.month',
            payingUsers: {
              $sum: { $cond: [{ $gt: ['$revenue', 0] }, 1, 0] },
            },
            revenue: { $sum: '$revenue' },
            revenue7Day: { $sum: '$revenue7Day' },
            revenue30Day: { $sum: '$revenue30Day' },
          },
        },
      ])
      .toArray();
  }

  /** 按用户注册日聚合该日注册用户的累计净收入（所有历史订单，含退款冲抵） */
  private async aggregateCohortDailyRevenue(
    userStart: Date,
    userEnd: Date,
    extraMatch: Record<string, unknown>
  ): Promise<Array<{ _id: string; revenue: number }>> {
    return this.orderModel
      .aggregate<{ _id: string; revenue: number }>([
        {
          $match: {
            ...extraMatch,
            paidAt: { $type: 'date' },
          },
        },
        {
          $project: {
            userId: 1,
            signedAmount: { $ifNull: ['$paidAmount', '$payableAmount'] },
          },
        },
        {
          $unionWith: {
            coll: TableName.order_refund,
            pipeline: [
              {
                $match: {
                  ...extraMatch,
                  status: OrderRefundStatus.completed,
                },
              },
              {
                $project: {
                  userId: 1,
                  signedAmount: { $multiply: ['$amount', -1] },
                },
              },
            ],
          },
        },
        {
          $unionWith: {
            coll: TableName.order,
            pipeline: [
              {
                $match: {
                  ...extraMatch,
                  $or: [
                    { refundAmount: { $gt: 0 } },
                    { status: OrderStatus.refunded },
                  ],
                },
              },
              {
                $lookup: {
                  from: TableName.order_refund,
                  localField: '_id',
                  foreignField: 'originalOrderId',
                  as: 'independentRefundOrders',
                },
              },
              {
                $match: {
                  'independentRefundOrders.0': { $exists: false },
                },
              },
              {
                $project: {
                  userId: 1,
                  signedAmount: {
                    $multiply: [
                      {
                        $cond: [
                          { $gt: [{ $ifNull: ['$refundAmount', 0] }, 0] },
                          '$refundAmount',
                          { $ifNull: ['$paidAmount', '$payableAmount'] },
                        ],
                      },
                      -1,
                    ],
                  },
                },
              },
            ],
          },
        },
        {
          $lookup: {
            from: TableName.user,
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $match: {
            'user.createdAt': { $gte: userStart, $lt: userEnd },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$user.createdAt',
                timezone: '+08:00',
              },
            },
            revenue: { $sum: '$signedAmount' },
          },
        },
      ])
      .toArray();
  }

  private async aggregateFirstTimePayingUsers(
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown>
  ): Promise<number> {
    const rows = await this.orderModel
      .aggregate<{ count: number }>([
        { $match: { ...extraMatch, paidAt: { $type: 'date' } } },
        { $group: { _id: '$userId', firstPaidAt: { $min: '$paidAt' } } },
        { $match: { firstPaidAt: { $gte: start, $lt: end } } },
        { $count: 'count' },
      ])
      .toArray();

    return Number(rows[0]?.count) || 0;
  }

  private buildRealOrderMatch(): Record<string, unknown> {
    return {
      targetCode: { $ne: 'voice_one' },
      source: { $ne: 'admin' },
      paymentProvider: { $ne: 'admin_manual' },
    };
  }

  private buildLegacyRefundFlowMatch(
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      ...extraMatch,
      $or: [
        { refundedAt: { $gte: start, $lt: end } },
        {
          status: 'refunded',
          refundedAt: null,
          updatedAt: { $gte: start, $lt: end },
        },
        {
          status: 'completed',
          refundAmount: { $gt: 0 },
          refundedAt: null,
          updatedAt: { $gte: start, $lt: end },
        },
      ],
    };
  }

  private async aggregateLegacyDailyRefundAmounts(
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown>
  ): Promise<DailyAmountRow[]> {
    return this.orderModel
      .aggregate<DailyAmountRow>([
        {
          $match: this.buildLegacyRefundFlowMatch(start, end, extraMatch),
        },
        {
          $lookup: {
            from: TableName.order_refund,
            localField: '_id',
            foreignField: 'originalOrderId',
            as: 'independentRefundOrders',
          },
        },
        {
          $match: {
            'independentRefundOrders.0': { $exists: false },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: { $ifNull: ['$refundedAt', '$updatedAt'] },
                timezone: '+08:00',
              },
            },
            amount: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$refundAmount', 0] }, 0] },
                  '$refundAmount',
                  '$payableAmount',
                ],
              },
            },
          },
        },
      ])
      .toArray();
  }

  private async aggregateLegacyRefundAmountsByUser(
    extraMatch: Record<string, unknown>
  ): Promise<UserAmountRow[]> {
    return this.orderModel
      .aggregate<UserAmountRow>([
        {
          $match: {
            ...extraMatch,
            $or: [
              { refundAmount: { $gt: 0 } },
              { status: OrderStatus.refunded },
            ],
          },
        },
        {
          $lookup: {
            from: TableName.order_refund,
            localField: '_id',
            foreignField: 'originalOrderId',
            as: 'independentRefundOrders',
          },
        },
        {
          $match: {
            'independentRefundOrders.0': { $exists: false },
          },
        },
        {
          $group: {
            _id: '$userId',
            amount: {
              $sum: {
                $cond: [
                  { $gt: [{ $ifNull: ['$refundAmount', 0] }, 0] },
                  '$refundAmount',
                  { $ifNull: ['$paidAmount', '$payableAmount'] },
                ],
              },
            },
          },
        },
      ])
      .toArray();
  }

  private async aggregateDailyCount<T extends object>(
    repository: MongoRepository<T>,
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown> = {}
  ): Promise<DailyCountRow[]> {
    return repository
      .aggregate<DailyCountRow>([
        {
          $match: {
            ...extraMatch,
            createdAt: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: '+08:00',
              },
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();
  }

  private async aggregateHourlyCount<T extends object>(
    repository: MongoRepository<T>,
    start: Date,
    end: Date,
    extraMatch: Record<string, unknown> = {}
  ): Promise<HourlyCountRow[]> {
    return repository
      .aggregate<HourlyCountRow>([
        {
          $match: {
            ...extraMatch,
            createdAt: { $gte: start, $lt: end },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%H',
                date: '$createdAt',
                timezone: '+08:00',
              },
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();
  }

  private async aggregateDailyAmount<T extends object>(
    repository: MongoRepository<T>,
    match: Record<string, unknown>,
    dateExpression: string | Record<string, unknown>,
    amountExpression: string | Record<string, unknown>
  ): Promise<DailyAmountRow[]> {
    return repository
      .aggregate<DailyAmountRow>([
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: dateExpression,
                timezone: '+08:00',
              },
            },
            amount: { $sum: amountExpression },
          },
        },
      ])
      .toArray();
  }

  private countMap(rows: Array<DailyCountRow | HourlyCountRow>) {
    return new Map(rows.map(row => [row._id, Number(row.count) || 0]));
  }

  private mergeAmountMaps(...rowGroups: DailyAmountRow[][]) {
    const result = new Map<string, number>();

    for (const rows of rowGroups) {
      for (const row of rows) {
        result.set(
          row._id,
          (result.get(row._id) ?? 0) + (Number(row.amount) || 0)
        );
      }
    }

    return result;
  }

  private centsToYuan(value: number): number {
    return this.roundMoney(value / 100);
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private roundAverage(value: number, divisor: number): number {
    return divisor > 0 ? this.roundMoney(value / divisor) : 0;
  }

  private roundRate(value: number, divisor: number): number {
    return divisor > 0 ? Math.round((value / divisor) * 1000) / 10 : 0;
  }

  private getBeijingMonth(date: Date): string {
    const beijingDate = new Date(date.getTime() + BEIJING_OFFSET_MS);

    return `${beijingDate.getUTCFullYear()}-${String(
      beijingDate.getUTCMonth() + 1
    ).padStart(2, '0')}`;
  }

  private normalizeMonth(value: unknown, fallback: string): string {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? ''))
      ? String(value)
      : fallback;
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
