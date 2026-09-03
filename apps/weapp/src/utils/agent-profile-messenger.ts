import { AGENT_PROFILE_RETURNING_GREETING } from "@tzl/shared";

export interface AgentProfileMessengerSnapshot {
  name: string;
  lifeExperience: string;
  personalityTraits: string;
  languageHabits: string;
  hobbies: string;
  sharedMemories: string;
}

const profileMemoryFields = [
  "lifeExperience",
  "personalityTraits",
  "languageHabits",
  "hobbies",
  "sharedMemories",
] as const;

export const returningAgentProfileGreeting = AGENT_PROFILE_RETURNING_GREETING;

export function buildAgentProfileInitialGreeting(
  detail: AgentProfileMessengerSnapshot
) {
  const name = detail.name?.trim() || "TA";
  const hasSavedProfile = profileMemoryFields.some((field) =>
    Boolean(detail[field].trim())
  );

  if (hasSavedProfile) {
    return returningAgentProfileGreeting;
  }

  return `你好，终于找到你了。跟我讲讲${name}是什么样的人吧，想到什么就说什么。`;
}

export function resolveAssistantPlaybackCharacterCount(options: {
  currentTime: number;
  duration: number;
  totalCharacters: number;
}) {
  const { currentTime, duration, totalCharacters } = options;

  if (
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    !Number.isFinite(totalCharacters) ||
    currentTime < 0 ||
    duration <= 0 ||
    totalCharacters <= 0
  ) {
    return 0;
  }

  const progress = Math.min(1, Math.max(0, currentTime / duration));
  return Math.min(
    Math.floor(totalCharacters),
    Math.max(1, Math.ceil(progress * Math.floor(totalCharacters)))
  );
}
