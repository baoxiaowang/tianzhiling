export interface AdminOperationsMetricDTO {
  key: string;
  label: string;
  value: number;
  tone: "default" | "success" | "warning" | "danger";
  hint: string;
}

export interface AdminOperationsAlertDTO {
  id: string;
  category: "feedback" | "chat" | "import" | "content";
  title: string;
  description: string;
  occurredAt: string;
  targetType?: "user" | "agent" | "post";
  targetId?: string;
}

export interface AdminOperationsOverviewDTO {
  generatedAt: string;
  metrics: AdminOperationsMetricDTO[];
  alerts: AdminOperationsAlertDTO[];
}

export interface AdminChatFeedbackItemDTO {
  id: string;
  type: string;
  content: string;
  assistantContent: string;
  userId: string;
  userName: string;
  agentId: string;
  agentName: string;
  conversationId: string;
  messageId: string;
  handlingStatus: AdminChatFeedbackHandlingStatus;
  handlingNote: string;
  handledBy: string;
  handledAt: string;
  createdAt: string;
}

export type AdminChatFeedbackHandlingStatus =
  | "pending"
  | "processing"
  | "resolved"
  | "ignored";

export interface UpdateAdminChatFeedbackRequestDTO {
  status: AdminChatFeedbackHandlingStatus;
  note?: string;
}

export interface AdminFailedChatTraceItemDTO {
  id: string;
  traceId: string;
  conversationId: string;
  userId: string;
  agentId: string;
  status: string;
  failureStage: string;
  errorCode: string;
  visibleLatencyMs?: number;
  totalLatencyMs?: number;
  totalTokens: number;
  releaseVersion: string;
  updatedAt: string;
}

export interface AdminChatQualityDTO {
  generatedAt: string;
  feedbackLast7Days: number;
  failedChatsLast24Hours: number;
  feedback: AdminChatFeedbackItemDTO[];
  failedTraces: AdminFailedChatTraceItemDTO[];
}

export interface AdminOperationsDailyPointDTO {
  date: string;
  newUsers: number;
  newAgents: number;
  newUserChatUsers: number;
  newUserMessages: number;
  newUserFiveMessageUsers: number;
  allChatUsers: number;
  userMessages: number;
  paidUsers: number;
  paidOrders: number;
  sameDayPayingUsers: number;
  paidRevenue: number;
  refundedRevenue: number;
  netRevenue: number;
  cohortRevenue: number;
  promotionExpense?: number;
  profit?: number;
  /** 推广费是否为管理员手动录入（true 时存在覆盖值） */
  promotionExpenseManual?: boolean;
}

/**
 * 「累计收入」口径下的单条明细。
 *
 * 累计收入按用户注册日归集、且不限支付日期，因此同一注册日的明细会包含
 * 该注册日用户之后产生的订单与退款。
 */
export interface AdminDailyCohortOrderItemDTO {
  /** 事件时间：订单取支付时间，退款取退款完成时间（ISO 字符串） */
  occurredAt: string;
  /** 金额（元）；退款为负数 */
  amount: number;
  /** order = 订单支付；refund = 退款 */
  kind: "order" | "refund";
  /** 订单号或退款单号，便于与订单页核对 */
  reference: string;
  /** 套餐 / 语音包 code */
  targetCode: string;
}

/**
 * 「净收入」口径下的单条明细（按事件发生日归集）。
 *
 * 与累计收入明细不同：这里每一条是**当天实际发生**的支付/退款，
 * 因此同时给出下单用户的注册日期，便于区分当天收入里新客与老用户的贡献。
 */
export interface AdminDailyNetOrderItemDTO {
  /** 事件时间：订单取支付时间，退款取退款完成时间（ISO 字符串） */
  occurredAt: string;
  /** 下单用户的注册日期（北京时区 `YYYY-MM-DD`）；用户缺失时为空串 */
  registeredAt: string;
  /** 金额（元）；退款为负数 */
  amount: number;
  /** order = 订单支付；refund = 退款 */
  kind: "order" | "refund";
  /** 订单号或退款单号 */
  reference: string;
  /** 套餐 / 语音包 code */
  targetCode: string;
}

