<template>
  <view class="onboarding-page">
    <view v-if="isCheckingEntry" class="onboarding-entry-check">
      <view class="onboarding-entry-check__orb">
        <image
          class="onboarding-entry-check__image"
          :src="entryLoadingImage"
          mode="aspectFit"
        />
      </view>
      <text class="onboarding-entry-check__text">正在为你打开天之灵</text>
    </view>

    <block v-else>
      <view class="onboarding-poster">
        <view class="onboarding-poster__copy">
          <text class="onboarding-poster__headline">亲人的数字归处</text>
          <view class="onboarding-poster__brand-line">
            <text>在「</text>
            <text class="onboarding-poster__brand">天之灵</text>
            <text>」</text>
          </view>
        </view>

        <view class="onboarding-scene">
          <view
            class="onboarding-scene__block onboarding-scene__block--coral-left"
          ></view>
          <view
            class="onboarding-scene__block onboarding-scene__block--yellow-right"
          ></view>
          <view
            class="onboarding-scene__block onboarding-scene__block--cyan-left"
          ></view>
          <view
            class="onboarding-scene__block onboarding-scene__block--coral-right"
          ></view>

          <view class="onboarding-scene__portal">
            <view class="onboarding-scene__portal-ring">
              <view class="onboarding-scene__portal-inner">
                <view class="onboarding-scene__portrait">
                  <view class="onboarding-scene__portrait-bun"></view>
                  <view class="onboarding-scene__portrait-hair"></view>
                  <view class="onboarding-scene__portrait-face"></view>
                  <view class="onboarding-scene__portrait-neck"></view>
                  <view class="onboarding-scene__portrait-body"></view>
                </view>
              </view>
            </view>
          </view>

          <view class="onboarding-scene__photo">
            <view class="onboarding-scene__photo-sun"></view>
            <view
              class="onboarding-scene__photo-hill onboarding-scene__photo-hill--back"
            ></view>
            <view
              class="onboarding-scene__photo-hill onboarding-scene__photo-hill--front"
            ></view>
          </view>

          <view class="onboarding-scene__chat">
            <view class="onboarding-scene__chat-dots">
              <view class="onboarding-scene__chat-dot"></view>
              <view class="onboarding-scene__chat-dot"></view>
              <view class="onboarding-scene__chat-dot"></view>
            </view>
            <view class="onboarding-scene__chat-tail"></view>
          </view>

          <view
            class="onboarding-scene__trail onboarding-scene__trail--cyan"
          ></view>
          <view
            class="onboarding-scene__trail onboarding-scene__trail--yellow"
          ></view>
          <view
            class="onboarding-scene__trail onboarding-scene__trail--coral"
          ></view>
          <view class="onboarding-scene__pedestal"></view>
          <view class="onboarding-scene__pedestal-core"></view>
        </view>
      </view>

      <view class="onboarding-action" :style="actionSafeStyle">
        <nut-button
          class="onboarding-action__button"
          shape="round"
          type="primary"
          :loading="isNavigating"
          @click="handleStart"
        >
          我来了
        </nut-button>
      </view>
    </block>
  </view>
</template>

<script lang="ts">
export default {
  name: "OnboardingPage",
};
</script>

<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import Taro, { useLoad } from "@tarojs/taro";
import { authSession, restoreAuthSession } from "../../auth/session";
import { silentWeappLogin } from "../../auth/login-hooks";
import {
  createSafeAreaCssVars,
  initSafeAreaInsets,
} from "../../utils/safe-area";
import { openSelectedAgentChat } from "../../utils/selected-agent-chat";
import entryLoadingImage from "../../assets/images/agent-create/header-mark.png";

const ONBOARDING_STORAGE_KEY = "tzl_onboarding_seen";
const AUTH_SESSION_STORAGE_KEY = "auth_session";
const ENTRY_CHECK_TIMEOUT_MS = 3500;
const ENTRY_FALLBACK_TIMEOUT_MS = 5000;
const CHAT_ENTRY_TIMEOUT_MS = 6000;

type EntryTarget = "onboarding" | "index" | "chat";

