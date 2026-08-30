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