export interface AdminDailyNetOrdersDTO {
  date: string;
  /** 与每日明细「净收入」完全一致的净额（元） */
  total: number;
  /** 按用户注册日期倒序、同日再按事件时间倒序，最多返回 MAX 条 */
  items: AdminDailyNetOrderItemDTO[];
  /** 明细超过上限被截断（total 仍为全量净额） */
  truncated: boolean;
}

export interface AdminDailyCohortOrdersDTO {
  date: string;
  /** 与每日明细「累计收入」完全一致的净额（元） */
  total: number;
  /** 按时间倒序的明细，最多返回 MAX 条 */
  items: AdminDailyCohortOrderItemDTO[];
  /** 明细超过上限被截断（total 仍为全量净额） */
  truncated: boolean;
}

export interface UpdateAdminDailyPromotionExpenseRequestDTO {
  /** 手动推广费（元）；传 null 表示恢复为抖评记录默认值 */
  promotionExpense: number | null;
}

export interface AdminOperationsHourlyPointDTO {
  hour: string;
  newUsers: number;
  userMessages: number;
}

export interface AdminOperationsReportDTO {
  generatedAt: string;
  timezone: "Asia/Shanghai";
  month: string;
  today: string;
  totals: {
    newUsers: number;
    newAgents: number;
    newUserChatUsers: number;
    newUserMessages: number;
    allChatUsers: number;
    userMessages: number;
    paidUsers: number;
    paidOrders: number;
    paidRevenue: number;
    refundedRevenue: number;
    netRevenue: number;
  };
  todayTotals: {
    newUsers: number;
    newAgents: number;
    newUserChatUsers: number;
    newUserMessages: number;
    newUserFiveMessageUsers: number;
    allChatUsers: number;
    userMessages: number;
    paidUsers: number;
    paidOrders: number;
    sameDayPayingUsers: number;
    netRevenue: number;
  };
  allTime: {
    users: number;
    agents: number;
    chatUsers: number;
    userMessages: number;
    payingUsers: number;
    netRevenue: number;
  };
  daily: AdminOperationsDailyPointDTO[];
  hourly: AdminOperationsHourlyPointDTO[];
}

/** 仪表盘月度统计的区间：近 6 / 12 / 24 个月，或开站至今全部月份。 */
export type AdminMonthlySummaryRange = 6 | 12 | 24 | "all";

export interface AdminMonthlySummaryPointDTO {
  /** 北京时间月份，格式 YYYY-MM */
  month: string;
  newUsers: number;
  userMessages: number;
  /** 当月实付收入（元） */
  paidRevenue: number;
  /** 当月退款金额（元） */
  refundedRevenue: number;
  /** 当月净收入（元）= paidRevenue - refundedRevenue */
  netRevenue: number;
  /** 是否为当前自然月（数据不完整，读取时需注意） */
  isCurrentMonth: boolean;
}

export interface AdminMonthlySummaryDTO {
  generatedAt: string;
  timezone: "Asia/Shanghai";
  range: AdminMonthlySummaryRange;
  /** 按月份升序（最早的在前） */
  items: AdminMonthlySummaryPointDTO[];
}

export interface AdminUserValueCohortPointDTO {
  month: string;
  observedDays: number;
  newUsers: number;
  payingUsers: number;
  payRate: number;
  revenue: number;
  userValue: number;
  value7Day?: number;
  value30Day?: number;
  is7DayMature: boolean;
  is30DayMature: boolean;
}

export interface AdminUserValueReportDTO {
  generatedAt: string;
  timezone: "Asia/Shanghai";
  endMonth: string;
  months: number;
  items: AdminUserValueCohortPointDTO[];
}

export interface AdminOrderAnalyticsDailyPointDTO {
  date: string;
  paidUsers: number;
  paidOrders: number;
  paidRevenue: number;
  refundedRevenue: number;
  netRevenue: number;
}

export interface AdminOrderAnalyticsDistributionItemDTO {
  label: string;
  count: number;
  percentage: number;
}

