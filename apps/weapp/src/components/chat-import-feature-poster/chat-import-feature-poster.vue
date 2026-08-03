<template>
  <view
    v-if="visible"
    class="feature-poster"
    @touchmove.stop.prevent
  >
    <view class="feature-poster__backdrop" @tap="handleDismiss" />

    <view class="feature-poster__panel" @tap.stop>
      <view
        class="feature-poster__close"
        role="button"
        aria-label="关闭"
        @tap="handleDismiss"
      >
        <Close size="20" color="#332b28" />
      </view>

      <view class="feature-poster__visual">
        <view class="feature-poster__sun" />
        <view class="feature-poster__block feature-poster__block--coral" />
        <view class="feature-poster__block feature-poster__block--teal" />
        <text class="feature-poster__badge">新功能</text>

        <view class="feature-poster__source">
          <view class="feature-poster__source-bar" />
          <view class="feature-poster__source-message feature-poster__source-message--left" />
          <view class="feature-poster__source-message feature-poster__source-message--right" />
          <view class="feature-poster__source-message feature-poster__source-message--short" />
        </view>

        <view class="feature-poster__flow">
          <view class="feature-poster__flow-dot" />
          <view class="feature-poster__flow-line" />
          <view class="feature-poster__flow-arrow" />
        </view>

        <view class="feature-poster__target">
          <view class="feature-poster__target-head">
            <view class="feature-poster__target-avatar">TA</view>
            <view class="feature-poster__target-name" />
          </view>
          <view class="feature-poster__target-message feature-poster__target-message--warm" />
          <view class="feature-poster__target-message" />
          <view class="feature-poster__target-tone">
            <view class="feature-poster__target-tone-bars">
              <view class="feature-poster__target-tone-bar feature-poster__target-tone-bar--short" />
              <view class="feature-poster__target-tone-bar" />
              <view class="feature-poster__target-tone-bar feature-poster__target-tone-bar--medium" />
            </view>
            <text class="feature-poster__target-tone-label">语气学习</text>
          </view>
        </view>
      </view>

      <view class="feature-poster__content">
        <view class="feature-poster__title">
          <text class="feature-poster__title-line">导入微信聊天，</text>
          <text class="feature-poster__title-line">和他在【天之灵】继续聊</text>
        </view>
        <text class="feature-poster__description">
          学习过去的说话方式和语气
        </text>

        <nut-button
          class="feature-poster__action"
          block
          type="primary"
          :loading="isNavigating"
          @click="handleUse"
        >
          去使用
        </nut-button>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: "ChatImportFeaturePoster",
};
</script>

<script setup lang="ts">
import { Close } from "@nutui/icons-vue-taro";
import Taro from "@tarojs/taro";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { authSession, restoreAuthSession } from "../../auth/session";
import { reportChatImportEvent } from "../../utils/product-analytics";
import {
  openConversationChatImport,
  openSelectedAgentChatImport,
} from "../../utils/selected-agent-chat";

const FEATURE_ID = "chat-import-v1";
const DISPLAY_DELAY_MS = 500;

const props = withDefaults(
  defineProps<{
    conversationId?: string;
    agentId?: string;
    agentName?: string;
    agentAvatar?: string;
    iCallAgent?: string;
  }>(),
  {
    conversationId: "",
    agentId: "",
    agentName: "",
    agentAvatar: "",
    iCallAgent: "",
  }
);

const visible = ref(false);
const isNavigating = ref(false);
let displayTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  void prepareAnnouncement();
});

onBeforeUnmount(() => {
  if (displayTimer) {
    clearTimeout(displayTimer);
  }
});

async function prepareAnnouncement() {
  await restoreAuthSession();
  const userId = authSession.value?.user.id.trim() ?? "";

  if (!userId || hasSeenAnnouncement(userId)) {
    return;
  }

  displayTimer = setTimeout(() => {
    markAnnouncementSeen(userId);
    visible.value = true;
    reportChatImportEvent("poster_exposure");
  }, DISPLAY_DELAY_MS);
}

function getStorageKey(userId: string) {
  return `tzl_feature_announcement_${FEATURE_ID}_${userId}`;
}

function hasSeenAnnouncement(userId: string) {
  try {
    return Taro.getStorageSync<string>(getStorageKey(userId)) === "seen";
  } catch {
    return false;
  }
}

function markAnnouncementSeen(userId: string) {
  try {
    Taro.setStorageSync(getStorageKey(userId), "seen");
  } catch {
    // Storage failure should not block the feature entry.
  }
}

function handleDismiss() {
  if (isNavigating.value) {
    return;
  }

  reportChatImportEvent("poster_dismiss");
  visible.value = false;
}

async function handleUse() {
  if (isNavigating.value) {
    return;
  }

  isNavigating.value = true;
  reportChatImportEvent("poster_click");
  const opened =
    props.conversationId && props.agentId
      ? await openConversationChatImport({
          id: props.conversationId,
          agentId: props.agentId,
          agentName: props.agentName,
          agentAvatar: props.agentAvatar,
          iCallAgent: props.iCallAgent,
        })
      : await openSelectedAgentChatImport();

  if (opened) {
    visible.value = false;
    return;
  }

  isNavigating.value = false;
}
</script>

