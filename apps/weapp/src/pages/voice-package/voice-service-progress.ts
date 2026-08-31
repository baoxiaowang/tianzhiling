import { VOICE_SERVICE_MAX_TRAINING_SECONDS } from "@tzl/shared";
import { brand } from "../../config/brand";
import type {
  VoiceServiceClipQualityIssueDTO,
  VoiceServiceReviewClipDTO,
  VoiceServiceSessionDTO,
} from "../../apis/voice-service";
import promptManifest from "./voice-service-prompts";

export interface VoiceServiceMessengerState {
  statusText: string;
  prompt: string;
}

function getPromptText(id: string) {
  const prompt = promptManifest.find((item) => item.id === id)?.text.trim();
  if (!prompt) {
    throw new Error(`Voice service prompt is missing: ${id}`);
  }

  return prompt;
}

export const VOICE_SERVICE_PROMPTS = {
  materialCollection: getPromptText("material_collection"),
  materialsSaved: getPromptText("materials_saved"),
  analyzingReadyToUse: getPromptText("analyzing_ready_to_use"),
  analyzingAssisted: getPromptText("analyzing_assisted"),
  reviewingStart: getPromptText("reviewing_start"),
  reviewingPartial: getPromptText("reviewing_partial"),
  reviewingComplete: getPromptText("reviewing_complete"),
  reviewingEmpty: getPromptText("reviewing_empty"),
  recutProcessing: getPromptText("recut_processing"),
  recutCompleted: getPromptText("recut_completed"),
  recutFailed: getPromptText("recut_failed"),
  training: getPromptText("training"),
  previewReady: getPromptText("preview_ready"),
  completedSelected: getPromptText("completed_selected"),
  completedBound: getPromptText("completed_bound"),
  completedExistingPreserved: getPromptText("completed_existing_preserved"),
  completedUnselected: getPromptText("completed_unselected"),
  failedTraining: getPromptText("failed_training"),
  failedClipping: getPromptText("failed_clipping"),
  selectionLimit: getPromptText("selection_limit"),
} as const;

const MATERIAL_COLLECTION_PROMPT = VOICE_SERVICE_PROMPTS.materialCollection;

const DEFAULT_CLIP_DURATION_SECONDS = 12;
const CLIP_SEPARATOR_SECONDS = 0.2;

export const VOICE_SERVICE_SELECTION_LIMIT_SECONDS =
  VOICE_SERVICE_MAX_TRAINING_SECONDS;

export const VOICE_SERVICE_CLIP_RECUT_REASON = "再剪一下";
export const VOICE_SERVICE_CLIP_UNUSED_REASON = "不使用";

const LEGACY_CLIP_RECUT_REASONS = new Set(["素材充足，暂不使用"]);
const LEGACY_CLIP_UNUSED_REASONS = new Set([
  "不是他的声音",
  "听不清或杂音较多",
]);

export function isVoiceClipRecutReason(reason?: string) {
  return (
    reason === VOICE_SERVICE_CLIP_RECUT_REASON ||
    LEGACY_CLIP_RECUT_REASONS.has(reason ?? "")
  );
}

export function isVoiceClipUnusedReason(reason?: string) {
  return (
    reason === VOICE_SERVICE_CLIP_UNUSED_REASON ||
    LEGACY_CLIP_UNUSED_REASONS.has(reason ?? "")
  );
}

export function getAcceptedVoiceClipDurationSeconds(
  clips: VoiceServiceReviewClipDTO[]
) {
  const accepted = clips.filter((item) => item.reviewStatus === "accepted");
  const contentSeconds = accepted.reduce(
    (total, item) => total + getVoiceClipDurationSeconds(item),
    0
  );

  return (
    contentSeconds + Math.max(0, accepted.length - 1) * CLIP_SEPARATOR_SECONDS
  );
}

export function wouldExceedVoiceClipSelectionLimit(
  clips: VoiceServiceReviewClipDTO[],
  clipId: string
) {
  const target = clips.find((item) => item.id === clipId);
  if (!target || target.reviewStatus === "accepted") {
    return false;
  }

  const accepted = clips.filter((item) => item.reviewStatus === "accepted");
  const projectedSeconds =
    getAcceptedVoiceClipDurationSeconds(accepted) +
    (accepted.length ? CLIP_SEPARATOR_SECONDS : 0) +
    getVoiceClipDurationSeconds(target);

  return projectedSeconds > VOICE_SERVICE_SELECTION_LIMIT_SECONDS;
}

