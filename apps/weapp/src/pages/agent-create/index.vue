<template>
  <page-scaffold
    class="agent-create-start"
    body-padding="0"
    :safe-area-bottom="false"
  >
    <image
      class="agent-create-start__bg"
      :src="agentStartImage"
      mode="aspectFill"
    />
    <view class="agent-create-start__shade" />
    <image
      class="agent-create-start__header"
      :src="headerLoadingImage"
      mode="aspectFit"
    />
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
    </view>
    <image
      class="agent-create-start__button"
      :src="startButtonImage"
      mode="widthFix"
      @tap="handleStart"
    />
    <view class="agent-create-start__top" :style="topBarStyle">
      <back-capsule class="agent-create-start__capsule" />
    </view>
    <login-prompt-popup
      v-model:visible="isLoginPromptVisible"
      @login-success="handleLoginSuccess"
    />
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'AgentCreateIndexPage',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import BackCapsule from '../../components/back-capsule/back-capsule.vue'
import LoginPromptPopup from '../../components/login-prompt-popup/login-prompt-popup.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'
import { readMenuButtonMetrics } from '../../utils/menu-button'
import { resolveMediaAssetUrl } from '../../utils/public-asset'

const agentStartImage = resolveMediaAssetUrl('/weapp/agent-guid2.png')
const headerLoadingImage = resolveMediaAssetUrl('/weapp/agent-create-header.png')
const startButtonImage = resolveMediaAssetUrl('/weapp/start.png')
const introLines = [
  '我是Ta的@未了言',
  '你的每句话，都在唤醒我的记忆',
  '准备唤醒我了吗?',
]
const introLineChars = introLines.map((line) => Array.from(line))
const introTypeInitialDelay = 360
const introTypeCharDelay = 112
const introTypeLineDelay = 420
const isLoginPromptVisible = ref(false)
const menuButtonMetrics = readMenuButtonMetrics()
const topBarStyle = {
  height: `${menuButtonMetrics.totalHeight}px`,
}
const isAuthenticated = computed(() => Boolean(authSession.value?.accessToken))
let introTypeTimer: ReturnType<typeof setTimeout> | undefined

interface VisibleIntroLineState {
  stableText: string
  activeChar: string
  activeKey: number
}

function createEmptyIntroLineStates(): VisibleIntroLineState[] {
  return introLines.map(() => ({
    stableText: '',
    activeChar: '',
    activeKey: 0,
  }))
}

const visibleIntroLineStates = ref(createEmptyIntroLineStates())

function clearIntroTypeTimer() {
  if (!introTypeTimer) {
    return
  }

  clearTimeout(introTypeTimer)
  introTypeTimer = undefined
}

function startIntroTypewriter() {
  clearIntroTypeTimer()
  visibleIntroLineStates.value = createEmptyIntroLineStates()

  let lineIndex = 0
  let charIndex = 0
  let activeKey = 0

  const typeNext = () => {
    const currentLineChars = introLineChars[lineIndex]

    if (!currentLineChars) {
      return
    }

    const nextChar = currentLineChars[charIndex]

    if (!nextChar) {
      return
    }

    visibleIntroLineStates.value = visibleIntroLineStates.value.map(
      (line, index) =>
        index === lineIndex
          ? {
              stableText: currentLineChars.slice(0, charIndex).join(''),
              activeChar: nextChar,
              activeKey: activeKey + 1,
            }
          : line
    )
    activeKey += 1

    if (charIndex < currentLineChars.length - 1) {
      charIndex += 1
      introTypeTimer = setTimeout(typeNext, introTypeCharDelay)
      return
    }

    const completedLineIndex = lineIndex
    introTypeTimer = setTimeout(() => {
      visibleIntroLineStates.value = visibleIntroLineStates.value.map(
        (line, index) =>
          index === completedLineIndex
            ? {
                stableText: currentLineChars.join(''),
                activeChar: '',
                activeKey,
              }
            : line
      )
      lineIndex += 1
      charIndex = 0

      if (lineIndex < introLines.length) {
        typeNext()
      }
    }, introTypeLineDelay)
  }

  introTypeTimer = setTimeout(typeNext, introTypeInitialDelay)
}

async function enterCreateFlow() {
  await Taro.redirectTo({
    url: '/pages/agent-create-flow/index',
  })
}

async function handleStart() {
  await restoreAuthSession()

  if (!isAuthenticated.value) {
    isLoginPromptVisible.value = true
    return
  }

  await enterCreateFlow()
}

async function handleLoginSuccess() {
  await restoreAuthSession()

  if (!isAuthenticated.value) {
    return
  }

  await enterCreateFlow()
}

onMounted(() => {
  startIntroTypewriter()
})

onUnmounted(() => {
  clearIntroTypeTimer()
})
</script>

<style lang="scss">
.agent-create-start {
  position: relative;
  min-height: 100vh;
  background: #060814;
}

.agent-create-start__bg,
.agent-create-start__shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.agent-create-start__shade {
  pointer-events: none;
  background: linear-gradient(
    180deg,
    rgba(6, 8, 20, 0.1) 0%,
    rgba(6, 8, 20, 0) 46%,
    rgba(6, 8, 20, 0.12) 100%
  );
}

.agent-create-start__top {
  position: relative;
  z-index: 4;
}

.agent-create-start__capsule {
  position: absolute;
  z-index: 5;
}

.agent-create-start__header {
  position: absolute;
  z-index: 2;
  top: 15%;
  left: 50%;
  display: block;
  width: 60px;
  height: 60px;
  pointer-events: none;
  transform: translateX(-50%);
}

.agent-create-start__intro {
  position: absolute;
  z-index: 2;
  top: 28%;
  left: 50%;
  display: flex;
  width: 100%;
  padding: 0 32px;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  pointer-events: none;
  transform: translateX(-50%);
}

.agent-create-start__intro-line {
  position: relative;
  display: inline-block;
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
  min-height: 24px;
  text-align: left;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
  white-space: nowrap;
}

.agent-create-start__intro-ghost {
  display: inline-block;
  visibility: hidden;
}

.agent-create-start__intro-typed {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 24px;
  line-height: 24px;
  overflow: hidden;
  text-align: left;
  white-space: nowrap;
}

.agent-create-start__intro-stable,
.agent-create-start__intro-char {
  display: inline-block;
}

.agent-create-start__intro-char {
  animation: agent-create-start-intro-char-in 180ms ease-out both;
  will-change: opacity, transform;
}

@keyframes agent-create-start-intro-char-in {
  from {
    opacity: 0;
    transform: translateY(2px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.agent-create-start__button {
  position: absolute;
  z-index: 3;
  top: 65%;
  left: 50%;
  display: block;
  width: 38%;
  transform: translate(-50%, -50%);
}

</style>
