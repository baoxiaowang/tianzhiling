<template>
  <page-scaffold
    class="agent-create-start"
    :class="{ 'agent-create-start--transitioning': isPageTransitioning }"
    background="#f6f6f8"
    header-background="#ffffff"
    bottom-background="#ffffff"
    body-padding="0"
    :safe-area-top="false"
    :safe-area-bottom="true"
  >
    <template #header>
      <app-bar
        title="唤醒天之灵"
        background="#ffffff"
        border-color="#eeeef2"
        @back="handleBack"
      />
    </template>

    <view class="agent-create-start__workspace">
      <view class="agent-create-start__messenger">
        <view class="agent-create-start__messenger-visual">
          <view class="agent-create-start__messenger-halo" />
          <image
            class="agent-create-start__messenger-image"
            :src="headerLoadingImage"
            mode="aspectFit"
            :fade-in="false"
          />
        </view>
        <text class="agent-create-start__messenger-name">天之灵小使者</text>
        <text class="agent-create-start__messenger-desc">
          我来陪你轻轻唤醒他
        </text>
      </view>

      <view class="agent-create-start__intro">
        <view
          v-for="(line, index) in visibleIntroLineStates"
          :key="index"
          class="agent-create-start__intro-line"
        >
          <text class="agent-create-start__intro-ghost">
            {{ introLines[index] }}
          </text>
          <view class="agent-create-start__intro-typed">
            <text class="agent-create-start__intro-stable">
              {{ line.stableText }}
            </text>
            <text
              v-if="line.activeChar"
              :key="line.activeKey"
              class="agent-create-start__intro-char"
            >
              {{ line.activeChar }}
            </text>
          </view>
        </view>
        <button
          class="agent-create-start__intro-speech"
          :class="{
            'agent-create-start__intro-speech--active': isIntroSpeechPlaying,
          }"
          :aria-label="isIntroSpeechPlaying ? '停止播放' : '播放小使者语音'"
          @tap="handleIntroSpeechTap"
        >
          <PlayStop v-if="isIntroSpeechPlaying" color="#ffffff" size="15" />
          <Voice v-else color="#77728f" size="17" />
        </button>
      </view>

      <view class="agent-create-start__hint">
        <view class="agent-create-start__hint-dot" />
        <text>只需要从你最熟悉的称呼开始</text>
      </view>
    </view>

    <template #bottom>
      <view class="agent-create-start__actions">
        <nut-button
          class="agent-create-start__primary-button"
          type="primary"
          :block="true"
          :loading="isOpeningCreateFlow"
          @click="handleStart"
        >
          <text>开始唤醒</text>
          <Right v-if="!isOpeningCreateFlow" color="#ffffff" size="15" />
        </nut-button>
      </view>
    </template>

    <template #overlay>
      <view v-if="isPageTransitioning" class="agent-create-start__transition">
        <view class="agent-create-start__transition-visual">
          <view class="agent-create-start__transition-halo" />
          <image
            class="agent-create-start__transition-image"
            :src="headerLoadingImage"
            mode="aspectFit"
          />
        </view>
        <text class="agent-create-start__transition-text">
          小使者正在准备唤醒他
        </text>
      </view>
    </template>

    <login-prompt-popup
      v-if="isLoginPromptVisible"
      v-model:visible="isLoginPromptVisible"
      @login-success="handleLoginSuccess"
    />
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: "AgentCreateIndexPage",
};
</script>

<script setup lang="ts">
import { PlayStop, Right, Voice } from "@nutui/icons-vue-taro";
import Taro from "@tarojs/taro";
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppBar from "../../components/app-bar/app-bar.vue";
import LoginPromptPopup from "../../components/login-prompt-popup/login-prompt-popup.vue";
import PageScaffold from "../../components/page-scaffold/page-scaffold.vue";
import { authSession, restoreAuthSession } from "../../auth/session";
import {
  reportAgentCreateStartEvent,
  type AgentCreateIntroMode,
} from "../../utils/product-analytics";
import headerLoadingImage from "../../assets/images/agent-create/header-mark.png";
import agentCreateIntroSpeech from "../../assets/audio/agent-create-intro.mp3";
import {
  AGENT_CREATE_INTRO_LINES,
  AGENT_CREATE_INTRO_DATE_STORAGE_KEY,
  createLocalDateKey,
  shouldAnimateAgentCreateIntro,
} from "./agent-create-intro";
import { prewarmAgentCreateMessengerSpeech } from "../../utils/agent-create-messenger-speech";
import { ensureInnerAudioPlaybackOptions } from "../../utils/audio";

