import axios from 'axios';
import type {
  AdminChatQualityDTO,
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

export function queryOperationsReport(month?: string) {
  return axios.get<AdminOperationsReportDTO>('/admin_api/operations/reports', {
    params: { month },
  });
}

export function queryUserValueReport(endMonth?: string, months = 6) {
  return axios.get<AdminUserValueReportDTO>(
    '/admin_api/operations/user-value',
    { params: { endMonth, months } }
  );
}

export function queryOrderAnalytics(month?: string) {
  return axios.get<AdminOrderAnalyticsDTO>(
    '/admin_api/operations/order-analytics',
    { params: { month } }
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
