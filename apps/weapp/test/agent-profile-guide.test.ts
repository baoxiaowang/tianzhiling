import {
  isAgentProfileEmpty,
  shouldShowAgentHomeGuide,
  shouldShowAgentProfileGuide,
} from "../src/utils/agent-profile-guide";

const emptyProfile = {
  lifeExperience: "",
  personalityTraits: "",
  languageHabits: "",
  hobbies: "",
  sharedMemories: "",
};

describe("agent profile creation guides", () => {
  it("recognizes whether profile information is empty", () => {
    expect(isAgentProfileEmpty(null)).toBe(false);
    expect(isAgentProfileEmpty(emptyProfile)).toBe(true);
    expect(
      isAgentProfileEmpty({
        ...emptyProfile,
        lifeExperience: "年轻时在家乡做过教师",
      })
    ).toBe(false);
  });

  it("does not infer a red dot from an old empty profile", () => {
    expect(shouldShowAgentHomeGuide(emptyProfile)).toBe(false);
    expect(shouldShowAgentProfileGuide(emptyProfile)).toBe(false);
  });

  it("keeps the two newly-created reminders independent", () => {
    const newAgent = {
      ...emptyProfile,
      hasUnreadAgentHomeGuide: true,
      hasUnreadAgentProfileGuide: true,
    };

    expect(shouldShowAgentHomeGuide(newAgent)).toBe(true);
    expect(shouldShowAgentProfileGuide(newAgent)).toBe(true);
    expect(
      shouldShowAgentHomeGuide({
        ...newAgent,
        hasUnreadAgentHomeGuide: false,
      })
    ).toBe(false);
    expect(
      shouldShowAgentProfileGuide({
        ...newAgent,
        hasUnreadAgentProfileGuide: false,
      })
    ).toBe(false);
  });
});