export function getVoiceClipIssueDisplayText(
  issue: VoiceServiceClipQualityIssueDTO
) {
  const messages: Partial<
    Record<VoiceServiceClipQualityIssueDTO["code"], string>
  > = {
    too_short: "片段太短，有效声音不足",
    mostly_silent: "停顿太多，有效声音不足",
    severe_clipping: "爆音失真较严重",
    volume_unrecoverable: "音量过低，调高后仍可能听不清",
    background_noise_severe: "背景噪声盖过人声",
    silence_high: "停顿较多，请重点试听",
    clipping_detected: "有少量爆音，请重点试听",
    volume_adjusted: "原音量偏低，已自动调高",
    background_noise_high: "背景噪声偏多，请重点试听",
  };

  return messages[issue.code] ?? issue.message;
}

function getVoiceClipDurationSeconds(clip: VoiceServiceReviewClipDTO) {
  const durationSeconds = Number(clip.durationSeconds);
  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : DEFAULT_CLIP_DURATION_SECONDS;
}

const EMPTY_STATE: VoiceServiceMessengerState = {
  statusText: "准备他的声音",
  prompt: MATERIAL_COLLECTION_PROMPT,
};

export function buildVoiceServiceMessengerState(
  session: VoiceServiceSessionDTO | null
): VoiceServiceMessengerState {
  if (!session) {
    return EMPTY_STATE;
  }

  if (session.status === "collecting") {
    return {
      statusText: "准备他的声音",
      prompt: session.materials.length
        ? VOICE_SERVICE_PROMPTS.materialsSaved
        : MATERIAL_COLLECTION_PROMPT,
    };
  }

  if (session.status === "analyzing") {
    return session.processingMode === "ready_to_use"
      ? {
          statusText: "正在整理声音格式",
          prompt: VOICE_SERVICE_PROMPTS.analyzingReadyToUse,
        }
      : {
          statusText: "正在识别并剪辑声音",
          prompt: VOICE_SERVICE_PROMPTS.analyzingAssisted,
        };
  }

  if (session.status === "reviewing") {
    const totalCount = session.reviewClips.length;
    const pendingCount = session.reviewClips.filter(
      (item) => item.reviewStatus === "pending"
    ).length;
    const acceptedCount = session.reviewClips.filter(
      (item) => item.reviewStatus === "accepted"
    ).length;
    const reviewedCount = totalCount - pendingCount;

    if (pendingCount > 0 && reviewedCount === 0) {
      return {
        statusText: "等你确认声音片段",
        prompt: VOICE_SERVICE_PROMPTS.reviewingStart,
      };
    }
    if (pendingCount > 0) {
      return {
        statusText: `还剩 ${pendingCount} 段待确认`,
        prompt: VOICE_SERVICE_PROMPTS.reviewingPartial,
      };
    }
    if (acceptedCount > 0) {
      return {
        statusText: `已确认 ${acceptedCount} 段可用声音`,
        prompt: VOICE_SERVICE_PROMPTS.reviewingComplete,
      };
    }

    return {
      statusText: "暂时没有可用片段",
      prompt: VOICE_SERVICE_PROMPTS.reviewingEmpty,
    };
  }

  if (session.status === "training") {
    return {
      statusText: "正在生成声音",
      prompt: VOICE_SERVICE_PROMPTS.training,
    };
  }

  if (session.status === "preview_ready") {
    return {
      statusText: "声音已生成，等待试听",
      prompt: VOICE_SERVICE_PROMPTS.previewReady,
    };
  }

  if (session.status === "completed") {
    if (session.voiceBindingStatus === "bound") {
      return {
        statusText: `声音已接入${brand.name}`,
        prompt: VOICE_SERVICE_PROMPTS.completedBound,
      };
    }

    if (session.voiceBindingStatus === "existing_voice_preserved") {
      return {
        statusText: "原有声音服务已保留",
        prompt: VOICE_SERVICE_PROMPTS.completedExistingPreserved,
      };
    }

    return session.selectedAgentId
      ? {
          statusText: "已选择使用对象",
          prompt: VOICE_SERVICE_PROMPTS.completedSelected,
        }
      : {
          statusText: "声音已生成，等待选择",
          prompt: VOICE_SERVICE_PROMPTS.completedUnselected,
        };
  }

  return session.failureStage === "training"
    ? {
        statusText: "可以重新生成声音",
        prompt: VOICE_SERVICE_PROMPTS.failedTraining,
      }
    : {
        statusText: "等待重新整理",
        prompt: VOICE_SERVICE_PROMPTS.failedClipping,
      };
}

export function buildVoiceServiceResumePrompt(
  session: VoiceServiceSessionDTO | null
) {
  return buildVoiceServiceMessengerState(session).prompt;
}
