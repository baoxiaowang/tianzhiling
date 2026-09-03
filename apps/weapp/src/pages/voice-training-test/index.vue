<template>
  <view class="voice-training-test-entry">
    <view class="voice-training-test-entry__indicator" />
    <text class="voice-training-test-entry__text">正在进入声音训练...</text>
  </view>
</template>

<script setup lang="ts">
import Taro from "@tarojs/taro";
import { onMounted } from "vue";
import { getAgents } from "../../apis/agent";
import { devLogin } from "../../auth/api";

onMounted(async () => {
  try {
    await devLogin("dev-test", "dev-openid");
    const agents = await getAgents();
    const previewAgent =
      agents.find((item) => item.accessRole === "owner" && item.isDefault) ??
      agents.find((item) => item.accessRole === "owner");
    const agentParam = previewAgent
      ? `?agentId=${encodeURIComponent(previewAgent.id)}`
      : "";
    await Taro.reLaunch({
      url: `/pages/voice-package/index${agentParam}`,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    await Taro.showModal({
      title: "声音训练测试环境未就绪",
      content: `请确认本地 7002 服务已启动。${details ? `\n${details}` : ""}`,
      showCancel: false,
    });
  }
});
</script>

<style lang="scss">
.voice-training-test-entry {
  box-sizing: border-box;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #f5f6f8;
}

.voice-training-test-entry__indicator {
  width: 18px;
  height: 18px;
  border: 2px solid #dedbe5;
  border-top-color: #77728f;
  border-radius: 50%;
  animation: voice-training-test-spin 0.8s linear infinite;
}

.voice-training-test-entry__text {
  color: #77728f;
  font-size: 14px;
  line-height: 20px;
}

@keyframes voice-training-test-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
