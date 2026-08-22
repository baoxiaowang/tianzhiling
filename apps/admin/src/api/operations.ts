import axios from 'axios';
import type {
  AdminChatQualityDTO,
  AdminOperationsOverviewDTO,
  AdminOperationsTaskListDTO,
  AdminSystemRuntimeDTO,
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
