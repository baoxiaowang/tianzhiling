<template>
  <view class="page">
    <view v-if="!authSessionReady" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">正在恢复登录状态...</text>
    </view>

    <template v-else-if="session">
      <view class="profile-card">
        <view class="profile-card__badge">已登录</view>
        <view class="profile-card__header">
          <image
            v-if="session.user.avatar"
            class="profile-card__avatar"
            :src="session.user.avatar"
            mode="aspectFill"
          />
          <view v-else class="profile-card__avatar profile-card__avatar--fallback">
            {{ avatarFallback }}
          </view>
          <view class="profile-card__meta">
            <text class="profile-card__name">{{ displayName }}</text>
            <text class="profile-card__subline">账号：{{ displayAccount }}</text>
            <text class="profile-card__subline">手机号：{{ displayPhone }}</text>
          </view>
        </view>

        <view v-if="session.isNewUser" class="profile-card__hint">
          首次登录成功，已自动为你创建账号。
        </view>

        <view class="profile-card__footer">
          <text class="profile-card__expiry">
            登录有效期至 {{ formatExpiry(session.expiresAt) }}
          </text>
          <view class="profile-card__actions">
            <view class="primary-action" @tap="handleEnterApp">
              进入应用
            </view>
            <view
              class="secondary-action"
              :class="{ 'is-disabled': isRefreshingProfile }"
              @tap="handleRefreshProfile"
            >
              {{ isRefreshingProfile ? '刷新中...' : '刷新用户信息' }}
            </view>
            <view
              class="danger-action"
              :class="{ 'is-disabled': isLoggingOut }"
              @tap="handleLogout"
            >
              {{ isLoggingOut ? '退出中...' : '退出登录' }}
            </view>
          </view>
        </view>
      </view>
    </template>

    <template v-else>
      <view class="hero">
        <text class="hero__eyebrow">Hello!</text>
        <text class="hero__title">欢迎使用天之灵</text>
        <text class="hero__desc">
          先完成登录，再进入朋友圈、通讯录和我的页面。当前支持短信验证码登录/注册与密码登录。
        </text>
      </view>

      <nut-tabs
        v-model="mode"
        class="auth-tabs"
        :title-gutter="18"
        :ellipsis="false"
        size="large"
        :animated-time="320"
        :auto-height="true"
        align="left"
        background="transparent"
      >
        <nut-tab-pane title="手机号登录/注册" pane-key="phone">
          <view class="auth-card">
            <view class="field">
              <text class="field__label">手机号</text>
              <view class="field__control">
                <nut-input
                  v-model="phone"
                  class="field__input"
                  type="number"
                  placeholder="请输入手机号"
                  :max-length="11"
                  input-align="left"
                  :border="false"
                  clearable
                />
              </view>
            </view>

            <view class="field">
              <text class="field__label">验证码</text>
              <view class="field__row">
                <view class="field__control field__control--code">
                  <nut-input
                    v-model="code"
                    class="field__input"
                    type="number"
                    placeholder="请输入验证码"
                    :max-length="6"
                    input-align="left"
                    :border="false"
                    clearable
                  />
                </view>
                <nut-button
                  class="code-button"
                  shape="round"
                  type="primary"
                  :disabled="!canSendCode"
                  @click="handleSendCode"
                >
                  {{ sendCodeLabel }}
                </nut-button>
              </view>
            </view>

            <nut-button
              class="submit-button"
              block
              shape="round"
              type="primary"
              size="large"
              :loading="isSubmitting"
              :disabled="!canSubmit"
              @click="handleSubmit"
            >
              登录
            </nut-button>
          </view>
        </nut-tab-pane>

        <nut-tab-pane title="密码登录" pane-key="password">
          <view class="auth-card">
            <view class="field">
              <text class="field__label">手机号</text>
              <view class="field__control">
                <nut-input
                  v-model="phone"
                  class="field__input"
                  type="number"
                  placeholder="请输入手机号"
                  :max-length="11"
                  input-align="left"
                  :border="false"
                  clearable
                />
              </view>
            </view>

            <view class="field">
              <text class="field__label">密码</text>
              <view class="field__control">
                <nut-input
                  v-model="password"
                  class="field__input"
                  type="password"
                  placeholder="请输入密码"
                  input-align="left"
                  :border="false"
                />
              </view>
            </view>

            <nut-button
              class="submit-button"
              block
              shape="round"
              type="primary"
              size="large"
              :loading="isSubmitting"
              :disabled="!canSubmit"
              @click="handleSubmit"
            >
              登录
            </nut-button>
          </view>
        </nut-tab-pane>
      </nut-tabs>

      <view class="agreement">
        <nut-checkbox
          v-model="agreed"
          class="agreement__control"
          shape="round"
          text-position="right"
          :icon-size="9"
        >
          我已阅读并同意《天之灵用户服务协议》及《隐私政策》
        </nut-checkbox>
      </view>
    </template>
  </view>