const introLines = [...AGENT_CREATE_INTRO_LINES];
const introLineChars = introLines.map((line) => Array.from(line));
const introTypeInitialDelay = 180;
const introTypeCharDelay = 56;
const introTypeLineDelay = 180;
const startTransitionDurationMs = 360;
const startNavigationLeadInMs = 180;
const isLoginPromptVisible = ref(false);
const isOpeningCreateFlow = ref(false);
const isPageTransitioning = ref(false);
const isIntroSpeechPlaying = ref(false);
const isAuthenticated = computed(() => Boolean(authSession.value?.accessToken));
let introTypeTimer: ReturnType<typeof setTimeout> | undefined;
let introAudioContext: Taro.InnerAudioContext | null = null;
let restoreSessionPromise: Promise<void> | null = null;
let introMode: AgentCreateIntroMode = "animated";
let transitionRunId = 0;

interface VisibleIntroLineState {
  stableText: string;
  activeChar: string;
  activeKey: number;
}

function createEmptyIntroLineStates(): VisibleIntroLineState[] {
  return introLines.map(() => ({
    stableText: "",
    activeChar: "",
    activeKey: 0,
  }));
}

const visibleIntroLineStates = ref(createEmptyIntroLineStates());

function createCompleteIntroLineStates(): VisibleIntroLineState[] {
  return introLines.map((line) => ({
    stableText: line,
    activeChar: "",
    activeKey: 0,
  }));
}

function reportStartEvent(
  action: Parameters<typeof reportAgentCreateStartEvent>[0]
) {
  reportAgentCreateStartEvent(action, introMode, isAuthenticated.value);
}

function readLastIntroCompletedDate() {
  try {
    return Taro.getStorageSync<unknown>(AGENT_CREATE_INTRO_DATE_STORAGE_KEY);
  } catch {
    return undefined;
  }
}

function markIntroCompletedToday() {
  try {
    Taro.setStorageSync(
      AGENT_CREATE_INTRO_DATE_STORAGE_KEY,
      createLocalDateKey(new Date())
    );
  } catch {
    // Storage failure should not replay or block the current animation.
  }
}

function completeIntroAnimation() {
  markIntroCompletedToday();
  reportStartEvent("intro_complete");
}

function showCompleteIntro() {
  clearIntroTypeTimer();
  visibleIntroLineStates.value = createCompleteIntroLineStates();
}

function clearIntroTypeTimer() {
  if (!introTypeTimer) {
    return;
  }

  clearTimeout(introTypeTimer);
  introTypeTimer = undefined;
}

function startIntroTypewriter() {
  clearIntroTypeTimer();
  visibleIntroLineStates.value = createEmptyIntroLineStates();

  let lineIndex = 0;
  let charIndex = 0;
  let activeKey = 0;

  const typeNext = () => {
    const currentLineChars = introLineChars[lineIndex];

    if (!currentLineChars) {
      return;
    }

    const nextChar = currentLineChars[charIndex];

    if (!nextChar) {
      return;
    }

    visibleIntroLineStates.value = visibleIntroLineStates.value.map(
      (line, index) =>
        index === lineIndex
          ? {
              stableText: currentLineChars.slice(0, charIndex).join(""),
              activeChar: nextChar,
              activeKey: activeKey + 1,
            }
          : line
    );
    activeKey += 1;

    if (charIndex < currentLineChars.length - 1) {
      charIndex += 1;
      introTypeTimer = setTimeout(typeNext, introTypeCharDelay);
      return;
    }

    const completedLineIndex = lineIndex;
    introTypeTimer = setTimeout(() => {
      visibleIntroLineStates.value = visibleIntroLineStates.value.map(
        (line, index) =>
          index === completedLineIndex
            ? {
                stableText: currentLineChars.join(""),
                activeChar: "",
                activeKey,
              }
            : line
      );
      lineIndex += 1;
      charIndex = 0;

      if (lineIndex < introLines.length) {
        typeNext();
        return;
      }

      completeIntroAnimation();
    }, introTypeLineDelay);
  };

  introTypeTimer = setTimeout(typeNext, introTypeInitialDelay);
}

function ensureSessionRestored() {
  if (!restoreSessionPromise) {
    restoreSessionPromise = restoreAuthSession().finally(() => {
      restoreSessionPromise = null;
    });
  }

  return restoreSessionPromise;
}

function showToast(message: string) {
  void Taro.showToast({
    title: message,
    icon: "none",
    duration: 1800,
  });
}

function destroyIntroAudio() {
  const audio = introAudioContext;
  introAudioContext = null;
  isIntroSpeechPlaying.value = false;
  if (!audio) {
    return;
  }

  try {
    audio.stop();
  } catch {}
  audio.destroy();
}

