import axios from 'axios';
import type {
  AdminChatQualityDTO,
  AdminMonthlyOrderReportDTO,
  AdminMonthlySummaryDTO,
  AdminMonthlySummaryRange,
  AdminOperationsDailyPointDTO,
  AdminOperationsOverviewDTO,
  AdminOperationsReportDTO,
  AdminOperationsTaskListDTO,
  AdminOrderAnalyticsDTO,
  AdminSystemRuntimeDTO,
  AdminUserValueReportDTO,
  UpdateAdminChatFeedbackRequestDTO,
} from '@tzl/shared';

export interface OperationsTaskListParams {
  page?: number;
  pageSize?: number;
  status?: string;
}

export function queryOperationsOverview() {
  return axios.get<AdminOperationsOverviewDTO>(
    '/admin_api/operations/overview'
  );
}

export function queryChatQuality() {
  return axios.get<AdminChatQualityDTO>('/admin_api/operations/chat-quality');
}

export function updateChatFeedback(
  id: string,
  data: UpdateAdminChatFeedbackRequestDTO
) {
  return axios.put(`/admin_api/operations/feedback/${id}`, data);
}

export function queryOperationsReport(
  month?: string,
  options?: { refresh?: boolean }
) {
  return axios.get<AdminOperationsReportDTO>('/admin_api/operations/reports', {
    params: { month, refresh: options?.refresh ? 1 : undefined },
  });
}

export function updateDailyPromotionExpense(
  date: string,
  promotionExpense: number | null
) {
  return axios.put<AdminOperationsDailyPointDTO>(
    `/admin_api/operations/reports/daily/${date}/promotion-expense`,
    { promotionExpense }
  );
}

export function queryUserValueReport(endMonth?: string, months = 6) {
  return axios.get<AdminUserValueReportDTO>(
    '/admin_api/operations/user-value',
    { params: { endMonth, months } }
  );
}

export function queryMonthlySummary(range: AdminMonthlySummaryRange) {
  return axios.get<AdminMonthlySummaryDTO>(
    '/admin_api/operations/monthly-summary',
    { params: { range } }
  );
}

/** 每日明细页的响应：每日行 + 当日运营笔记（date -> 文本）。 */
export interface DailyDetailDTO {
  month: string;
  daily: AdminOperationsDailyPointDTO[];
  notes: Record<string, string>;
}

/**
 * 每日明细页专用：只取所选月份的每日行与运营笔记。
 * 比 queryOperationsReport 轻很多——后者还要算累计口径（扫全表消息）。
 */
export function queryDailyDetail(
  month?: string,
  options?: { refresh?: boolean }
) {
  return axios.get<DailyDetailDTO>('/admin_api/operations/daily-detail', {
    params: { month, refresh: options?.refresh ? 1 : undefined },
  });
}

export function updateDailyNote(date: string, note: string) {
  return axios.put<{ date: string; note: string }>(
    `/admin_api/operations/reports/daily/${date}/note`,
    { note }
  );
}

export function queryOrderAnalytics(month?: string) {
  return axios.get<AdminOrderAnalyticsDTO>(
    '/admin_api/operations/order-analytics',
    { params: { month } }
  );
}

export function refreshOrderAnalytics(month: string) {
  return axios.put<AdminOrderAnalyticsDTO>(
    `/admin_api/operations/order-analytics/${month}/refresh`
  );
}

export function queryMonthlyOrderReport(month?: string) {
  return axios.get<AdminMonthlyOrderReportDTO>(
    '/admin_api/operations/monthly-order-report',
    { params: { month } }
  );
}

export function refreshMonthlyOrderReport(month: string) {
  return axios.put<AdminMonthlyOrderReportDTO>(
    `/admin_api/operations/monthly-order-report/${month}/refresh`
  );
}

export function queryOperationsTasks(params: OperationsTaskListParams) {
  return axios.get<AdminOperationsTaskListDTO>('/admin_api/operations/tasks', {
    params,
  });
}

export function querySystemRuntime() {
  return axios.get<AdminSystemRuntimeDTO>(
    '/admin_api/operations/system-runtime'
  );
}