const isCheckingEntry = ref(true);
const isNavigating = ref(false);
const actionSafeStyle = computed(() =>
  createSafeAreaCssVars("onboarding-safe")
);
let entryFallbackTimer: ReturnType<typeof setTimeout> | undefined;

function hasSeenOnboarding() {
  try {
    return Boolean(Taro.getStorageSync(ONBOARDING_STORAGE_KEY));
  } catch {
    return false;
  }
}

function hasPersistedSession() {
  try {
    return Boolean(Taro.getStorageSync(AUTH_SESSION_STORAGE_KEY));
  } catch {
    return false;
  }
}

function markOnboardingSeen() {
  try {
    Taro.setStorageSync(ONBOARDING_STORAGE_KEY, "1");
  } catch {
    // Storage failure must not block entry into the product.
  }
}

function resolveLocalFallbackTarget(): EntryTarget {
  return hasSeenOnboarding() || hasPersistedSession()
    ? "index"
    : "onboarding";
}

function showOnboardingFallback() {
  clearEntryFallback();
  isNavigating.value = false;
  isCheckingEntry.value = false;
}

function scheduleEntryFallback() {
  clearEntryFallback();
  entryFallbackTimer = setTimeout(() => {
    showOnboardingFallback();
  }, ENTRY_FALLBACK_TIMEOUT_MS);
}

function clearEntryFallback() {
  if (!entryFallbackTimer) {
    return;
  }

  clearTimeout(entryFallbackTimer);
  entryFallbackTimer = undefined;
}

async function goToIndex(): Promise<boolean> {
  if (isNavigating.value) {
    return false;
  }

  isNavigating.value = true;
  try {
    await Taro.switchTab({
      url: "/pages/index/index",
    });
    return true;
  } catch {
    try {
      await Taro.reLaunch({
        url: "/pages/index/index",
      });
      return true;
    } catch {
      return false;
    }
  } finally {
    isNavigating.value = false;
  }
}

async function goToChatTab(): Promise<boolean> {
  if (isNavigating.value) {
    return false;
  }

  isNavigating.value = true;
  try {
    return await openSelectedAgentChat({
      forceRefresh: true,
      requestTimeout: CHAT_ENTRY_TIMEOUT_MS,
      showLoading: false,
    });
  } catch {
    return false;
  } finally {
    isNavigating.value = false;
  }
}

async function resolveEntryTarget(): Promise<EntryTarget> {
  const hadPersistedSession = hasPersistedSession();

  await restoreAuthSession();

  if (authSession.value?.accessToken) {
    markOnboardingSeen();
    return "chat";
  }

  const session = await withTimeout(
    silentWeappLogin(),
    ENTRY_CHECK_TIMEOUT_MS,
    null
  );
  if (session?.accessToken) {
    markOnboardingSeen();
    return "chat";
  }

  if (!hasSeenOnboarding() && !hadPersistedSession) {
    return "onboarding";
  }

  return "index";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallback);
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function handleStart() {
  markOnboardingSeen();
  await goToIndex();
}

async function initializeEntry() {
  const target = await withTimeout(
    resolveEntryTarget(),
    ENTRY_CHECK_TIMEOUT_MS + 1000,
    "onboarding" as EntryTarget
  );

  if (target === "index") {
    const opened = await goToIndex();
    if (opened) {
      clearEntryFallback();
    } else {
      showOnboardingFallback();
    }
    return;
  }

  if (target === "chat") {
    const opened = await goToChatTab();
    if (opened) {
      clearEntryFallback();
      return;
    }

    const openedIndex = await goToIndex();
    if (openedIndex) {
      clearEntryFallback();
      return;
    }

    showOnboardingFallback();
    return;
  }

  showOnboardingFallback();
}

useLoad(() => {
  initSafeAreaInsets();

  if (resolveLocalFallbackTarget() === "onboarding") {
    isCheckingEntry.value = false;
    return;
  }

  scheduleEntryFallback();
  void initializeEntry().catch(() => {
    showOnboardingFallback();
  });
});

onUnmounted(() => {
  clearEntryFallback();
});
</script>

<style lang="scss">
.onboarding-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #f5f5f3;
}