<style lang="scss">
.feature-poster {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 20px;
  box-sizing: border-box;
}

.feature-poster__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(18, 16, 15, 0.62);
  animation: feature-poster-fade-in 180ms ease-out both;
}

.feature-poster__panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 336px;
  overflow: hidden;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 54px rgba(42, 28, 22, 0.25);
  animation: feature-poster-rise-in 260ms ease-out both;
}

.feature-poster__close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 3;
  display: flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.86);
}

.feature-poster__close:active {
  background: #ffffff;
  transform: scale(0.96);
}

.feature-poster__visual {
  position: relative;
  height: 222px;
  overflow: hidden;
  background: #fff1e5;
}

.feature-poster__sun {
  position: absolute;
  top: 23px;
  right: 56px;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #ffd45e;
}

.feature-poster__block {
  position: absolute;
}

.feature-poster__block--coral {
  top: 0;
  left: 0;
  width: 84px;
  height: 126px;
  border-radius: 0 0 54px 0;
  background: #ff7657;
}

.feature-poster__block--teal {
  right: -24px;
  bottom: -20px;
  width: 132px;
  height: 86px;
  border-radius: 58px 0 0 0;
  background: #39c7bf;
}

.feature-poster__badge {
  position: absolute;
  top: 22px;
  left: 20px;
  z-index: 2;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  line-height: 20px;
  letter-spacing: 0;
}

.feature-poster__source,
.feature-poster__target {
  position: absolute;
  box-sizing: border-box;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(88, 51, 36, 0.14);
}

.feature-poster__source {
  top: 76px;
  left: 28px;
  width: 104px;
  height: 126px;
  padding: 16px 10px 10px;
  border: 2px solid #ffffff;
  border-radius: 8px;
  transform: rotate(-5deg);
}

.feature-poster__source-bar {
  width: 42px;
  height: 6px;
  margin: 0 auto 16px;
  border-radius: 3px;
  background: #eee8e4;
}

.feature-poster__source-message {
  width: 58px;
  height: 14px;
  margin-bottom: 11px;
  border-radius: 5px;
  background: #f2eee9;
}

.feature-poster__source-message--right {
  width: 64px;
  margin-left: auto;
  background: #ffd45e;
}

.feature-poster__source-message--short {
  width: 42px;
  background: #ff9a80;
}

.feature-poster__flow {
  position: absolute;
  top: 124px;
  left: 128px;
  z-index: 2;
  width: 62px;
  height: 32px;
}

.feature-poster__flow-dot {
  position: absolute;
  top: 11px;
  left: 3px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff7657;
}

.feature-poster__flow-line {
  position: absolute;
  top: 14px;
  left: 14px;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: #ff7657;
}

.feature-poster__flow-arrow {
  position: absolute;
  top: 9px;
  right: 5px;
  width: 10px;
  height: 10px;
  border-top: 4px solid #ff7657;
  border-right: 4px solid #ff7657;
  transform: rotate(45deg);
}

.feature-poster__target {
  top: 54px;
  right: 24px;
  width: 132px;
  height: 150px;
  padding: 15px 12px;
  border: 2px solid #332b28;
  border-radius: 8px;
}

.feature-poster__target-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}

.feature-poster__target-avatar {
  display: flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #39c7bf;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 28px;
}

.feature-poster__target-name {
  width: 46px;
  height: 7px;
  border-radius: 4px;
  background: #332b28;
}

.feature-poster__target-message {
  width: 64px;
  height: 16px;
  margin-bottom: 10px;
  border-radius: 5px;
  background: #ecf8f6;
}

.feature-poster__target-message--warm {
  width: 82px;
  margin-left: auto;
  background: #ff7657;
}

.feature-poster__target-tone {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 13px;
}

.feature-poster__target-tone-bars {
  display: flex;
  height: 13px;
  align-items: center;
  gap: 2px;
}

.feature-poster__target-tone-bar {
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: #39c7bf;
}

.feature-poster__target-tone-bar--short {
  height: 7px;
}

.feature-poster__target-tone-bar--medium {
  height: 10px;
}

.feature-poster__target-tone-label {
  color: #5f5551;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  letter-spacing: 0;
}

.feature-poster__content {
  padding: 26px 24px 24px;
  text-align: center;
}

.feature-poster__title {
  display: flex;
  flex-direction: column;
  color: #211b19;
  font-size: 22px;
  font-weight: 700;
  line-height: 31px;
  letter-spacing: 0;
}

.feature-poster__title-line {
  display: block;
}

.feature-poster__description {
  display: block;
  min-height: 44px;
  margin-top: 8px;
  color: #6f625d;
  font-size: 15px;
  line-height: 22px;
  letter-spacing: 0;
}

.feature-poster__action {
  height: 48px;
  margin-top: 20px;
  border: 0;
  color: #ffffff;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0;
  --nut-button-border-radius: 6px;
  --nut-button-primary-background-color: #f45b42;
  --nut-button-primary-border-color: #f45b42;
}

.feature-poster__action:active {
  transform: scale(0.99);
}

@keyframes feature-poster-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes feature-poster-rise-in {
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
