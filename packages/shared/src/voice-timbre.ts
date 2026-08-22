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

export const QWEN_AUDIO_DIALECT_OPTIONS = [
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

export const COSYVOICE_V35_DIALECT_OPTIONS = [
  { value: "auto", label: "自动（跟随文本）" },
  { value: "mandarin", label: "普通话" },
  { value: "cantonese", label: "广东话" },
  { value: "northeastern", label: "东北话" },
  { value: "gansu", label: "甘肃话" },
  { value: "guizhou", label: "贵州话" },
  { value: "henan", label: "河南话" },
  { value: "hubei", label: "湖北话" },
  { value: "jiangxi", label: "江西话" },
  { value: "minnan", label: "闽南话" },
  { value: "ningxia", label: "宁夏话" },
  { value: "shanxi", label: "山西话" },
  { value: "shaanxi", label: "陕西话" },
  { value: "shandong", label: "山东话" },
  { value: "shanghai", label: "上海话" },
  { value: "sichuan", label: "四川话" },
  { value: "tianjin", label: "天津话" },
  { value: "yunnan", label: "云南话" },
] as const;

export const VOICE_TIMBRE_DIALECT_OPTIONS = [
  ...QWEN_AUDIO_DIALECT_OPTIONS,
  { value: "minnan", label: "闽南话" },
  { value: "tianjin", label: "天津话" },
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

export function resolveVoiceTimbreDialect(
  dialect?: string,
  instruction?: string,
  options: ReadonlyArray<{
    value: string;
    label: string;
  }> = VOICE_TIMBRE_DIALECT_OPTIONS
): VoiceTimbreDialectDTO {
  const normalizedDialect = dialect?.trim().toLowerCase();
  const explicitDialect = options.find(
    (item) => item.value === normalizedDialect
  )?.value as VoiceTimbreDialectDTO | undefined;

  if (explicitDialect && explicitDialect !== "auto") {
    return explicitDialect;
  }

  const normalizedInstruction = instruction?.trim().toLowerCase() || "";
  if (!normalizedInstruction) {
    return "auto";
  }

  const dialectCandidates = options
    .filter((item) => item.value !== "auto")
    .map((item) => ({
      ...item,
      keyword: item.label.replace(/话$/, ""),
    }))
    .sort((left, right) => right.keyword.length - left.keyword.length);
  const inferredDialect =
    dialectCandidates.find(
      (item) =>
        item.value !== "mandarin" &&
        normalizedInstruction.includes(item.keyword)
    ) ||
    dialectCandidates.find(
      (item) =>
        item.value === "mandarin" &&
        normalizedInstruction.includes(item.keyword) &&
        !/(不要|别|禁止|避免).{0,6}普通话/.test(normalizedInstruction)
    );

  return (inferredDialect?.value as VoiceTimbreDialectDTO) || "auto";
}

export type VoiceSpeechInstructionSource =
  | "none"
  | "custom"
  | "structured"
  | "custom+structured";

export type QwenAudioSpeechInstructionSource = VoiceSpeechInstructionSource;

const VOICE_SPEECH_INSTRUCTION_WEIGHTED_LIMIT = 100;

export function getVoiceSpeechInstructionWeightedLength(value: string): number {
  return Array.from(value).reduce(
    (total, character) => total + (/\p{Script=Han}/u.test(character) ? 2 : 1),
    0
  );
}

function truncateVoiceSpeechInstruction(
  value: string,
  weightedLimit: number
): string {
  let result = "";
  let weightedLength = 0;

  for (const character of Array.from(value)) {
    const characterWeight = /\p{Script=Han}/u.test(character) ? 2 : 1;
    if (weightedLength + characterWeight > weightedLimit) {
      break;
    }
    result += character;
    weightedLength += characterWeight;
  }

  return result.replace(/[，,、；;。\s]+$/g, "");
}

function joinVoiceSpeechInstruction(parts: string[]): string | undefined {
  const normalizedParts = parts.map((part) => part.trim()).filter(Boolean);
  if (!normalizedParts.length) {
    return undefined;
  }

  const suffix = "。";
  const suffixWeight = getVoiceSpeechInstructionWeightedLength(suffix);
  let result = "";

  for (const part of normalizedParts) {
    const separator = result ? "；" : "";
    const available =
      VOICE_SPEECH_INSTRUCTION_WEIGHTED_LIMIT -
      suffixWeight -
      getVoiceSpeechInstructionWeightedLength(result + separator);
    if (available <= 0) {
      break;
    }

    const truncatedPart = truncateVoiceSpeechInstruction(part, available);
    if (!truncatedPart) {
      break;
    }
    result += separator + truncatedPart;

    if (truncatedPart !== part) {
      break;
    }
  }

  return result ? `${result}${suffix}` : undefined;
}

function normalizeVoiceSpeechCustomInstruction(
  instruction?: string
): string | undefined {
  return instruction
    ?.trim()
    .replace(
      /(?:^|[，,、；;。]\s*)(?:请)?(?:不要|别|禁止|避免)\s*(?:转成|转为|切换成|切换为|切回|使用|说)?\s*(?:标准)?普通话(?:表达)?/g,
      ""
    )
    .replace(/^[，,、；;。\s]+|[，,、；;。\s]+$/g, "")
    .replace(/[，,、；;。]{2,}/g, "，");
}

export function getQwenAudioSpeechInstructionSource(input: {
  instruction?: string;
  dialect?: string;
}): QwenAudioSpeechInstructionSource {
  const normalizedCustomInstruction = normalizeVoiceSpeechCustomInstruction(
    input.instruction
  );
  const hasCustomInstruction = Boolean(normalizedCustomInstruction);
  const hasStructuredDialect =
    resolveVoiceTimbreDialect(
      input.dialect,
      normalizedCustomInstruction,
      QWEN_AUDIO_DIALECT_OPTIONS
    ) !== "auto";

  if (hasCustomInstruction && hasStructuredDialect) {
    return "custom+structured";
  }

  if (hasCustomInstruction) {
    return "custom";
  }

  return hasStructuredDialect ? "structured" : "none";
}

export function buildQwenAudioSpeechInstruction(input: {
  instruction?: string;
  dialect?: string;
  speechSpeed?: number;
}): string | undefined {
  const parts: string[] = [];
  const normalizedCustomInstruction = normalizeVoiceSpeechCustomInstruction(
    input.instruction
  );
  const resolvedDialect = resolveVoiceTimbreDialect(
    input.dialect,
    normalizedCustomInstruction,
    QWEN_AUDIO_DIALECT_OPTIONS
  );
  const dialectLabel = getVoiceTimbreDialectLabel(resolvedDialect);

  if (dialectLabel) {
    parts.push(
      resolvedDialect === "mandarin"
        ? "请全程使用自然、标准、清晰的普通话发音和语调"
        : `请全程使用自然、地道、明显的${dialectLabel}发音和语调`
    );
  }

  if (normalizedCustomInstruction) {
    parts.push(normalizedCustomInstruction);
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

  return joinVoiceSpeechInstruction(parts);
}

export function getCosyVoiceSpeechInstructionSource(input: {
  instruction?: string;
  dialect?: string;
}): VoiceSpeechInstructionSource {
  const normalizedCustomInstruction = normalizeVoiceSpeechCustomInstruction(
    input.instruction
  );
  const hasCustomInstruction = Boolean(normalizedCustomInstruction);
  const hasStructuredDialect =
    resolveVoiceTimbreDialect(
      input.dialect,
      normalizedCustomInstruction,
      COSYVOICE_V35_DIALECT_OPTIONS
    ) !== "auto";

  if (hasCustomInstruction && hasStructuredDialect) {
    return "custom+structured";
  }

  if (hasCustomInstruction) {
    return "custom";
  }

  return hasStructuredDialect ? "structured" : "none";
}

export function buildCosyVoiceSpeechInstruction(input: {
  instruction?: string;
  dialect?: string;
}): string | undefined {
  const parts: string[] = [];
  const normalizedCustomInstruction = normalizeVoiceSpeechCustomInstruction(
    input.instruction
  );
  const resolvedDialect = resolveVoiceTimbreDialect(
    input.dialect,
    normalizedCustomInstruction,
    COSYVOICE_V35_DIALECT_OPTIONS
  );
  const dialectLabel = getVoiceTimbreDialectLabel(resolvedDialect);

  if (dialectLabel) {
    parts.push(
      resolvedDialect === "mandarin"
        ? "请全程使用自然、标准、清晰的普通话发音和语调"
        : `请全程使用自然、地道、明显的${dialectLabel}发音和语调`
    );
  }

  if (normalizedCustomInstruction) {
    parts.push(normalizedCustomInstruction);
  }

  return joinVoiceSpeechInstruction(parts);
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
  boundAgentCount: number;
  canDelete: boolean;
  deletionStatus?: "pending" | "completed" | "partial_failed";
  deletionFailureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeleteAdminVoiceTimbreResultDTO {
  id: string;
  deletionStatus: "completed" | "partial_failed";
  message: string;
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
