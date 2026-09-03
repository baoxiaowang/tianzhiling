import {
  buildAgentProfileInitialGreeting,
  resolveAssistantPlaybackCharacterCount,
  returningAgentProfileGreeting,
} from "../src/utils/agent-profile-messenger";
import type { AgentSummary } from "../src/apis/agent";

function createAgent(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: "agent-1",
    name: "爸爸",
    avatar: "",
    sex: 1,
    agentCallMe: "孩子",
    iCallAgent: "爸爸",
    birthday: null,
    deathDate: null,
    description: "",
    lifeExperience: "",
    personalityTraits: "",
    languageHabits: "",
    hobbies: "",
    sharedMemories: "",
    status: 1,
    isDefault: true,
    voiceTimbreId: "",
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("agent profile messenger", () => {
  it("builds distinct greetings for first and returning visits", () => {
    expect(buildAgentProfileInitialGreeting(createAgent())).toContain(
      "终于找到你了"
    );
    const returningGreeting = buildAgentProfileInitialGreeting(
      createAgent({ personalityTraits: "温和、有耐心" })
    );

    expect(returningGreeting).toBe(returningAgentProfileGreeting);
    expect(returningGreeting).not.toContain("爸爸");
  });

  it("keeps the visible text aligned with audio progress", () => {
    expect(
      resolveAssistantPlaybackCharacterCount({
        currentTime: 0,
        duration: 10,
        totalCharacters: 20,
      })
    ).toBe(1);
    expect(
      resolveAssistantPlaybackCharacterCount({
        currentTime: 5,
        duration: 10,
        totalCharacters: 20,
      })
    ).toBe(10);
    expect(
      resolveAssistantPlaybackCharacterCount({
        currentTime: 10,
        duration: 10,
        totalCharacters: 20,
      })
    ).toBe(20);
  });
});
