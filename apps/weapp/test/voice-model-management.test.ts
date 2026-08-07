import fs from "fs";
import path from "path";

function readSource(relativePath: string) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

describe("voice timbre detail management", () => {
  const source = readSource("../src/pages/voice-timbre-detail/index.vue");

  it("shows editable identity and agent associations without provider branding", () => {
    expect(source).toContain('@tap="openRenameDialog"');
    expect(source).toContain("修改音色名称");
    expect(source).toContain("关联天之灵");
    expect(source).toContain("音色只有在声音版会员有效时");
    expect(source).toContain("getAgentVoiceModelCenter");
    expect(source).not.toContain("detail.providerName");
  });
});

describe("agent voice model selection", () => {
  const source = readSource("../src/pages/agent-detail/index.vue");

  it("offers trained timbres and routes an empty account to training", () => {
    expect(source).toContain("声音模型");
    expect(source).toContain("必须购买声音版会员");
    expect(source).toContain("getAgentVoiceModelCenter");
    expect(source).toContain("selectAgentVoiceTimbre");
    expect(source).toContain("还没有训练好的音色");
    expect(source).toContain("/pages/voice-package/index?agentId=");
  });

  it("opens the voice membership group from the selector", () => {
    expect(source).toContain("/pages/vip-center/index?planGroup=voice");
    const vipCenterSource = readSource("../src/pages/vip-center/index.vue");
    expect(vipCenterSource).toContain('options?.planGroup === \'voice\'');
  });
});
