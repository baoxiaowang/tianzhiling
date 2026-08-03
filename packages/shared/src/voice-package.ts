export type VoicePackageStatusDTO = "active" | "disabled";

export interface VoicePackageDeliverableDTO {
  title: string;
  description?: string;
}

export interface AdminVoicePackageRecordDTO {
  id: string;
  code: string;
  name: string;
  description: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency: string;
  deliverables: VoicePackageDeliverableDTO[];
  materialRequirement: string;
  estimatedServiceDays?: number;
  virtualPaymentProductId?: string;
  status: VoicePackageStatusDTO;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVoicePackageListParamsDTO {
  keyword?: string;
  status?: VoicePackageStatusDTO;
  page?: number;
  pageSize?: number;
}

export interface AdminVoicePackageListDTO {
  items: AdminVoicePackageRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VoicePackageRecordDTO {
  id: string;
  code: string;
  name: string;
  description: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency: string;
  deliverables: VoicePackageDeliverableDTO[];
  materialRequirement: string;
  estimatedServiceDays?: number;
  virtualPaymentProductId?: string;
}

export interface SaveAdminVoicePackageDTO {
  code: string;
  name: string;
  description?: string;
  priceAmount: number;
  originalPriceAmount?: number;
  currency?: string;
  deliverables?: VoicePackageDeliverableDTO[];
  materialRequirement?: string;
  estimatedServiceDays?: number;
  virtualPaymentProductId?: string;
  status?: VoicePackageStatusDTO;
  sort?: number;
}

export type VoiceTrainingTaskStatusDTO =
  | "paid"
  | "awaiting_material"
  | "processing"
  | "training"
  | "completed"
  | "failed"
  | "refunded";

export type VoiceTrainingTaskTrainingStrategyDTO =
  | "short_sample"
  | "long_sample";

export interface VoiceTrainingTaskUserDTO {
  id: string;
  account: string;
  name: string;
  phone: string;
}

export interface VoiceTrainingTaskAgentDTO {
  id: string;
  name: string;
  avatar: string;
}

export interface AdminVoiceTrainingTaskRecordDTO {
  id: string;
  userId: string;
  user?: VoiceTrainingTaskUserDTO;
  agentId: string;
  agent?: VoiceTrainingTaskAgentDTO;
  orderId: string;
  orderNo?: string;
  voicePackageId: string;
  voicePackageCode: string;
  voicePackageName?: string;
  status: VoiceTrainingTaskStatusDTO;
  assigneeName: string;
  materialObjectKeys: string[];
  materialDurationSeconds?: number;
  trainingStrategy?: VoiceTrainingTaskTrainingStrategyDTO;
  voiceTimbreId?: string;
  remark: string;
  paidAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVoiceTrainingTaskListParamsDTO {
  keyword?: string;
  status?: VoiceTrainingTaskStatusDTO;
  agentId?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminVoiceTrainingTaskListDTO {
  items: AdminVoiceTrainingTaskRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateAdminVoiceTrainingTaskDTO {
  status?: Exclude<VoiceTrainingTaskStatusDTO, "completed">;
  assigneeName?: string;
  materialObjectKeys?: string[];
  voiceTimbreId?: string;
  remark?: string;
}

export interface CompleteAdminVoiceTrainingTaskDTO {
  voiceTimbreId: string;
  remark?: string;
}

export interface VoiceTrainingTaskRecordDTO {
  id: string;
  agentId: string;
  orderId: string;
  voicePackageId: string;
  voicePackageCode: string;
  voicePackageName?: string;
  status: VoiceTrainingTaskStatusDTO;
  voiceTimbreId?: string;
  remark: string;
  paidAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentVoicePackageCenterDTO {
  packages: VoicePackageRecordDTO[];
  task?: VoiceTrainingTaskRecordDTO;
}

export type VoiceServiceSessionStatusDTO =
  | "collecting"
  | "analyzing"
  | "reviewing"
  | "training"
  | "preview_ready"
  | "completed"
  | "failed";

export type VoiceServiceProcessingModeDTO = "assisted" | "ready_to_use";
export type VoiceServiceFailureStageDTO = "clipping" | "training";

export type VoiceServiceClipReviewStatusDTO =
  | "pending"
  | "accepted"
  | "rejected";

export type VoiceServiceClipRecutStatusDTO =
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export interface VoiceServiceMaterialDTO {
  id: string;
  name: string;
  objectKey: string;
  publicUrl?: string;
  durationSeconds?: number;
  createdAt: string;
}

export const VOICE_SERVICE_MAX_TRAINING_SECONDS = 60;

export interface VoiceServiceReviewClipDTO {
  id: string;
  sourceMaterialId?: string;
  sourceName?: string;
  objectKey: string;
  publicUrl?: string;
  durationSeconds?: number;
  transcript?: string;
  speakerId?: string;
  qualityScore?: number;
  qualityLabel?: string;
  qualityMetrics?: VoiceServiceClipQualityMetricsDTO;
  qualityIssues?: VoiceServiceClipQualityIssueDTO[];
  reviewStatus: VoiceServiceClipReviewStatusDTO;
  rejectionReason?: string;
  recutStatus?: VoiceServiceClipRecutStatusDTO;
  recutInstruction?: string;
  recutRequestedAt?: string;
  recutStartedAt?: string;
  recutCompletedAt?: string;
  recutFailureCode?: string;
  recutFailureReason?: string;
  createdAt: string;
  reviewedAt?: string;
}

export type VoiceServiceClipQualityIssueCodeDTO =
  | "too_short"
  | "mostly_silent"
  | "severe_clipping"
  | "volume_unrecoverable"
  | "background_noise_severe"
  | "silence_high"
  | "clipping_detected"
  | "volume_adjusted"
  | "background_noise_high";

export interface VoiceServiceClipQualityMetricsDTO {
  durationSeconds: number;
  silenceRatio: number;
  rmsDb?: number;
  peakDb?: number;
  clippingRatio: number;
  noiseFloorDb?: number;
  signalToNoiseDb?: number;
  volumeAdjusted?: boolean;
  volumeGainDb?: number;
}

export interface VoiceServiceClipQualityIssueDTO {
  code: VoiceServiceClipQualityIssueCodeDTO;
  severity: "warning" | "rejected";
  message: string;
}

export interface VoiceServiceFilteredClipDTO {
  id: string;
  sourceMaterialId?: string;
  sourceName?: string;
  durationSeconds?: number;
  transcript?: string;
  speakerId?: string;
  qualityMetrics?: VoiceServiceClipQualityMetricsDTO;
  qualityIssues: VoiceServiceClipQualityIssueDTO[];
  createdAt: string;
}

export interface VoiceServiceMessageDTO {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export type VoiceServiceEventTypeDTO =
  | "session_created"
  | "materials_added"
  | "material_removed"
  | "materials_submitted"
  | "returned_to_materials"
  | "returned_to_review"
  | "review_clips_ready"
  | "clip_reviewed"
  | "clip_recut_requested"
  | "clip_recut_completed"
  | "clip_recut_failed"
  | "training_started"
  | "training_completed"
  | "training_failed"
  | "agent_selected"
  | "agent_voice_bound"
  | "voice_access_revoked"
  | "data_deletion_requested"
  | "data_deletion_completed"
  | "data_deletion_partial_failed";

export type VoiceServiceDataDeletionStatusDTO =
  | "pending"
  | "completed"
  | "partial_failed";

export interface VoiceServiceEventDTO {
  id: string;
  type: VoiceServiceEventTypeDTO;
  summary: string;
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
}

export interface VoiceServiceSessionDTO {
  id: string;
  status: VoiceServiceSessionStatusDTO;
  processingMode?: VoiceServiceProcessingModeDTO;
  materials: VoiceServiceMaterialDTO[];
  reviewClips: VoiceServiceReviewClipDTO[];
  filteredClips?: VoiceServiceFilteredClipDTO[];
  messages: VoiceServiceMessageDTO[];
  events: VoiceServiceEventDTO[];
  voiceTimbreId?: string;
  selectedAgentId?: string;
  previewAgentId?: string;
  previewText?: string;
  voiceAccessEligible?: boolean;
  voiceAccessSource?:
    | "voice_membership_order"
    | "voice_package_order"
    | "admin_voice_order"
    | "voice_membership_record"
    | "voice_model_entitlement"
    | "legacy_voice_task"
    | "existing_voice_binding";
  voiceBindingStatus?:
    | "ready"
    | "purchase_required"
    | "bound"
    | "existing_voice_preserved";
  voiceBoundAgentIds?: string[];
  voiceBoundAt?: string;
  previewAudioUrl?: string;
  failureReason?: string;
  failureStage?: VoiceServiceFailureStageDTO;
  trainingAudioObjectKey?: string;
  dataDeletionStatus?: VoiceServiceDataDeletionStatusDTO;
  dataDeletionRequestedAt?: string;
  dataDeletionCompletedAt?: string;
  dataDeletionFailureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceServiceCenterDTO {
  session?: VoiceServiceSessionDTO;
}

export interface AddVoiceServiceMaterialsDTO {
  materials: Array<{
    name: string;
    objectKey: string;
    publicUrl?: string;
    durationSeconds?: number;
  }>;
}

export interface SubmitVoiceServiceMaterialsDTO {
  processingMode?: VoiceServiceProcessingModeDTO;
}

export interface SendVoiceServiceMessageDTO {
  text: string;
}

export interface ReviewVoiceServiceClipDTO {
  reviewStatus: VoiceServiceClipReviewStatusDTO;
  rejectionReason?: string;
}

export interface RecutVoiceServiceClipDTO {
  instruction: string;
}

export interface StartVoiceServiceTrainingDTO {
  agentId?: string;
}

export interface SelectVoiceServiceAgentDTO {
  agentId: string;
}
