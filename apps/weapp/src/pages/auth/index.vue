<template>
  <view class="auth-fallback-page">
    <view v-if="!authSessionReady" class="auth-fallback-page__state">
      <view class="auth-fallback-page__dot" />
      <text class="auth-fallback-page__title">正在恢复登录状态...</text>
    </view>

    <view v-else class="auth-fallback-page__state">
      <image
        class="auth-fallback-page__logo"
        :src="loginLogoImage"
        mode="aspectFit"
      />
      <text class="auth-fallback-page__title">
        {{ session ? '已登录' : '登录后继续体验' }}
      </text>
      <text class="auth-fallback-page__subtitle">
        {{ session ? '正在进入未了言' : '使用微信授权登录' }}
      </text>
      <nut-button
        class="auth-fallback-page__action"
        shape="round"
        type="primary"
        :loading="isRedirecting"
        @click="handlePrimaryAction"
      >
        {{ session ? '进入应用' : '微信一键登录' }}
      </nut-button>
    </view>

    <login-prompt-popup
      v-model:visible="isLoginPromptVisible"
      @login-success="handleLoginSuccess"
    />
  </view>
</template>

<script lang="ts">
export default {
  name: 'AuthIndexPage',
}
</script>

<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import LoginPromptPopup from '../../components/login-prompt-popup/login-prompt-popup.vue'
import {
  authSession,
  authSessionReady,
  restoreAuthSession,
} from '../../auth/session'
import { redirectToIndexPage } from '../../utils/auth-guard'
import { resolveMediaAssetUrl } from '../../utils/public-asset'

const isLoginPromptVisible = shallowRef(false)
const isRedirecting = shallowRef(false)
const loginLogoImage = resolveMediaAssetUrl('/weapp/logo.png')
const session = computed(() => authSession.value)

async function enterApp() {
  if (isRedirecting.value) {
    return
  }

  isRedirecting.value = true

  try {
    await redirectToIndexPage()
  } finally {
    isRedirecting.value = false
  }
}

function openLoginPrompt() {
  isLoginPromptVisible.value = true
}

function handlePrimaryAction() {
  if (session.value) {
    void enterApp()
    return
  }

  openLoginPrompt()
}

function handleLoginSuccess() {
  void enterApp()
}

onMounted(async () => {
  await restoreAuthSession()

  if (authSession.value) {
    void enterApp()
    return
  }

  openLoginPrompt()
})
</script>

<style lang="scss">
.auth-fallback-page {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 96px 24px 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $tzl-color-surface-base;
}

.auth-fallback-page__state {
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  text-align: center;
}

.auth-fallback-page__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.auth-fallback-page__logo {
  width: 72px;
  height: 72px;
  display: block;
  border-radius: 50%;
}

.auth-fallback-page__title {
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
  color: $tzl-color-text-primary;
}

.auth-fallback-page__subtitle {
  font-size: 13px;
  line-height: 20px;
  color: $tzl-color-text-muted;
}

.auth-fallback-page__action {
  width: 220px;
  margin-top: 8px;
}
</style>
