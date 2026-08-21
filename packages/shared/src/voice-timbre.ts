export type VoiceTimbreProviderDTO =
  | "minimax"
  | "cosyvoice"
  | "qwen"
  | "doubao";

export type VoiceTimbreStatusDTO =
  | "creating"
  | "active"
  | "failed"
  | "disabled";

export const VOICE_TIMBRE_DIALECT_OPTIONS = [
  { value: "auto", label: "自动（跟随文本）" },
  { value: "mandarin", label: "普通话" },
  { value: "cantonese", label: "广东话" },
  { value: "chongqing", label: "重庆话" },
  { value: "northeastern", label: "东北话" },
  { value: "gansu", label: "甘肃话" },
  { value: "guizhou", label: "贵州话" },
  { value: "zhejiang", label: "浙江话" },
  { value: "hebei", label: "河北话" },
  { value: "henan", label: "河南话" },
  { value: "hubei", label: "湖北话" },
  { value: "hunan", label: "湖南话" },
  { value: "jiangxi", label: "江西话" },
  { value: "ningbo", label: "宁波话" },
  { value: "ningxia", label: "宁夏话" },
  { value: "qingdao", label: "青岛话" },
  { value: "shaanxi", label: "陕西话" },
  { value: "shanxi", label: "山西话" },
  { value: "shandong", label: "山东话" },
  { value: "shanghai", label: "上海话" },
  { value: "sichuan", label: "四川话" },
  { value: "yunnan", label: "云南话" },
] as const;

export type VoiceTimbreDialectDTO =
  (typeof VOICE_TIMBRE_DIALECT_OPTIONS)[number]["value"];

export function getVoiceTimbreDialectLabel(
  dialect?: string
): string | undefined {
  if (!dialect || dialect === "auto") {
    return undefined;
  }

  return VOICE_TIMBRE_DIALECT_OPTIONS.find((item) => item.value === dialect)
    ?.label;
}

export function buildQwenAudioSpeechInstruction(input: {
  instruction?: string;
  dialect?: string;
  speechSpeed?: number;
}): string | undefined {
  const parts: string[] = [];
  const customInstruction = input.instruction?.trim();
  const normalizedCustomInstruction = customInstruction?.replace(
    /[。；;]+$/g,
    ""
  );
  const dialectLabel = normalizedCustomInstruction
    ? undefined
    : getVoiceTimbreDialectLabel(input.dialect);

  if (normalizedCustomInstruction) {
    parts.push(normalizedCustomInstruction);
  }

  if (dialectLabel) {
    parts.push(`使用自然、地道的${dialectLabel}表达，保持原有音色`);
  }

  const parsedSpeed = Number(input.speechSpeed);
  if (Number.isFinite(parsedSpeed)) {
    const normalizedSpeed = Math.min(2, Math.max(0.5, parsedSpeed));

    if (Math.abs(normalizedSpeed - 1) >= 0.01) {
      parts.push(
        `语速约为正常语速的${Math.round(normalizedSpeed * 100)}%，保持自然流畅`
      );
    }
  }

  return parts.length ? `${parts.join("；")}。` : undefined;
}

export function buildSpeechOutputFfmpegFilter(input: {
  speechSpeed: number;
  speechVolume: number;
  speechPitch?: number;
  sampleRate?: number;
}): string {
  const filters: string[] = [];
  const pitch = Number(input.speechPitch) || 0;

  if (Math.abs(pitch) >= 0.01) {
    const sampleRate = Number(input.sampleRate) || 24000;
    const pitchRatio = 2 ** (pitch / 12);
    filters.push(
      `asetrate=${sampleRate}*${pitchRatio.toFixed(6)}`,
      `aresample=${sampleRate}`,
      `atempo=${(1 / pitchRatio).toFixed(6)}`
    );
  }

  filters.push(
    `atempo=${input.speechSpeed.toFixed(2)}`,
    `volume=${input.speechVolume.toFixed(2)}`
  );

  return filters.join(",");
}

export type VoiceTimbreRetentionStatusDTO =
  | "protected"
  | "due_soon"
  | "attention_required";

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
  speechDialect: VoiceTimbreDialectDTO;
  deletionStatus?: "pending" | "completed" | "partial_failed";
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
  providerVoiceLimitScope: "platform_account";
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
  | "not_selected"
  | "pending_membership"
  | "active";

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
  speechDialect?: VoiceTimbreDialectDTO;
}

export interface GenerateUserVoiceTimbreSpeechDTO {
  text: string;
}

export interface DeleteUserVoiceTimbreResultDTO {
  id: string;
  deletionStatus: "completed" | "partial_failed";
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
  speechDialect: VoiceTimbreDialectDTO;
  speechInstruction: string;
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
  speechDialect?: VoiceTimbreDialectDTO;
  speechInstruction?: string;
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
  status?: Extract<VoiceTimbreStatusDTO, "active" | "disabled">;
  previewText?: string;
  speechDialect?: VoiceTimbreDialectDTO;
  speechInstruction?: string;
  speechSpeed?: number;
  speechVolume?: number;
  speechPitch?: number;
  remark?: string;
}
