import axios from 'axios';
import type {
  AdminVoicePackageListDTO,
  AdminVoicePackageListParamsDTO,
  AdminVoicePackageRecordDTO,
  AdminVoiceTrainingTaskListDTO,
  AdminVoiceTrainingTaskListParamsDTO,
  AdminVoiceTrainingTaskRecordDTO,
  CompleteAdminVoiceTrainingTaskDTO,
  SaveAdminVoicePackageDTO,
  UpdateAdminVoiceTrainingTaskDTO,
} from '@tzl/shared';

export type VoicePackageRecord = AdminVoicePackageRecordDTO;
export type VoicePackageListParams = AdminVoicePackageListParamsDTO;
export type VoicePackageListRes = AdminVoicePackageListDTO;
export type SaveVoicePackageData = SaveAdminVoicePackageDTO;
export type VoiceTrainingTaskRecord = AdminVoiceTrainingTaskRecordDTO;
export type VoiceTrainingTaskListParams = AdminVoiceTrainingTaskListParamsDTO;
export type VoiceTrainingTaskListRes = AdminVoiceTrainingTaskListDTO;
export type UpdateVoiceTrainingTaskData = UpdateAdminVoiceTrainingTaskDTO;
export type CompleteVoiceTrainingTaskData = CompleteAdminVoiceTrainingTaskDTO;

export function queryVoicePackageList(params: VoicePackageListParams) {
  return axios.get<VoicePackageListRes>('/admin_api/voice-packages', {
    params,
  });
}

export function createVoicePackage(data: SaveVoicePackageData) {
  return axios.post<VoicePackageRecord>('/admin_api/voice-packages', data);
}

export function updateVoicePackage(id: string, data: SaveVoicePackageData) {
  return axios.put<VoicePackageRecord>(`/admin_api/voice-packages/${id}`, data);
}

export function queryVoiceTrainingTaskList(
  params: VoiceTrainingTaskListParams
) {
  return axios.get<VoiceTrainingTaskListRes>(
    '/admin_api/voice-training-tasks',
    { params }
  );
}

export function updateVoiceTrainingTask(
  id: string,
  data: UpdateVoiceTrainingTaskData
) {
  return axios.put<VoiceTrainingTaskRecord>(
    `/admin_api/voice-training-tasks/${id}`,
    data
  );
}

export function completeVoiceTrainingTask(
  id: string,
  data: CompleteVoiceTrainingTaskData
) {
  return axios.post<VoiceTrainingTaskRecord>(
    `/admin_api/voice-training-tasks/${id}/complete`,
    data
  );
}
