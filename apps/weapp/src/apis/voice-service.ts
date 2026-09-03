import type {
  AddVoiceServiceMaterialsDTO,
  AgentVoiceModelCenterDTO,
  RecutVoiceServiceClipDTO,
  ReviewVoiceServiceClipDTO,
  SelectAgentVoiceTimbreDTO,
  SelectVoiceServiceAgentDTO,
  SendVoiceServiceMessageDTO,
  StartVoiceServiceTrainingDTO,
  SubmitVoiceServiceMaterialsDTO,
  VoiceServiceCenterDTO,
  VoiceServiceSessionDTO,
  UserVoiceTimbreLibraryDTO,
  UserVoiceTimbreDetailDTO,
  UserVoiceTimbreGeneratedAudioDTO,
  UserVoiceTimbreRecordDTO,
  DeleteUserVoiceTimbreResultDTO,
  GenerateUserVoiceTimbreSpeechDTO,
  UpdateUserVoiceTimbreDTO,
} from "@tzl/shared";
import { del, get, patch, post } from "../api/api-client";

export async function getCurrentVoiceServiceSession() {
  const result = await get<VoiceServiceCenterDTO>(
    "/api/voice-services/current"
  );

  return result.session;
}

export function startVoiceServiceSession() {
  return post<VoiceServiceSessionDTO>("/api/voice-services/start");
}

export function getUserVoiceTimbreLibrary() {
  return get<UserVoiceTimbreLibraryDTO>("/api/voice-services/timbres");
}

export function getUserVoiceTimbreDetail(timbreId: string) {
  return get<UserVoiceTimbreDetailDTO>(
    `/api/voice-services/timbres/${encodeURIComponent(timbreId)}`
  );
}

export function updateUserVoiceTimbre(
  timbreId: string,
  payload: UpdateUserVoiceTimbreDTO
) {
  return patch<UserVoiceTimbreRecordDTO>(
    `/api/voice-services/timbres/${encodeURIComponent(timbreId)}`,
    payload
  );
}

export function updateUserVoiceTimbreName(timbreId: string, name: string) {
  return updateUserVoiceTimbre(timbreId, { name });
}

export function generateUserVoiceTimbreSpeech(
  timbreId: string,
  payload: GenerateUserVoiceTimbreSpeechDTO
) {
  return post<UserVoiceTimbreGeneratedAudioDTO>(
    `/api/voice-services/timbres/${encodeURIComponent(timbreId)}/speech`,
    payload
  );
}

export function deleteUserVoiceTimbre(timbreId: string) {
  return del<DeleteUserVoiceTimbreResultDTO>(
    `/api/voice-services/timbres/${encodeURIComponent(timbreId)}`
  );
}

export function getAgentVoiceModelCenter(agentId: string) {
  return get<AgentVoiceModelCenterDTO>(
    `/api/voice-services/agents/${encodeURIComponent(agentId)}/timbres`
  );
}

export function selectAgentVoiceTimbre(
  agentId: string,
  payload: SelectAgentVoiceTimbreDTO
) {
  return patch<AgentVoiceModelCenterDTO>(
    `/api/voice-services/agents/${encodeURIComponent(agentId)}/timbre`,
    payload
  );
}

export function addVoiceServiceMaterials(payload: AddVoiceServiceMaterialsDTO) {
  return post<VoiceServiceSessionDTO>("/api/voice-services/materials", {
    materials: payload.materials,
  });
}

export function submitVoiceServiceMaterials(
  sessionId: string,
  payload: SubmitVoiceServiceMaterialsDTO = {}
) {
  return post<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(sessionId)}/submit`,
    payload
  );
}

export function returnVoiceServiceToMaterials(sessionId: string) {
  return post<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(sessionId)}/back-to-materials`
  );
}

export function returnVoiceServiceToReview(sessionId: string) {
  return post<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(sessionId)}/back-to-review`
  );
}

export function removeVoiceServiceMaterial(
  sessionId: string,
  materialId: string
) {
  return del<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(
      sessionId
    )}/materials/${encodeURIComponent(materialId)}`
  );
}

export function deleteVoiceServiceData(sessionId: string) {
  return del<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(sessionId)}/data`
  );
}

export function sendVoiceServiceMessage(
  sessionId: string | undefined,
  payload: SendVoiceServiceMessageDTO
) {
  const path = sessionId
    ? `/api/voice-services/${encodeURIComponent(sessionId)}/messages`
    : "/api/voice-services/messages";

  return post<VoiceServiceSessionDTO>(path, { text: payload.text });
}

export function reviewVoiceServiceClip(
  sessionId: string,
  clipId: string,
  payload: ReviewVoiceServiceClipDTO
) {
  return patch<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(
      sessionId
    )}/clips/${encodeURIComponent(clipId)}`,
    {
      reviewStatus: payload.reviewStatus,
      rejectionReason: payload.rejectionReason,
    }
  );
}

export function recutVoiceServiceClip(
  sessionId: string,
  clipId: string,
  payload: RecutVoiceServiceClipDTO
) {
  return post<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(
      sessionId
    )}/clips/${encodeURIComponent(clipId)}/recut`,
    { instruction: payload.instruction }
  );
}

export function startVoiceServiceTraining(
  sessionId: string,
  payload: StartVoiceServiceTrainingDTO = {}
) {
  return post<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(sessionId)}/train`,
    payload
  );
}

export function selectVoiceServiceAgent(
  sessionId: string,
  payload: SelectVoiceServiceAgentDTO
) {
  return patch<VoiceServiceSessionDTO>(
    `/api/voice-services/${encodeURIComponent(sessionId)}/agent`,
    { agentId: payload.agentId }
  );
}

export type {
  AgentVoiceModelCenterDTO,
  AgentVoiceModelSelectionStatusDTO,
  VoiceServiceClipQualityIssueDTO,
  VoiceServiceClipQualityMetricsDTO,
  VoiceServiceClipRecutStatusDTO,
  VoiceServiceClipReviewStatusDTO,
  VoiceServiceFilteredClipDTO,
  VoiceServiceMaterialDTO,
  VoiceServiceMessageDTO,
  VoiceServiceReviewClipDTO,
  VoiceServiceSessionDTO,
  VoiceServiceSessionStatusDTO,
  UserVoiceTimbreLibraryDTO,
  UserVoiceTimbreDetailDTO,
  UserVoiceTimbreGeneratedAudioDTO,
  UserVoiceTimbreRecordDTO,
  UserVoiceTimbreTrainingClipDTO,
  SelectAgentVoiceTimbreDTO,
  VoiceTimbreRetentionPolicyDTO,
  VoiceTimbreRetentionStatusDTO,
} from "@tzl/shared";
