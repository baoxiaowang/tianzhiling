import axios from 'axios';
import type {
  AdminVoiceTimbreListDTO,
  AdminVoiceTimbreListParamsDTO,
  AdminVoiceTimbreRecordDTO,
  CreateAdminVoiceTimbreDTO,
  UpdateAdminVoiceTimbreDTO,
} from '@tzl/shared';

export type VoiceTimbreRecord = AdminVoiceTimbreRecordDTO;
export type VoiceTimbreListParams = AdminVoiceTimbreListParamsDTO;
export type VoiceTimbreListRes = AdminVoiceTimbreListDTO;
export type CreateVoiceTimbreData = CreateAdminVoiceTimbreDTO;
export type UpdateVoiceTimbreData = UpdateAdminVoiceTimbreDTO;

export function queryVoiceTimbreList(params: VoiceTimbreListParams) {
  return axios.get<VoiceTimbreListRes>('/admin_api/voice-timbres', { params });
}

export function createVoiceTimbre(data: CreateVoiceTimbreData) {
  return axios.post<VoiceTimbreRecord>('/admin_api/voice-timbres', data);
}

export function updateVoiceTimbre(id: string, data: UpdateVoiceTimbreData) {
  return axios.put<VoiceTimbreRecord>(`/admin_api/voice-timbres/${id}`, data);
}
