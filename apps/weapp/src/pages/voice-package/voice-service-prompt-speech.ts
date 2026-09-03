import analyzingAssistedSpeech from "./assets/prompts/analyzing-assisted.mp3";
import analyzingReadyToUseSpeech from "./assets/prompts/analyzing-ready-to-use.mp3";
import completedSelectedSpeech from "./assets/prompts/completed-selected.mp3";
import completedBoundSpeech from "./assets/prompts/completed-bound.mp3";
import completedExistingPreservedSpeech from "./assets/prompts/completed-existing-preserved.mp3";
import completedUnselectedSpeech from "./assets/prompts/completed-unselected.mp3";
import failedClippingSpeech from "./assets/prompts/failed-clipping.mp3";
import failedTrainingSpeech from "./assets/prompts/failed-training.mp3";
import materialCollectionSpeech from "./assets/prompts/material-collection.mp3";
import materialsSavedSpeech from "./assets/prompts/materials-saved.mp3";
import previewReadySpeech from "./assets/prompts/preview-ready.mp3";
import recutCompletedSpeech from "./assets/prompts/recut-completed.mp3";
import recutFailedSpeech from "./assets/prompts/recut-failed.mp3";
import recutProcessingSpeech from "./assets/prompts/recut-processing.mp3";
import reviewingCompleteSpeech from "./assets/prompts/reviewing-complete.mp3";
import reviewingEmptySpeech from "./assets/prompts/reviewing-empty.mp3";
import reviewingPartialSpeech from "./assets/prompts/reviewing-partial.mp3";
import reviewingStartSpeech from "./assets/prompts/reviewing-start.mp3";
import selectionLimitSpeech from "./assets/prompts/selection-limit.mp3";
import trainingSpeech from "./assets/prompts/training.mp3";
import promptManifest from "./voice-service-prompts";

const speechByPromptId: Record<string, string> = {
  material_collection: materialCollectionSpeech,
  materials_saved: materialsSavedSpeech,
  analyzing_ready_to_use: analyzingReadyToUseSpeech,
  analyzing_assisted: analyzingAssistedSpeech,
  reviewing_start: reviewingStartSpeech,
  reviewing_partial: reviewingPartialSpeech,
  reviewing_complete: reviewingCompleteSpeech,
  reviewing_empty: reviewingEmptySpeech,
  recut_processing: recutProcessingSpeech,
  recut_completed: recutCompletedSpeech,
  recut_failed: recutFailedSpeech,
  training: trainingSpeech,
  preview_ready: previewReadySpeech,
  completed_selected: completedSelectedSpeech,
  completed_bound: completedBoundSpeech,
  completed_existing_preserved: completedExistingPreservedSpeech,
  completed_unselected: completedUnselectedSpeech,
  failed_training: failedTrainingSpeech,
  failed_clipping: failedClippingSpeech,
  selection_limit: selectionLimitSpeech,
};

const speechByPromptText = new Map(
  promptManifest.map((prompt) => [
    prompt.text.trim(),
    speechByPromptId[prompt.id],
  ])
);

export function getVoiceServiceFixedPromptSpeech(text: string) {
  return speechByPromptText.get(text.trim()) || "";
}