</template>

<script lang="ts">
export default {
  name: 'AuthIndexPage',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ApiException,
  getCurrentUser,
  logout,
  passwordLogin,
  phoneLogin,
  sendSmsCode,
} from '../../auth/api'
import {
  authSession,
  authSessionReady,
  clearAuthSession,
  restoreAuthSession,
} from '../../auth/session'

type AuthMode = 'phone' | 'password'

const CHINA_PHONE_REGEXP = /^1[3-9]\d{9}$/

const mode = ref<AuthMode>('phone')
const phone = ref('')
const code = ref('')
const password = ref('')
const agreed = ref(true)
const isSubmitting = ref(false)
const isSendingCode = ref(false)
const isLoggingOut = ref(false)
const isRefreshingProfile = ref(false)
const codeCooldownSeconds = ref(0)

let codeCooldownTimer: ReturnType<typeof setInterval> | null = null

const session = computed(() => authSession.value)
const isPhoneValid = computed(() => CHINA_PHONE_REGEXP.test(phone.value.trim()))
const canSendCode = computed(() => {
  return isPhoneValid.value && !isSendingCode.value && codeCooldownSeconds.value === 0
})
const sendCodeLabel = computed(() => {
  if (isSendingCode.value) {
    return '发送中...'
  }

  if (codeCooldownSeconds.value > 0) {
    return `${codeCooldownSeconds.value}s`
  }

  return '获取验证码'
})
const canSubmit = computed(() => {
  if (!agreed.value || !isPhoneValid.value || isSubmitting.value) {
    return false
  }

  return mode.value === 'phone'
    ? code.value.trim().length === 6
    : password.value.trim().length > 0
})
const displayName = computed(() => {
  const name = session.value?.user.name.trim()
  return name ? name : '天之灵用户'
})
const displayAccount = computed(() => {
  const account = session.value?.user.account.trim()
  return account ? account : '未设置'
})
const displayPhone = computed(() => {
  const phoneValue = session.value?.user.phone.trim()
  return phoneValue ? phoneValue : '未绑定'
})
const avatarFallback = computed(() => displayName.value.slice(0, 1))

function showToast(message: string) {
  void Taro.showToast({
    title: message,
    icon: 'none',
    duration: 2400,
  })
}

function formatExpiry(value: number) {
  if (!value) {
    return '未知'
  }

  const date = new Date(value)
  const parts = [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, '0'),
    `${date.getDate()}`.padStart(2, '0'),
  ]
  const time = [
    `${date.getHours()}`.padStart(2, '0'),
    `${date.getMinutes()}`.padStart(2, '0'),
  ]

  return `${parts.join('-')} ${time.join(':')}`
}

async function handleEnterApp() {
  await Taro.reLaunch({
    url: '/pages/index/index',
  })
}

function resetCountdown() {
  if (codeCooldownTimer) {
    clearInterval(codeCooldownTimer)
    codeCooldownTimer = null
  }

  codeCooldownSeconds.value = 0
}

function startCodeCooldown(seconds: number) {
  resetCountdown()
  codeCooldownSeconds.value = seconds

  codeCooldownTimer = setInterval(() => {
    if (codeCooldownSeconds.value <= 1) {
      resetCountdown()
      return
    }

    codeCooldownSeconds.value -= 1
  }, 1000)
}

async function handleSendCode() {
  if (!isPhoneValid.value) {
    showToast('请输入正确的中国大陆手机号')
    return
  }

  if (isSendingCode.value || codeCooldownSeconds.value > 0) {
    return
  }

  isSendingCode.value = true

  try {
    const result = await sendSmsCode(phone.value.trim())
    startCodeCooldown(result.resendAfterSeconds)

    const debugCodeHint = result.debugCode ? `，测试验证码：${result.debugCode}` : ''
    showToast(`验证码已发送，请注意查收${debugCodeHint}`)
  } catch (error) {
    if (error instanceof ApiException) {
      showToast(error.message)
      return
    }

    showToast('验证码发送失败，请稍后重试')
  } finally {
    isSendingCode.value = false
  }
}

