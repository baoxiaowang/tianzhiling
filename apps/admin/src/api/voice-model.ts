import axios from 'axios';
import type {
  AdminVoiceTimbreListDTO,
  AdminVoiceTimbreListParamsDTO,
  AdminDoubaoVoiceSlotListDTO,
  AdminVoiceTimbreProviderValidationDTO,
  AdminVoiceTimbreRecordDTO,
  BindAdminDoubaoVoiceSlotResultDTO,
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

export function bindDoubaoVoiceSlotAgent(timbreId: string, agentId: string) {
  return axios.post<BindAdminDoubaoVoiceSlotResultDTO>(
    `/admin_api/voice-timbres/doubao-slots/${timbreId}/bind-agent`,
    { agentId }
  );
}

export function createVoiceTimbre(data: CreateVoiceTimbreData) {
  return axios.post<VoiceTimbreRecord>('/admin_api/voice-timbres', data);
}

export interface MergeCreateVoiceTimbreData {
  /** 必填：音色归属用户 */
  userId: string;
  /** 必填：1~20 段已上传的音频 objectKey，服务端会合并为单个训练音频 */
  audioObjectKeys: string[];
  name: string;
  provider: VoiceTimbreRecord['provider'];
  cloneLanguage?: string;
  speechDialect?: string;
  speechInstruction?: string;
  providerVoiceId?: string;
  previewText?: string;
  previewModel?: string;
  speechSpeed?: number;
  speechVolume?: number;
  speechPitch?: number;
  remark?: string;
}

export function mergeCreateVoiceTimbre(data: MergeCreateVoiceTimbreData) {
  return axios.post<VoiceTimbreRecord>(
    '/admin_api/voice-timbres/merge-create',
    data
  );
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

export interface VoiceTimbreMaterialRecord {
  id: string;
  userId: string;
  name: string;
  objectKey: string;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

/** 列出某用户已保存的声音素材 */
export function queryVoiceMaterials(userId: string) {
  return axios.get<VoiceTimbreMaterialRecord[]>('/admin_api/voice-materials', {
    params: { userId },
  });
}

/** 保存一条声音素材（同一用户同一 objectKey 自动去重） */
export function createVoiceMaterial(data: {
  userId: string;
  name: string;
  objectKey: string;
  publicUrl?: string;
}) {
  return axios.post<VoiceTimbreMaterialRecord>(
    '/admin_api/voice-materials',
    data
  );
}

/** 删除一条已保存的声音素材记录 */
export function deleteVoiceMaterial(id: string) {
  return axios.delete<{ deleted: boolean }>(`/admin_api/voice-materials/${id}`);
}

export interface VoiceClipDTO {
  sourceMaterialId: string;
  sourceName: string;
  objectKey: string;
  publicUrl: string;
  durationSeconds: number;
  transcript?: string;
  qualityScore?: number;
  qualityLabel?: string;
  qualityIssues?: {
    code: string;
    severity: 'warning' | 'rejected';
    message?: string;
  }[];
}

/** 触发底层声音剪辑工作流，把素材剪成训练片段 */
export function clipVoiceMaterials(data: {
  userId: string;
  materials: {
    id?: string;
    name?: string;
    objectKey: string;
    publicUrl?: string;
    durationSeconds?: number;
  }[];
}) {
  return axios.post<{
    ok: boolean;
    clips: VoiceClipDTO[];
    errors?: unknown[];
    platformErrors?: unknown[];
  }>('/admin_api/voice-clipping', data);
}
