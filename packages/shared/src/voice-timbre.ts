export type VoiceTimbreProviderDTO = 'minimax' | 'qwen' | 'doubao';

export type VoiceTimbreStatusDTO =
  | 'creating'
  | 'active'
  | 'failed'
  | 'disabled';

export interface AdminVoiceTimbreRecordDTO {
  id: string;
  name: string;
  provider: VoiceTimbreProviderDTO;
  providerVoiceId: string;
  providerFileId?: string;
  audioObjectKey: string;
  audioUrl: string;
  cloneLanguage: string;
  previewText: string;
  previewModel: string;
  previewAudioUrl: string;
  status: VoiceTimbreStatusDTO;
  errorCode: string;
  errorMessage: string;
  remark: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVoiceTimbreListParamsDTO {
  keyword?: string;
  provider?: VoiceTimbreProviderDTO;
  status?: VoiceTimbreStatusDTO;
  page?: number;
  pageSize?: number;
}

export interface AdminVoiceTimbreListDTO {
  items: AdminVoiceTimbreRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateAdminVoiceTimbreDTO {
  name: string;
  provider: VoiceTimbreProviderDTO;
  audioObjectKey?: string;
  audioUrl?: string;
  cloneLanguage?: string;
  providerVoiceId?: string;
  previewText?: string;
  previewModel?: string;
  remark?: string;
}

export interface UpdateAdminVoiceTimbreDTO {
  name?: string;
  status?: Extract<VoiceTimbreStatusDTO, 'active' | 'disabled'>;
  previewText?: string;
  remark?: string;
}