export interface AdminOrderAnalyticsDTO {
  generatedAt: string;
  timezone: "Asia/Shanghai";
  month: string;
  totals: {
    createdOrders: number;
    paidOrders: number;
    payingUsers: number;
    firstTimePayingUsers: number;
    paidRevenue: number;
    refundedRevenue: number;
    netRevenue: number;
    averageOrderAmount: number;
    paymentSuccessRate: number;
    refundRate: number;
  };
  daily: AdminOrderAnalyticsDailyPointDTO[];
  productDistribution: AdminOrderAnalyticsDistributionItemDTO[];
  relationshipDistribution: AdminOrderAnalyticsDistributionItemDTO[];
  statusDistribution: AdminOrderAnalyticsDistributionItemDTO[];
  snapshot: {
    persisted: boolean;
    calculationVersion: number;
    updatedAt: string;
  };
}

export interface AdminMonthlyOrderRecordDTO {
  id: string;
  orderNo: string;
  orderedAt: string;
  productName: string;
  amount: number;
  agentNames: string;
  userName: string;
  relationship: string;
  relationshipSource: string;
  interactionCount: number;
  agentCreatedAt: string;
  /** 用户账号注册时间（北京时间 ISO）；旧快照可能缺失 */
  userCreatedAt?: string;
  paymentCycleDays: number;
  status: string;
  statusLabel: string;
  abnormalTypes: string[];
  abnormalReason: string;
  paymentProvider: string;
  source: string;
}

export interface AdminMonthlyRefundRecordDTO {
  id: string;
  refundNo: string;
  originalOrderNo: string;
  occurredAt: string;
  refundType: string;
  refundTypeLabel: string;
  amount: number;
  userName: string;
  productName: string;
  paymentProvider: string;
  source: string;
  status: string;
}

export interface AdminMonthlyOrderReportDTO {
  month: string;
  timezone: "Asia/Shanghai";
  generatedAt: string;
  snapshot: {
    persisted: boolean;
    calculationVersion: number;
    updatedAt: string;
  };
  totals: {
    allOrders: number;
    validOrders: number;
    abnormalOrders: number;
    validAmount: number;
    /** order_refund 集合里的已完成退款笔数（不含历史遗留退款） */
    completedRefunds: number;
    /** order_refund 集合里的已完成退款金额（元，不含历史遗留退款） */
    refundedAmount: number;
    /**
     * 历史遗留退款金额（元）：订单自身带 refundAmount 且没有独立退款单，
     * 出现在净值公式里但不在 refundOrders 明细里，单独列出以便勾稽。
     */
    legacyRefundedAmount: number;
    /** 历史遗留退款笔数 */
    legacyRefundCount: number;
    /**
     * 月度净额（元）= 当月实付金额 − refundedAmount − legacyRefundedAmount。
     * 可用这三个字段与本字段互相验证。
     */
    netAmount: number;
  };
  validOrders: AdminMonthlyOrderRecordDTO[];
  abnormalOrders: AdminMonthlyOrderRecordDTO[];
  refundOrders: AdminMonthlyRefundRecordDTO[];
  statusDistribution: AdminOrderAnalyticsDistributionItemDTO[];
  productDistribution: AdminOrderAnalyticsDistributionItemDTO[];
  relationshipDistribution: AdminOrderAnalyticsDistributionItemDTO[];
  abnormalTypeDistribution: AdminOrderAnalyticsDistributionItemDTO[];
  refundTypeDistribution: AdminOrderAnalyticsDistributionItemDTO[];
}

export interface AdminOperationsTaskDTO {
  id: string;
  type: "chat_import";
  title: string;
  status: string;
  userId: string;
  agentId: string;
  conversationId: string;
  progressCurrent: number;
  progressTotal: number;
  duplicateCount: number;
  retryCount: number;
  errorCode: string;
  errorDetail: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
}

export interface AdminOperationsTaskListDTO {
  generatedAt: string;
  items: AdminOperationsTaskDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminSystemRuntimeDTO {
  generatedAt: string;
  service: string;
  status: "ok";
  releaseVersion: string;
  nodeEnv: string;
  uptimeSeconds: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  queues: {
    activeChatImports: number;
    failedChatImports: number;
    runningChatTraces: number;
    failedChatTraces: number;
  };
}