async function handleSubmit() {
  if (!canSubmit.value) {
    if (!agreed.value) {
      showToast('请先勾选用户协议与隐私政策')
      return
    }

    if (!isPhoneValid.value) {
      showToast('请输入正确的中国大陆手机号')
      return
    }

    showToast(mode.value === 'phone' ? '请输入 6 位短信验证码' : '请输入手机号和密码')
    return
  }

  isSubmitting.value = true

  try {
    if (mode.value === 'phone') {
      const result = await phoneLogin(phone.value.trim(), code.value.trim())
      showToast(result.isNewUser ? '首次登录成功，已为你创建账号' : '登录成功')
      code.value = ''
    } else {
      await passwordLogin(phone.value.trim(), password.value.trim())
      showToast('登录成功')
      password.value = ''
    }

    await handleEnterApp()
  } catch (error) {
    if (error instanceof ApiException) {
      showToast(error.message)
      return
    }

    showToast('登录失败，请稍后重试')
  } finally {
    isSubmitting.value = false
  }
}

async function handleRefreshProfile() {
  if (!session.value || isRefreshingProfile.value) {
    return
  }

  isRefreshingProfile.value = true

  try {
    await getCurrentUser()
    showToast('用户信息已刷新')
  } catch (error) {
    if (error instanceof ApiException) {
      showToast(error.message)
      return
    }

    showToast('刷新失败，请稍后重试')
  } finally {
    isRefreshingProfile.value = false
  }
}

async function handleLogout() {
  if (!session.value || isLoggingOut.value) {
    return
  }

  isLoggingOut.value = true

  try {
    await logout()
    await clearAuthSession()
    showToast('已退出登录')
  } catch (error) {
    if (error instanceof ApiException) {
      if (error.requiresReLogin) {
        await clearAuthSession()
      }

      showToast(error.message)
      return
    }

    showToast('退出登录失败，请稍后重试')
  } finally {
    isLoggingOut.value = false
  }
}

onMounted(async () => {
  await restoreAuthSession()

  if (authSession.value) {
    void handleRefreshProfile()
  }
})

onUnmounted(() => {
  resetCountdown()
})
</script>

<style lang="scss">
.page {
  min-height: 100vh;
  padding: 24px 18px 32px;
}

.loading-state {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.loading-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 499.5px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.loading-state__text {
  font-size: 14px;
  color: $tzl-color-text-muted;
}

.hero {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 26px;
}

.hero__eyebrow {
  font-size: 38px;
  line-height: 1;
  font-weight: 700;
  color: $tzl-color-text-primary;
  letter-spacing: -1px;
}

.hero__title {
  font-size: 20px;
  line-height: 1.2;
  font-weight: 600;
  color: $tzl-color-text-secondary;
}

.hero__desc {
  font-size: 13px;
  line-height: 1.6;
  color: $tzl-color-text-muted;
}

.auth-card,
.profile-card {
  padding: 18px 16px;
  border: 1px solid $tzl-color-border-light;
  border-radius: 16px;
  background: $tzl-color-surface-card;
  box-shadow: $tzl-shadow-card;
  backdrop-filter: blur(12px);
}

.auth-tabs {
  margin-bottom: 14px;
  --nut-tabs-titles-background-color: transparent;
  --nut-tabs-horizontal-titles-height: 27px;
  --nut-tabs-titles-item-font-size: 17px;
  --nut-tabs-titles-item-active-color: #{$tzl-color-text-primary};
  --nut-tabs-titles-item-color: #{$tzl-color-text-soft};
  --nut-tabs-horizontal-titles-item-active-line-width: 48px;
  --nut-tabs-horizontal-tab-line-color: #{$tzl-color-primary};
}

.auth-tabs :deep(.nut-tabs__titles) {
  margin-bottom: 16px;
}

.auth-tabs :deep(.nut-tabs__titles-item) {
  width: auto;
  min-width: 0;
  justify-content: flex-start;
  font-weight: 500;
}

.auth-tabs :deep(.nut-tabs__titles-item.active) {
  font-weight: 700;
}

.auth-tabs :deep(.nut-tabs__titles-item__text.ellipsis) {
  width: auto !important;
  max-width: none !important;
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: nowrap;
}

.field + .field {
  margin-top: 12px;
}

.field__label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: $tzl-color-text-muted;
}

.field__row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.field__control {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 48px;
  padding: 0 12px;
  border: 1px solid $tzl-color-border-soft;
  border-radius: 12px;
  background: $tzl-color-surface-base;
  box-sizing: border-box;
  box-shadow: $tzl-shadow-inset-soft;
}

