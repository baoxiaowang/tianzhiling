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
    <view class="agent-create-start__top" :style="topBarStyle">
      <back-capsule class="agent-create-start__capsule" />
    </view>
    <view class="agent-create-start__tap-zone" @tap="handleStart" />
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
import { resolvePublicAssetUrl } from '../../utils/public-asset'

const agentStartImage = resolvePublicAssetUrl('/public/weapp/agent-start.jpg')
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
  z-index: 1;
}

.agent-create-start__capsule {
  position: absolute;
  z-index: 2;
}

.agent-create-start__tap-zone {
  position: absolute;
  z-index: 2;
  left: 19%;
  right: 19%;
  bottom: calc(env(safe-area-inset-bottom) + 112px);
  height: 228px;
}
</style>
