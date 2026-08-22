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
  createdAt: string;
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