function playFixedIntroSpeech(showFailureToast = false) {
  destroyIntroAudio();
  void ensureInnerAudioPlaybackOptions();
  const audio = Taro.createInnerAudioContext();
  introAudioContext = audio;
  audio.obeyMuteSwitch = false;
  audio.onPlay(() => {
    if (introAudioContext === audio) {
      isIntroSpeechPlaying.value = true;
    }
  });
  audio.onEnded(() => {
    if (introAudioContext !== audio) {
      return;
    }
    introAudioContext = null;
    isIntroSpeechPlaying.value = false;
    audio.destroy();
  });
  audio.onStop(() => {
    if (introAudioContext === audio) {
      isIntroSpeechPlaying.value = false;
    }
  });
  audio.onError(() => {
    if (introAudioContext !== audio) {
      return;
    }
    introAudioContext = null;
    isIntroSpeechPlaying.value = false;
    audio.destroy();
    if (showFailureToast) {
      showToast("语音暂时无法播放");
    }
  });
  audio.src = agentCreateIntroSpeech;
  audio.play();
}

function handleIntroSpeechTap() {
  if (isIntroSpeechPlaying.value) {
    destroyIntroAudio();
    return;
  }

  playFixedIntroSpeech(true);
}

async function enterCreateFlow() {
  await Taro.navigateTo({
    url: "/pages/agent-create-flow/index",
  });
}

function waitForStartTransition(duration: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, duration);
  });
}

async function enterCreateFlowWithTransition() {
  const runId = ++transitionRunId;

  destroyIntroAudio();
  isPageTransitioning.value = true;
  const transitionCompletion = waitForStartTransition(
    startTransitionDurationMs
  );
  await waitForStartTransition(startNavigationLeadInMs);
  if (runId !== transitionRunId) {
    return false;
  }

  try {
    await Promise.all([enterCreateFlow(), transitionCompletion]);
    return true;
  } finally {
    isPageTransitioning.value = false;
  }
}

async function handleStart() {
  if (isOpeningCreateFlow.value) {
    return;
  }

  reportStartEvent("start_click");
  isOpeningCreateFlow.value = true;

  try {
    await ensureSessionRestored();

    if (!isAuthenticated.value) {
      reportStartEvent("login_prompt");
      isLoginPromptVisible.value = true;
      return;
    }

    if (await enterCreateFlowWithTransition()) {
      reportStartEvent("flow_enter_success");
    }
  } catch {
    reportStartEvent("flow_enter_failure");
    showToast("页面打开失败，请重试");
  } finally {
    isOpeningCreateFlow.value = false;
  }
}

async function handleLoginSuccess() {
  if (isOpeningCreateFlow.value) {
    return;
  }

  isOpeningCreateFlow.value = true;

  try {
    await ensureSessionRestored();

    if (!isAuthenticated.value) {
      return;
    }

    if (await enterCreateFlowWithTransition()) {
      reportStartEvent("flow_enter_success");
    }
  } catch {
    reportStartEvent("flow_enter_failure");
    showToast("页面打开失败，请重试");
  } finally {
    isOpeningCreateFlow.value = false;
  }
}

async function handleBack() {
  reportStartEvent("back_exit");

  if (Taro.getCurrentPages().length > 1) {
    await Taro.navigateBack();
    return;
  }

  await Taro.reLaunch({
    url: "/pages/index/index",
  });
}

async function initializePage() {
  playFixedIntroSpeech();
  await ensureSessionRestored();

  if (isAuthenticated.value) {
    void prewarmAgentCreateMessengerSpeech();
  }

  const shouldAnimate = shouldAnimateAgentCreateIntro(
    readLastIntroCompletedDate(),
    new Date()
  );
  introMode = shouldAnimate ? "animated" : "skipped";
  reportStartEvent("exposure");

  if (shouldAnimate) {
    startIntroTypewriter();
    return;
  }

  showCompleteIntro();
  reportStartEvent("intro_complete");
}

onMounted(() => {
  void initializePage();
});

onUnmounted(() => {
  transitionRunId += 1;
  clearIntroTypeTimer();
  destroyIntroAudio();
});

</script>

<style lang="scss">
.agent-create-start {
  min-height: 100vh;
  color: #24222b;
  background: #f6f6f8;
}

.agent-create-start__workspace {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 28px 24px 24px;
  align-items: center;
  flex-direction: column;
}

.agent-create-start__messenger {
  display: flex;
  align-items: center;
  flex-direction: column;
  animation: agent-create-start-content-in 360ms ease-out both;
}

.agent-create-start__messenger-visual {
  position: relative;
  width: 104px;
  height: 104px;
  animation: agent-create-start-float 2.8s ease-in-out infinite;
  will-change: transform;
}

.agent-create-start__messenger-halo {
  position: absolute;
  inset: -24px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(132, 168, 255, 0.22) 0%,
    rgba(150, 115, 231, 0.1) 45%,
    rgba(246, 246, 248, 0) 72%
  );
  animation: agent-create-start-glow 2.8s ease-in-out infinite;
  will-change: opacity, transform;
}

.agent-create-start__messenger-image {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-shadow: 0 0 18px rgba(100, 127, 220, 0.2);
}

