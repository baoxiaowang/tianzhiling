<template>
  <page-scaffold
    class="dev-login-page"
    background="#f6f8fb"
    body-padding="0"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar
        title="调试登录"
        background="#ffffff"
        border-color="#edf0f5"
        back-home-url="/pages/contacts/index"
      />
    </template>

    <view class="dev-login">
      <view class="dev-login__panel">
        <view class="dev-login__heading">
          <text class="dev-login__title">Dev Login</text>
          <text
            class="dev-login__env"
            :class="{ 'dev-login__env--blocked': isRelease }"
          >
            当前版本：{{ envVersionLabel }}
          </text>
        </view>

        <view class="dev-login__field">
          <text class="dev-login__label">用户 Account</text>
          <view class="dev-login__control">
            <nut-input
              v-model="account"
              placeholder="输入 user_account.account"
              input-align="left"
              :border="false"
              clearable
            />
          </view>
        </view>

        <view class="dev-login__field">
          <text class="dev-login__label">用户 OpenID</text>
          <view class="dev-login__control">
            <nut-input
              v-model="openid"
              placeholder="输入用户 openid"
              input-align="left"
              :border="false"
              clearable
            />
          </view>
        </view>

        <nut-button
          class="dev-login__submit"
          block
          shape="round"
          type="primary"
          size="large"
          :loading="isSubmitting"
          :disabled="!canSubmit"
          @click="handleSubmit"
        >
          登录并复现
        </nut-button>

        <text v-if="isRelease" class="dev-login__warning">
          release 版本不可用。
        </text>
      </view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'DevLoginPage',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { computed, onMounted, ref } from 'vue'
import { ApiException, devLogin } from '../../auth/api'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'

const account = ref('')
const openid = ref('')
const isSubmitting = ref(false)
const envVersion = ref(readEnvVersion())

const trimmedAccount = computed(() => account.value.trim())
const trimmedOpenid = computed(() => openid.value.trim())
const isRelease = computed(() => envVersion.value === 'release')
const canSubmit = computed(() => {
  return (
    !isSubmitting.value &&
    !isRelease.value &&
    trimmedAccount.value.length > 0 &&
    trimmedOpenid.value.length > 0
  )
})
const envVersionLabel = computed(() => {
  switch (envVersion.value) {
    case 'develop':
      return '开发版'
    case 'trial':
      return '体验版'
    case 'release':
      return '正式版'
    default:
      return '未知'
  }
})

onMounted(() => {
  envVersion.value = readEnvVersion()
})

function readEnvVersion() {
  try {
    return Taro.getAccountInfoSync?.().miniProgram?.envVersion ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function resolveErrorMessage(error: unknown) {
  if (error instanceof ApiException) {
    return error.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return '调试登录失败'
}

async function handleSubmit() {
  if (!canSubmit.value) {
    return
  }

  isSubmitting.value = true

  try {
    await devLogin(trimmedAccount.value, trimmedOpenid.value)
    await Taro.showToast({
      title: '调试登录成功',
      icon: 'success',
      duration: 800,
    })
    await new Promise(resolve => setTimeout(resolve, 500))
    await Taro.switchTab({
      url: '/pages/contacts/index',
    })
  } catch (error) {
    showToast(resolveErrorMessage(error))
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style lang="scss">
.dev-login-page {
  min-height: 100vh;
}

.dev-login {
  box-sizing: border-box;
  min-height: 100%;
  padding: 32px 20px;
}

.dev-login__panel {
  box-sizing: border-box;
  padding: 24px 18px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #ffffff;
}

.dev-login__heading {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
}

.dev-login__title {
  color: #111827;
  font-size: 22px;
  font-weight: 700;
  line-height: 30px;
}

.dev-login__env {
  color: #64748b;
  font-size: 13px;
  line-height: 18px;
}

.dev-login__env--blocked {
  color: #dc2626;
}

.dev-login__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dev-login__field + .dev-login__field {
  margin-top: 16px;
}

.dev-login__label {
  color: #374151;
  font-size: 14px;
  line-height: 20px;
}

.dev-login__control {
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f9fafb;
}

.dev-login__submit {
  margin-top: 22px;
}

.dev-login__warning {
  display: block;
  margin-top: 12px;
  color: #dc2626;
  font-size: 13px;
  line-height: 18px;
}
</style>
