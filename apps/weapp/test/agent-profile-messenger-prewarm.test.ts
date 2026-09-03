const mockCreateAgentProfileMessengerSpeech = jest.fn();
const mockDownloadFile = jest.fn();

jest.mock("../src/apis/agent", () => ({
  createAgentProfileMessengerSpeech: mockCreateAgentProfileMessengerSpeech,
}));

jest.mock("@tarojs/taro", () => ({
  __esModule: true,
  default: {
    downloadFile: mockDownloadFile,
  },
}));

import {
  getPrewarmedAgentProfileGreetingSpeech,
  prewarmAgentProfileInitialGreeting,
} from "../src/utils/agent-profile-messenger-prewarm";
import { buildAgentProfileInitialGreeting } from "../src/utils/agent-profile-messenger";

describe("agent profile messenger prewarm", () => {
  it("reuses the downloaded greeting when the profile page opens", async () => {
    const detail = {
      id: "agent-1",
      name: "爸爸",
      lifeExperience: "年轻时在工厂工作。",
      personalityTraits: "温和、有耐心。",
      languageHabits: "",
      hobbies: "",
      sharedMemories: "",
    } as Parameters<typeof prewarmAgentProfileInitialGreeting>[0];
    const greeting = buildAgentProfileInitialGreeting(detail);
    mockCreateAgentProfileMessengerSpeech.mockResolvedValue({
      url: "https://example.com/greeting.mp3",
      voice: "female",
    });
    mockDownloadFile.mockResolvedValue({
      statusCode: 200,
      tempFilePath: "wxfile://tmp/greeting.mp3",
    });

    await prewarmAgentProfileInitialGreeting(detail);
    const source = await getPrewarmedAgentProfileGreetingSpeech(greeting);

    expect(source).toBe("wxfile://tmp/greeting.mp3");
    expect(mockCreateAgentProfileMessengerSpeech).toHaveBeenCalledTimes(1);
    expect(mockDownloadFile).toHaveBeenCalledWith({
      url: "https://example.com/greeting.mp3",
    });
  });
});