.agent-create-start__messenger-name {
  margin-top: 12px;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
}

.agent-create-start__messenger-desc {
  margin-top: 3px;
  color: #8a8791;
  font-size: 13px;
  line-height: 20px;
}

.agent-create-start__intro {
  box-sizing: border-box;
  display: flex;
  width: 100%;
  max-width: 420px;
  min-height: 132px;
  margin-top: 28px;
  padding: 18px 4px;
  justify-content: center;
  flex-direction: column;
  border-top: 1px solid #e9e8ed;
  border-bottom: 1px solid #e9e8ed;
  gap: 4px;
  animation: agent-create-start-content-in 400ms 80ms ease-out both;
}

.agent-create-start__intro-speech {
  display: flex;
  width: 40px;
  height: 40px;
  margin: 16px auto 0;
  padding: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: #f0eef5;
}

.agent-create-start__intro-speech::after {
  border: 0;
}

.agent-create-start__intro-speech--active {
  background: #302d3c;
}

.agent-create-start__intro-line {
  position: relative;
  display: block;
  width: 100%;
  min-height: 29px;
  color: #24222b;
  font-size: 18px;
  font-weight: 600;
  line-height: 29px;
  text-align: center;
  letter-spacing: 0;
}

.agent-create-start__intro-ghost {
  display: block;
  width: 100%;
  visibility: hidden;
}

.agent-create-start__intro-typed {
  position: absolute;
  inset: 0;
  width: 100%;
  line-height: 29px;
  text-align: center;
}

.agent-create-start__intro-stable {
  display: inline;
}

.agent-create-start__intro-char {
  display: inline-block;
  animation: agent-create-start-char-in 160ms ease-out both;
  will-change: opacity, transform;
}

.agent-create-start__hint {
  display: flex;
  margin-top: 20px;
  align-items: center;
  color: #77747f;
  font-size: 13px;
  line-height: 20px;
  gap: 8px;
  animation: agent-create-start-content-in 400ms 160ms ease-out both;
}

.agent-create-start__hint-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  border-radius: 50%;
  background: #297b69;
}

.agent-create-start__actions {
  display: flex;
  padding: 12px 16px;
  align-items: center;
  border-top: 1px solid #eeeef2;
  background: #ffffff;
}

.agent-create-start__primary-button {
  min-width: 0;
  --nut-button-primary-background-color: #297b69;
  --nut-button-primary-border-color: #297b69;
}

.agent-create-start__primary-button :deep(.nut-button__wrap) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.agent-create-start__transition {
  position: absolute;
  z-index: 130;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: rgba(246, 246, 248, 0.98);
  animation: agent-create-start-transition-in 220ms ease-out both;
}

.agent-create-start__transition-visual {
  position: relative;
  width: 94px;
  height: 94px;
  animation: agent-create-start-transition-rise 360ms ease-out both;
  will-change: opacity, transform;
}

.agent-create-start__transition-halo {
  position: absolute;
  inset: -26px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(132, 168, 255, 0.24) 0%,
    rgba(150, 115, 231, 0.1) 44%,
    rgba(246, 246, 248, 0) 72%
  );
  animation: agent-create-start-transition-glow 360ms ease-out both;
}

.agent-create-start__transition-image {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  box-shadow: 0 0 18px rgba(100, 127, 220, 0.2);
}

.agent-create-start__transition-text {
  margin-top: 22px;
  color: #55515d;
  font-size: 15px;
  line-height: 22px;
}

@keyframes agent-create-start-content-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes agent-create-start-char-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes agent-create-start-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-7px);
  }
}

@keyframes agent-create-start-glow {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(0.94);
  }

  50% {
    opacity: 1;
    transform: scale(1.08);
  }
}

@keyframes agent-create-start-transition-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@keyframes agent-create-start-transition-rise {
  from {
    opacity: 0.7;
    transform: translateY(10px) scale(0.92);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes agent-create-start-transition-glow {
  from {
    opacity: 0.42;
    transform: scale(0.9);
  }

  to {
    opacity: 1;
    transform: scale(1.08);
  }
}

@media (max-height: 680px) {
  .agent-create-start__workspace {
    padding-top: 18px;
  }

  .agent-create-start__messenger-visual {
    width: 88px;
    height: 88px;
  }

  .agent-create-start__intro {
    min-height: 116px;
    margin-top: 18px;
    padding: 12px 4px;
  }

  .agent-create-start__hint {
    margin-top: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-create-start__messenger,
  .agent-create-start__messenger-visual,
  .agent-create-start__messenger-halo,
  .agent-create-start__intro,
  .agent-create-start__intro-char,
  .agent-create-start__hint,
  .agent-create-start__transition,
  .agent-create-start__transition-visual,
  .agent-create-start__transition-halo {
    animation: none;
  }
}
</style>
