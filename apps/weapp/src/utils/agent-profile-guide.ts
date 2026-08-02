export interface AgentProfileGuideSnapshot {
  lifeExperience: string;
  personalityTraits: string;
  languageHabits: string;
  hobbies: string;
  sharedMemories: string;
  hasUnreadAgentHomeGuide?: boolean;
  hasUnreadAgentProfileGuide?: boolean;
}

export function isAgentProfileEmpty(
  agent: AgentProfileGuideSnapshot | null | undefined
) {
  if (!agent) {
    return false;
  }

  return [
    agent.lifeExperience,
    agent.personalityTraits,
    agent.languageHabits,
    agent.hobbies,
    agent.sharedMemories,
  ].every((value) => !value.trim());
}

export function shouldShowAgentHomeGuide(
  agent: AgentProfileGuideSnapshot | null | undefined
) {
  return Boolean(agent?.hasUnreadAgentHomeGuide);
}

export function shouldShowAgentProfileGuide(
  agent: AgentProfileGuideSnapshot | null | undefined
) {
  return Boolean(agent?.hasUnreadAgentProfileGuide);
}
