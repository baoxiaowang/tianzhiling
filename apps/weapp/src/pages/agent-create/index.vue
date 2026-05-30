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
      <text class="agent-create-start__intro-line agent-create-start__intro-line--1">
        我是Ta的@天之灵
      </text>
      <text class="agent-create-start__intro-line agent-create-start__intro-line--2">
        你的每句话，都在唤醒我的记忆
      </text>
      <text class="agent-create-start__intro-line agent-create-start__intro-line--3">
        准备唤醒我了吗?
      </text>
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
import { computed, ref } from 'vue'
import BackCapsule from '../../components/back-capsule/back-capsule.vue'
import LoginPromptPopup from '../../components/login-prompt-popup/login-prompt-popup.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'
import { readMenuButtonMetrics } from '../../utils/menu-button'
import { resolveMediaAssetUrl } from '../../utils/public-asset'

const agentStartImage = resolveMediaAssetUrl('/weapp/agent-guid2.png')
const headerLoadingImage = resolveMediaAssetUrl('/weapp/agent-create-header.png')
const startButtonImage = resolveMediaAssetUrl('/weapp/start.png')
const isLoginPromptVisible = ref(false)
const menuButtonMetrics = readMenuButtonMetrics()
const topBarStyle = {
  height: `${menuButtonMetrics.totalHeight}px`,
}
const isAuthenticated = computed(() => Boolean(authSession.value?.accessToken))

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
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  line-height: 24px;
  opacity: 0;
  text-align: center;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
  transform: translateY(8px);
  animation: agent-create-intro-line-in 520ms ease-out forwards;
}

.agent-create-start__intro-line--1 {
  animation-delay: 220ms;
}

.agent-create-start__intro-line--2 {
  animation-delay: 760ms;
}

.agent-create-start__intro-line--3 {
  animation-delay: 1300ms;
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

@keyframes agent-create-intro-line-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
