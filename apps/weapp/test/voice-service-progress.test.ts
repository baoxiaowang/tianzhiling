import type { VoiceServiceSessionDTO } from "../src/apis/voice-service";
import fs from "fs";
import path from "path";
import {
  buildVoiceServiceMessengerState,
  buildVoiceServiceResumePrompt,
  getAcceptedVoiceClipDurationSeconds,
  getVoiceClipIssueDisplayText,
  isVoiceClipRecutReason,
  isVoiceClipUnusedReason,
  wouldExceedVoiceClipSelectionLimit,
} from "../src/pages/voice-package/voice-service-progress";

function createSession(
  overrides: Partial<VoiceServiceSessionDTO> = {}
): VoiceServiceSessionDTO {
  return {
    id: "session-1",
    status: "collecting",
    materials: [],
    reviewClips: [],
    messages: [],
    events: [],
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildVoiceServiceResumePrompt", () => {
  it("reassures the user that any voice material can be handled", () => {
    const prompt = buildVoiceServiceResumePrompt(createSession());

    expect(prompt).toContain("你发给我就行");
    expect(prompt).toContain("音频、视频都可以");
    expect(prompt).toContain("不用提前剪辑或整理");
    expect(prompt).toContain("我会帮你处理好");
    expect(prompt).not.toContain("从微信聊天选择");
  });

  it("reports that clipping is still in progress", () => {
    const prompt = buildVoiceServiceResumePrompt(
      createSession({ status: "analyzing" })
    );

    expect(prompt).toContain("区分不同说话人");
    expect(prompt).toContain("两到三分钟");
  });

  it("reports completed clips that are waiting for review", () => {
    const prompt = buildVoiceServiceResumePrompt(
      createSession({
        status: "reviewing",
        reviewClips: [
          {
            id: "clip-1",
            objectKey: "voice-service-clips/clip-1.mp3",
            reviewStatus: "pending",
            createdAt: "2026-08-01T12:01:00.000Z",
          },
          {
            id: "clip-2",
            objectKey: "voice-service-clips/clip-2.mp3",
            reviewStatus: "accepted",
            createdAt: "2026-08-01T12:01:00.000Z",
          },
        ],
      })
    );

    expect(prompt).toContain("已经确认了一部分");
    expect(prompt).toContain("还有声音片段等你试听");
  });

  it("reports when voice training has completed", () => {
    const prompt = buildVoiceServiceResumePrompt(
      createSession({ status: "preview_ready" })
    );

    expect(prompt).toContain("声音已经准备好了");
    expect(prompt).toContain("先听听看");
  });

  it("reports that an eligible trained voice was connected", () => {
    const state = buildVoiceServiceMessengerState(
      createSession({
        status: "completed",
        selectedAgentId: "agent-1",
        voiceAccessEligible: true,
        voiceBindingStatus: "bound",
      })
    );

    expect(state.statusText).toBe("声音已接入天之灵");
    expect(state.prompt).toContain("可以在聊天中使用");
  });

  it("reports that an existing backend voice was preserved", () => {
    const state = buildVoiceServiceMessengerState(
      createSession({
        status: "completed",
        selectedAgentId: "agent-1",
        voiceAccessEligible: true,
        voiceBindingStatus: "existing_voice_preserved",
      })
    );

    expect(state.statusText).toBe("原有声音服务已保留");
    expect(state.prompt).toContain("没有进行覆盖");
  });

  it("matches the messenger status to partial clip review progress", () => {
    const state = buildVoiceServiceMessengerState(
      createSession({
        status: "reviewing",
        reviewClips: [
          {
            id: "clip-1",
            objectKey: "voice-service-clips/clip-1.mp3",
            reviewStatus: "accepted",
            createdAt: "2026-08-01T12:01:00.000Z",
          },
          {
            id: "clip-2",
            objectKey: "voice-service-clips/clip-2.mp3",
            reviewStatus: "pending",
            createdAt: "2026-08-01T12:01:00.000Z",
          },
        ],
      })
    );

    expect(state.statusText).toBe("还剩 1 段待确认");
    expect(state.prompt).toContain("已经确认了一部分");
    expect(state.prompt).toContain("再剪一下");
    expect(state.prompt).toContain("不使用");
  });
});

describe("voice clip selection", () => {
  const clips: VoiceServiceSessionDTO["reviewClips"] = [
    {
      id: "clip-1",
      objectKey: "voice-service-clips/clip-1.mp3",
      durationSeconds: 40,
      reviewStatus: "accepted",
      createdAt: "2026-08-01T12:01:00.000Z",
    },
    {
      id: "clip-2",
      objectKey: "voice-service-clips/clip-2.mp3",
      durationSeconds: 20,
      reviewStatus: "pending",
      createdAt: "2026-08-01T12:01:00.000Z",
    },
    {
      id: "clip-3",
      objectKey: "voice-service-clips/clip-3.mp3",
      durationSeconds: 19,
      reviewStatus: "pending",
      createdAt: "2026-08-01T12:01:00.000Z",
    },
  ];

  it("keeps selected audio within one minute", () => {
    expect(getAcceptedVoiceClipDurationSeconds(clips)).toBe(40);
    expect(wouldExceedVoiceClipSelectionLimit(clips, "clip-2")).toBe(true);
    expect(wouldExceedVoiceClipSelectionLimit(clips, "clip-3")).toBe(false);
  });

  it("turns acoustic metrics into user-facing guidance", () => {
    expect(
      getVoiceClipIssueDisplayText({
        code: "background_noise_high",
        severity: "warning",
        message: "估算信噪比 8 dB，背景噪声偏多",
      })
    ).toBe("背景噪声偏多，请重点试听");
  });
});

describe("voice clip review actions", () => {
  it("maps current and legacy review reasons to the three-action UI", () => {
    expect(isVoiceClipRecutReason("再剪一下")).toBe(true);
    expect(isVoiceClipRecutReason("素材充足，暂不使用")).toBe(true);
    expect(isVoiceClipUnusedReason("不使用")).toBe(true);
    expect(isVoiceClipUnusedReason("不是他的声音")).toBe(true);
    expect(isVoiceClipUnusedReason("听不清或杂音较多")).toBe(true);
  });
});

describe("voice service step navigation", () => {
  it("uses native tap targets and returns directly without a confirmation modal", () => {
    const pageSource = fs.readFileSync(
      path.resolve(__dirname, "../src/pages/voice-package/index.vue"),
      "utf8"
    );

    expect(pageSource).toContain('@click="handleReturnToMaterials"');
    expect(pageSource).toContain('@click="handleReturnToReview"');
    expect(pageSource).toContain('@tap="handleReturnToMaterials"');
    expect(pageSource).toContain('@tap="handleReturnToReview"');
    expect(pageSource).toContain('<view\n            class="voice-service-back-step"');
    expect(pageSource).not.toContain('<button\n            class="voice-service-back-step"');
    expect(pageSource).not.toContain('title: "返回修改素材？"');
    expect(pageSource).not.toContain('title: "返回片段选择？"');
  });
});

describe("voice preview retention notice", () => {
  it("explains the model provider seven-day inactivity limit", () => {
    const pageSource = fs.readFileSync(
      path.resolve(__dirname, "../src/pages/voice-package/index.vue"),
      "utf8"
    );

    expect(pageSource).toContain("受大模型厂家限制");
    expect(pageSource).toContain("生成的音色暂存 7 天");
    expect(pageSource).toContain("7 天内未使用，厂家会自动清理");
  });
});
