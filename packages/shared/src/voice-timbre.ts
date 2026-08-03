export type VoiceTimbreProviderDTO =
  | 'minimax'
  | 'cosyvoice'
  | 'qwen'
  | 'doubao';

export type VoiceTimbreStatusDTO =
  | 'creating'
  | 'active'
  | 'failed'
  | 'disabled';

export type VoiceTimbreRetentionStatusDTO =
  | 'protected'
  | 'due_soon'
  | 'attention_required';

export interface UserVoiceTimbreBindingDTO {
  agentId: string;
  agentName: string;
}

export interface UserVoiceTimbreRecordDTO {
  id: string;
  name: string;
  status: VoiceTimbreStatusDTO;
  previewAudioUrl?: string;
  targetModel?: string;
  createdAt: string;
  lastUsedAt?: string;
  estimatedProviderCleanupAt?: string;
  retentionStatus: VoiceTimbreRetentionStatusDTO;
  retentionMessage: string;
  bindings: UserVoiceTimbreBindingDTO[];
  pendingBindings?: UserVoiceTimbreBindingDTO[];
  speechSpeed: number;
  speechVolume: number;
  deletionStatus?: 'pending' | 'completed' | 'partial_failed';
}

export interface UserVoiceTimbreTrainingClipDTO {
  id: string;
  name: string;
  sourceName?: string;
  audioUrl: string;
  durationSeconds?: number;
  transcript?: string;
  qualityLabel?: string;
}

export interface UserVoiceTimbreGeneratedAudioDTO {
  id: string;
  text: string;
  audioUrl: string;
  speechSpeed: number;
  speechVolume: number;
  createdAt: string;
  remainingToday?: number;
}

export interface UserVoiceTimbreDetailDTO extends UserVoiceTimbreRecordDTO {
  providerName: string;
  voiceAccessEligible: boolean;
  trainingAudioUrl?: string;
  trainingClips: UserVoiceTimbreTrainingClipDTO[];
  generatedAudios: UserVoiceTimbreGeneratedAudioDTO[];
  customSpeechTextMaxLength: number;
  customSpeechDailyLimit: number;
  customSpeechGeneratedToday: number;
  customSpeechRemainingToday: number;
}

export interface VoiceTimbreRetentionPolicyDTO {
  providerName: string;
  inactiveCleanupDays: number;
  providerVoiceLimit: number;
  providerVoiceLimitScope: 'platform_account';
  automaticRetentionEnabled: boolean;
  automaticRetentionBeforeDays: number;
  summary: string;
  deletionNotice: string;
  officialRuleUrl: string;
  verifiedAt: string;
}

export interface UserVoiceTimbreLibraryDTO {
  items: UserVoiceTimbreRecordDTO[];
  retentionPolicy: VoiceTimbreRetentionPolicyDTO;
}

export type AgentVoiceModelSelectionStatusDTO =
  | 'not_selected'
  | 'pending_membership'
  | 'active';

export interface AgentVoiceModelCenterDTO {
  agentId: string;
  agentName: string;
  items: UserVoiceTimbreRecordDTO[];
  selectedTimbreId?: string;
  activeTimbreId?: string;
  voiceAccessEligible: boolean;
  selectionStatus: AgentVoiceModelSelectionStatusDTO;
}

export interface SelectAgentVoiceTimbreDTO {
  timbreId: string;
  replaceExisting?: boolean;
}

export interface UpdateUserVoiceTimbreDTO {
  name?: string;
  speechSpeed?: number;
  speechVolume?: number;
}

export interface GenerateUserVoiceTimbreSpeechDTO {
  text: string;
}

export interface DeleteUserVoiceTimbreResultDTO {
  id: string;
  deletionStatus: 'completed' | 'partial_failed';
  message: string;
}

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
  speechSpeed: number;
  speechVolume: number;
  speechPitch: number;
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
  all?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AdminVoiceTimbreListDTO {
  items: AdminVoiceTimbreRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminVoiceTimbreProviderValidationDTO {
  provider: VoiceTimbreProviderDTO;
  providerVoiceId: string;
  providerStatus: string;
  targetModel?: string;
  resourceLink?: string;
  requestId?: string;
  record: AdminVoiceTimbreRecordDTO;
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
  speechSpeed?: number;
  speechVolume?: number;
  speechPitch?: number;
  remark?: string;
}

export interface UpdateAdminVoiceTimbreDTO {
  name?: string;
  status?: Extract<VoiceTimbreStatusDTO, 'active' | 'disabled'>;
  previewText?: string;
  speechSpeed?: number;
  speechVolume?: number;
  speechPitch?: number;
  remark?: string;
}