.onboarding-entry-check {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding-bottom: 12vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: #f5f5f3;
}

.onboarding-entry-check__orb {
  width: 92px;
  height: 92px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: onboarding-entry-float 1800ms ease-in-out infinite;
}

.onboarding-entry-check__image {
  width: 84px;
  height: 84px;
  display: block;
  filter: drop-shadow(0 8px 18px rgba(98, 113, 220, 0.28));
}

.onboarding-entry-check__text {
  color: #6f7178;
  font-size: 15px;
  line-height: 22px;
  letter-spacing: 0;
}

@keyframes onboarding-entry-float {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }

  50% {
    transform: translateY(-8px) scale(1.03);
  }
}

.onboarding-poster {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 180px 18px 116px;
  background: #fff8ee;
}

.onboarding-poster__copy {
  position: relative;
  z-index: 6;
  width: 100%;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: -42px;
  animation: onboarding-copy-enter 520ms ease-out both;
}

.onboarding-poster__headline,
.onboarding-poster__brand-line,
.onboarding-poster__brand {
  letter-spacing: 0;
}

.onboarding-poster__headline {
  color: #f4513b;
  font-size: 34px;
  font-weight: 800;
  line-height: 44px;
  text-align: center;
}

.onboarding-poster__brand-line {
  display: flex;
  align-items: baseline;
  justify-content: center;
  color: #272321;
  font-size: 31px;
  font-weight: 800;
  line-height: 43px;
  text-align: center;
}

.onboarding-poster__brand {
  color: #e94834;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 33px;
  font-weight: 900;
}

.onboarding-scene {
  position: relative;
  width: 100%;
  max-width: 430px;
  min-height: 348px;
  max-height: 520px;
  flex: 1;
  align-self: center;
  overflow: hidden;
  transform: translateY(-24px);
  animation: onboarding-scene-enter 680ms 80ms ease-out both;
}

.onboarding-scene__block {
  position: absolute;
  z-index: 1;
}

.onboarding-scene__block--coral-left {
  top: 38px;
  left: -78px;
  width: 148px;
  height: 214px;
  border-radius: 0 108px 108px 0;
  background: #ff654c;
  transform: rotate(-8deg);
}

.onboarding-scene__block--yellow-right {
  top: 28px;
  right: -70px;
  width: 143px;
  height: 245px;
  border-radius: 112px 0 0 112px;
  background: #ffc43d;
  transform: rotate(9deg);
}

.onboarding-scene__block--cyan-left {
  bottom: -65px;
  left: -52px;
  width: 142px;
  height: 175px;
  border-radius: 0 100px 0 0;
  background: #47c7cb;
  transform: rotate(8deg);
}

.onboarding-scene__block--coral-right {
  right: -75px;
  bottom: -18px;
  width: 168px;
  height: 202px;
  border-radius: 118px 0 0 0;
  background: #ff654c;
  transform: rotate(-11deg);
}

.onboarding-scene__portal {
  box-sizing: border-box;
  position: absolute;
  bottom: 24px;
  left: 50%;
  z-index: 2;
  width: 216px;
  height: calc(100% - 52px);
  min-height: 286px;
  max-height: 374px;
  padding: 11px;
  border: 7px solid #ffd49a;
  border-radius: 108px 108px 30px 30px;
  background: #ffb759;
  box-shadow: 0 14px 30px rgba(227, 114, 51, 0.2);
  transform: translateX(-50%);
  animation: onboarding-portal-breathe 4200ms 900ms ease-in-out infinite;
}

.onboarding-scene__portal-ring {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 10px;
  border: 3px solid rgba(255, 255, 255, 0.72);
  border-radius: 95px 95px 23px 23px;
  background: #ffc875;
}

.onboarding-scene__portal-inner {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 2px solid #fff4df;
  border-radius: 82px 82px 17px 17px;
  background: #fff3dc;
}

.onboarding-scene__portrait {
  position: absolute;
  bottom: 22px;
  left: 50%;
  width: 126px;
  height: 194px;
  transform-origin: 50% 100%;
  transform: translateX(-50%);
  animation: onboarding-portrait-breathe 5200ms 260ms ease-in-out infinite;
  will-change: transform;
}