.field__control :deep(.nut-input) {
  width: 100%;
  padding: 0;
  line-height: 46px;
  background: transparent;
}

.field__control :deep(.nut-input-value),
.field__control :deep(.nut-input-inner),
.field__control :deep(.nut-input-box) {
  width: 100%;
}

.field__control :deep(.nut-input-inner),
.field__control :deep(.nut-input-box) {
  display: flex;
  align-items: center;
}

.field__control :deep(.input-text) {
  width: 100%;
  height: 46px;
  padding: 0;
  line-height: 46px;
  font-size: 15px;
  color: $tzl-color-text-primary;
}

.field__control :deep(.input-text::placeholder) {
  color: $tzl-color-text-soft;
}

.field__control--code {
  flex: 1 1 auto;
  min-width: 0;
}

.submit-button,
.primary-action,
.secondary-action,
.danger-action {
  display: flex;
  align-items: center;
  justify-content: center;
}

.code-button {
  flex-shrink: 0;
  min-width: 92px;
  height: 48px;
  padding: 0 12px;
  border-radius: 12px;
  background: $tzl-gradient-primary;
  color: $tzl-color-surface-base;
  font-size: 14px;
  font-weight: 500;
  box-shadow: $tzl-shadow-primary-md;
  --nut-button-default-padding: 0 12px;
  --nut-button-border-radius: 12px;
  --nut-button-primary-background-color: #{$tzl-gradient-primary};
}

.code-button :deep(.nut-button__text) {
  margin-left: 0;
}

.code-button.nut-button--disabled,
.submit-button.is-disabled,
.secondary-action.is-disabled,
.danger-action.is-disabled {
  opacity: 0.56;
}

.submit-button {
  margin-top: 16px;
  box-shadow: $tzl-shadow-primary-lg;
  --nut-button-large-height: 50px;
  --nut-button-large-line-height: 49px;
  --nut-button-large-font-size: 16px;
  --nut-button-border-radius: 499.5px;
  --nut-button-primary-background-color: #{$tzl-gradient-primary};
}

.submit-button :deep(.nut-button__text) {
  margin-left: 0;
  letter-spacing: 0.5px;
}

.agreement {
  margin-top: 14px;
  padding: 4px 2px 0 0;
}

.agreement__control {
  margin-right: 0;
  --nut-checkbox-label-margin-left: 8px;
  --nut-checkbox-icon-font-size: 11px;
  --nut-checkbox-label-font-size: 12px;
  --nut-checkbox-label-color: #{$tzl-color-text-muted};
  --nut-primary-color: #{$tzl-color-primary};
}

.agreement__control :deep(.nut-checkbox) {
  display: flex;
  align-items: flex-start;
  margin-right: 0;
}

.agreement__control :deep(.nut-checkbox__icon) {
  margin-top: 1px;
}

.agreement__control :deep(.nut-checkbox__label) {
  line-height: 1.6;
}

.profile-card {
  position: relative;
}

.profile-card__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 10px;
  margin-bottom: 14px;
  border-radius: 499.5px;
  background: $tzl-color-primary-soft;
  color: $tzl-color-primary-deep;
  font-size: 12px;
  font-weight: 600;
}

.profile-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.profile-card__avatar {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: $tzl-color-surface-subtle;
}

.profile-card__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: $tzl-gradient-warm;
  color: $tzl-color-surface-base;
  font-size: 22px;
  font-weight: 700;
}

.profile-card__meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.profile-card__name {
  font-size: 20px;
  font-weight: 700;
  color: $tzl-color-text-primary;
}

.profile-card__subline {
  font-size: 13px;
  color: $tzl-color-text-muted;
}

.profile-card__hint {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 12px;
  background: $tzl-color-surface-warm;
  color: $tzl-color-warning-text;
  font-size: 12px;
  line-height: 1.6;
}

.profile-card__footer {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid $tzl-color-border-soft;
}

.profile-card__expiry {
  display: block;
  margin-bottom: 12px;
  font-size: 12px;
  color: $tzl-color-text-soft;
}

.profile-card__actions {
  display: flex;
  gap: 10px;
}

.primary-action,
.secondary-action,
.danger-action {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
}

.primary-action {
  background: $tzl-gradient-primary;
  color: $tzl-color-surface-base;
  box-shadow: $tzl-shadow-primary-md;
}

.secondary-action {
  background: $tzl-color-surface-subtle;
  color: $tzl-color-text-secondary;
}

.danger-action {
  background: $tzl-color-surface-danger;
  color: $tzl-color-danger-text;
}
</style>
