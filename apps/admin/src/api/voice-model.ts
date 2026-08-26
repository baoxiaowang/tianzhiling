import axios from 'axios';
import type {
  AdminVoiceTimbreListDTO,
  AdminVoiceTimbreListParamsDTO,
  AdminDoubaoVoiceSlotListDTO,
  AdminVoiceTimbreProviderValidationDTO,
  AdminVoiceTimbreRecordDTO,
  CreateAdminVoiceTimbreDTO,
  DeleteAdminVoiceTimbreResultDTO,
  UpdateAdminVoiceTimbreDTO,
} from '@tzl/shared';

export type VoiceTimbreRecord = AdminVoiceTimbreRecordDTO;
export type VoiceTimbreListParams = AdminVoiceTimbreListParamsDTO;
export type VoiceTimbreListRes = AdminVoiceTimbreListDTO;
export type CreateVoiceTimbreData = CreateAdminVoiceTimbreDTO;
export type UpdateVoiceTimbreData = UpdateAdminVoiceTimbreDTO;
export type ValidateVoiceTimbreRes = AdminVoiceTimbreProviderValidationDTO;

export function queryVoiceTimbreList(params: VoiceTimbreListParams) {
  return axios.get<VoiceTimbreListRes>('/admin_api/voice-timbres', { params });
}

export function queryDoubaoVoiceSlots() {
  return axios.get<AdminDoubaoVoiceSlotListDTO>(
    '/admin_api/voice-timbres/doubao-slots'
  );
}

export function createVoiceTimbre(data: CreateVoiceTimbreData) {
  return axios.post<VoiceTimbreRecord>('/admin_api/voice-timbres', data);
}

export function updateVoiceTimbre(id: string, data: UpdateVoiceTimbreData) {
  return axios.put<VoiceTimbreRecord>(`/admin_api/voice-timbres/${id}`, data);
}

export function deleteVoiceTimbre(id: string) {
  return axios.delete<DeleteAdminVoiceTimbreResultDTO>(
    `/admin_api/voice-timbres/${id}`
  );
}

export function retryVoiceTimbre(id: string) {
  return axios.post<VoiceTimbreRecord>(`/admin_api/voice-timbres/${id}/retry`);
}

export function validateVoiceTimbre(id: string) {
  return axios.post<ValidateVoiceTimbreRes>(
    `/admin_api/voice-timbres/${id}/validate`
  );
}