.onboarding-scene__portrait-bun,
.onboarding-scene__portrait-hair,
.onboarding-scene__portrait-face,
.onboarding-scene__portrait-neck,
.onboarding-scene__portrait-body {
  position: absolute;
}

.onboarding-scene__portrait-bun {
  top: 35px;
  left: 12px;
  z-index: 2;
  width: 37px;
  height: 45px;
  border-radius: 50%;
  background: #f5a735;
}

.onboarding-scene__portrait-hair {
  top: 9px;
  left: 30px;
  z-index: 2;
  width: 64px;
  height: 91px;
  border-radius: 52% 48% 45% 42%;
  background: #f5a735;
  transform: rotate(-8deg);
}

.onboarding-scene__portrait-face {
  top: 24px;
  left: 46px;
  z-index: 3;
  width: 51px;
  height: 75px;
  border-radius: 52% 48% 54% 45%;
  background: #ffc65b;
  transform: rotate(-5deg);
}

.onboarding-scene__portrait-neck {
  top: 86px;
  left: 51px;
  z-index: 2;
  width: 37px;
  height: 36px;
  border-radius: 12px;
  background: #ffc65b;
}

.onboarding-scene__portrait-body {
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  height: 103px;
  border-radius: 63px 63px 18px 18px;
  background: #ffc65b;
}

.onboarding-scene__photo {
  position: absolute;
  top: 48%;
  left: 6%;
  z-index: 4;
  width: 70px;
  height: 96px;
  overflow: hidden;
  border: 5px solid #ffffff;
  border-radius: 12px;
  background: #62cdd0;
  box-shadow: 0 10px 20px rgba(64, 82, 86, 0.18);
  transform-origin: 50% 82%;
  transform: rotate(-5deg);
  animation: onboarding-photo-drift 4800ms 420ms ease-in-out infinite;
  will-change: transform;
}

.onboarding-scene__photo-sun {
  position: absolute;
  top: 19px;
  right: 12px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffd86a;
}

.onboarding-scene__photo-hill {
  position: absolute;
  bottom: -20px;
  border-radius: 50% 50% 0 0;
}

.onboarding-scene__photo-hill--back {
  right: -22px;
  width: 88px;
  height: 70px;
  background: #ff835d;
  transform: rotate(-9deg);
}

.onboarding-scene__photo-hill--front {
  bottom: -24px;
  left: -22px;
  width: 95px;
  height: 72px;
  background: #227f78;
  transform: rotate(10deg);
}

.onboarding-scene__chat {
  box-sizing: border-box;
  position: absolute;
  top: 55%;
  right: 4%;
  z-index: 4;
  width: 82px;
  height: 61px;
  border: 5px solid #ffffff;
  border-radius: 22px;
  background: #f4513b;
  box-shadow: 0 10px 20px rgba(179, 67, 50, 0.2);
  transform-origin: 70% 80%;
  animation: onboarding-chat-float 3800ms 720ms ease-in-out infinite;
  will-change: transform;
}

.onboarding-scene__chat-dots {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.onboarding-scene__chat-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffffff;
  animation: onboarding-dot-pulse 1700ms ease-in-out infinite;
}

.onboarding-scene__chat-dot:nth-child(2) {
  animation-delay: 160ms;
}

.onboarding-scene__chat-dot:nth-child(3) {
  animation-delay: 320ms;
}

.onboarding-scene__chat-tail {
  position: absolute;
  right: 10px;
  bottom: -14px;
  width: 20px;
  height: 20px;
  border-right: 5px solid #ffffff;
  border-bottom: 5px solid #ffffff;
  border-radius: 0 0 7px 0;
  background: #f4513b;
  transform: rotate(36deg);
}

.onboarding-scene__trail {
  position: absolute;
  bottom: 36px;
  z-index: 5;
  width: 118px;
  height: 90px;
  border-bottom: 10px solid;
  border-radius: 0 0 80px 80px;
  opacity: 0.88;
  animation: onboarding-trail-flow 3600ms ease-in-out infinite;
}

