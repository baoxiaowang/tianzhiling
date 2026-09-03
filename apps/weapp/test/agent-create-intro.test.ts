import {
  AGENT_CREATE_INTRO_LINES,
  AGENT_CREATE_INTRO_SPEECH_TEXT,
  createLocalDateKey,
  shouldAnimateAgentCreateIntro,
} from "../src/pages/agent-create/agent-create-intro";

describe("agent create intro", () => {
  it("keeps the fixed awakening copy aligned with its speech text", () => {
    expect(AGENT_CREATE_INTRO_LINES).toEqual([
      "你好，我是天之灵小使者",
      "你的每句话，都在唤醒他",
      "准备好后，我们就开始",
    ]);
    expect(AGENT_CREATE_INTRO_SPEECH_TEXT).toBe(
      "你好，我是天之灵小使者。你的每句话，都在唤醒他。准备好后，我们就开始。"
    );
  });

  it("builds a stable local calendar date key", () => {
    expect(createLocalDateKey(new Date(2026, 6, 31, 23, 59))).toBe(
      "2026-07-31"
    );
  });

  it("animates when the intro has not completed today", () => {
    expect(
      shouldAnimateAgentCreateIntro("2026-07-30", new Date(2026, 6, 31, 8, 0))
    ).toBe(true);
    expect(
      shouldAnimateAgentCreateIntro(undefined, new Date(2026, 6, 31, 8, 0))
    ).toBe(true);
  });

  it("skips animation after it completed on the same local day", () => {
    expect(
      shouldAnimateAgentCreateIntro("2026-07-31", new Date(2026, 6, 31, 22, 0))
    ).toBe(false);
  });
});