.onboarding-scene__trail--cyan {
  left: 24%;
  border-color: #45c9cc;
  transform: rotate(48deg);
}

.onboarding-scene__trail--yellow {
  left: 39%;
  border-color: #ffd05c;
  transform: rotate(90deg);
  animation-delay: 300ms;
}

.onboarding-scene__trail--coral {
  right: 22%;
  border-color: #ff7a5f;
  transform: rotate(132deg);
  animation-delay: 600ms;
}

.onboarding-scene__pedestal {
  position: absolute;
  bottom: 9px;
  left: 50%;
  z-index: 3;
  width: 252px;
  height: 66px;
  border-radius: 50%;
  background: #ffd89f;
  transform: translateX(-50%);
}

.onboarding-scene__pedestal-core {
  position: absolute;
  bottom: 19px;
  left: 50%;
  z-index: 4;
  width: 192px;
  height: 42px;
  border: 3px solid rgba(255, 255, 255, 0.74);
  border-radius: 50%;
  background: #fff1d9;
  transform: translateX(-50%);
}

@keyframes onboarding-copy-enter {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes onboarding-scene-enter {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }

  to {
    opacity: 1;
    transform: translateY(-24px);
  }
}

@keyframes onboarding-portal-breathe {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
  }

  50% {
    transform: translateX(-50%) scale(1.012);
  }
}

@keyframes onboarding-portrait-breathe {
  0%,
  100% {
    transform: translateX(-50%) translateY(0) scale(1);
  }

  50% {
    transform: translateX(-50%) translateY(-5px) scale(1.018);
  }
}

@keyframes onboarding-photo-drift {
  0%,
  100% {
    transform: rotate(-5deg) translateY(0);
  }

  50% {
    transform: rotate(-3deg) translate(2px, -8px);
  }
}

@keyframes onboarding-chat-float {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }

  50% {
    transform: translateY(-7px) scale(1.025);
  }
}

@keyframes onboarding-dot-pulse {
  0%,
  100% {
    opacity: 0.56;
    transform: translateY(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@keyframes onboarding-trail-flow {
  0%,
  100% {
    opacity: 0.68;
  }

  50% {
    opacity: 1;
  }
}

@media (max-height: 700px) {
  .onboarding-poster {
    padding-top: 152px;
    padding-bottom: 106px;
  }

  .onboarding-poster__headline {
    font-size: 31px;
    line-height: 39px;
  }

  .onboarding-poster__brand-line {
    font-size: 28px;
    line-height: 38px;
  }

  .onboarding-poster__brand {
    font-size: 30px;
  }

  .onboarding-scene__photo {
    top: 45%;
  }

  .onboarding-scene__chat {
    top: 52%;
  }
}

@media (max-height: 620px) {
  .onboarding-poster {
    padding: 124px 14px 94px;
  }

  .onboarding-scene {
    min-height: 324px;
  }

  .onboarding-poster__headline {
    font-size: 27px;
    line-height: 34px;
  }

  .onboarding-poster__brand-line {
    font-size: 25px;
    line-height: 34px;
  }

  .onboarding-poster__brand {
    font-size: 27px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .onboarding-poster__copy,
  .onboarding-scene,
  .onboarding-scene__portal,
  .onboarding-scene__portrait,
  .onboarding-scene__photo,
  .onboarding-scene__chat,
  .onboarding-scene__chat-dot,
  .onboarding-scene__trail {
    animation: none;
  }
}

.onboarding-action {
  position: fixed;
  right: 0;
  bottom: calc(
    var(--onboarding-safe-bottom, env(safe-area-inset-bottom)) + 36px
  );
  left: 0;
  z-index: 8;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.onboarding-action__button {
  width: 228px;
  height: 58px;
  border: 0;
  color: #ffffff;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0;
  box-shadow: 0 10px 24px rgba(232, 72, 48, 0.28);
  pointer-events: auto;
  --nut-button-border-radius: 999px;
  --nut-button-primary-background-color: #f4513b;
  --nut-button-primary-border-color: #f4513b;
  --nut-button-default-padding: 0 32px;
}

.onboarding-action__button:active {
  transform: scale(0.98);
}
</style>
