<template>
  <nut-popup
    v-model:visible="visible"
    class="login-prompt-popup"
    position="bottom"
    round
    :z-index="10000"
    :close-on-click-overlay="true"
    :safe-area-inset-bottom="true"
  >
    <view class="login-prompt">
      <view class="login-prompt__handle" />

      <view class="login-prompt__intro">
        <view class="login-prompt__logo">灵</view>
        <view class="login-prompt__copy">
          <text class="login-prompt__title">登录后继续体验</text>
          <text class="login-prompt__subtitle">授权后可同步资料、使用聊天和个人中心</text>
        </view>
      </view>

      <button
        class="login-prompt__wechat"
        :open-type="agreed ? 'getPhoneNumber' : ''"
        :disabled="isLoggingIn"
        @click="handlePhoneBindButtonTap"
        @getphonenumber="handlePhoneNumberLogin"
      >
        <text>{{ isLoggingIn ? '绑定中...' : '授权手机号登录' }}</text>
      </button>

      <nut-button
        class="login-prompt__phone"
        block
        shape="round"
        plain
        @click="handlePhoneLogin"
      >
        手机号登录
      </nut-button>

      <view class="login-prompt__agreement">
        <nut-checkbox
          v-model="agreed"
          shape="round"
          text-position="right"
          :icon-size="10"
        >
          我已阅读并同意
          <text class="login-prompt__link" @tap.stop="handleAgreementTap('service')">
            《天之灵用户服务协议》
          </text>
          及
          <text class="login-prompt__link" @tap.stop="handleAgreementTap('privacy')">
            《隐私政策》
          </text>
        </nut-checkbox>
      </view>

    </view>
  </nut-popup>
</template>

<script lang="ts">
export default {
  name: 'LoginPromptPopup',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { computed, ref } from 'vue'
import { useLoginHooks } from '../../auth/login-hooks'
import type { AgreementDocumentType } from '../../legal/agreement-documents'
import { openAgreementDocument } from '../../utils/agreement-nav'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits({
  'update:visible': (_value: boolean) => true,
  'login-success': () => true,
})

const agreed = ref(false)
const {
  isLoggingIn,
  loginErrorMessage,
  loginWithWeappPhone,
} = useLoginHooks()

const visible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value),
})

function ensureAgreed() {
  if (agreed.value) {
    return true
  }

  void Taro.showToast({
    title: '请先阅读并同意协议',
    icon: 'none',
    duration: 1600,
  })

  return false
}

function handlePhoneBindButtonTap() {
  if (!agreed.value) {
    ensureAgreed()
  }
}

async function handlePhoneNumberLogin(event: {
  detail?: {
    code?: string
    errMsg?: string
  }
}) {
  if (!ensureAgreed() || isLoggingIn.value) {
    return
  }

  const phoneCode = event.detail?.code?.trim()

  if (!phoneCode) {
    void Taro.showToast({
      title: event.detail?.errMsg?.includes('deny')
        ? '已取消手机号授权'
        : '请授权手机号后继续登录',
      icon: 'none',
      duration: 1800,
    })
    return
  }

  try {
    await loginWithWeappPhone(phoneCode)
    emit('login-success')
    visible.value = false
    void Taro.showToast({
      title: '登录成功',
      icon: 'success',
      duration: 1400,
    })
  } catch {
    void Taro.showToast({
      title: loginErrorMessage.value || '授权登录失败，请稍后重试',
      icon: 'none',
      duration: 2200,
    })
  }
}

function handlePhoneLogin() {
  if (!ensureAgreed()) {
    return
  }

  visible.value = false
  void Taro.navigateTo({
    url: '/pages/auth/index',
  })
}

function handleAgreementTap(type: AgreementDocumentType) {
  void openAgreementDocument(type)
}
</script>

<style lang="scss">
.login-prompt-popup {
  overflow: visible;
  background: transparent;
}

.login-prompt {
  box-sizing: border-box;
  width: 100%;
  padding: 12px 24px 24px;
  border-radius: 22px 22px 0 0;
  background: $tzl-color-surface-base;
  box-shadow: 0 -8px 28px rgba(15, 23, 42, 0.08);
}

.login-prompt__handle {
  width: 36px;
  height: 5px;
  margin: 0 auto 32px;
  border-radius: 999px;
  background: #d8dde4;
}

.login-prompt__intro {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 26px;
}

.login-prompt__logo {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: $tzl-gradient-primary;
  color: $tzl-color-surface-base;
  font-size: 38px;
  line-height: 1;
  font-weight: 700;
  box-shadow: 0 8px 18px rgba(255, 96, 58, 0.18);
}

.login-prompt__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-prompt__title {
  font-size: 20px;
  line-height: 31px;
  font-weight: 700;
  color: $tzl-color-text-primary;
}

.login-prompt__subtitle {
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-text-muted;
}

.login-prompt__wechat,
.login-prompt__phone {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 52px;
  font-size: 18px;
  font-weight: 700;
  --nut-button-border-radius: 999px;
  --nut-button-default-padding: 0 16px;
}

.login-prompt__wechat {
  margin-bottom: 12px;
  background: $tzl-gradient-primary;
  border: 0;
  border-radius: 999px;
  color: $tzl-color-surface-base;
  line-height: 52px;
  box-shadow: 0 9px 18px rgba(255, 96, 58, 0.2);
  --nut-button-primary-background-color: #{$tzl-gradient-primary};
}

.login-prompt__wechat::after {
  border: 0;
}

.login-prompt__wechat-icon {
  position: relative;
  width: 30px;
  height: 22px;
}

.login-prompt__wechat-dot {
  position: absolute;
  display: block;
  border-radius: 50%;
  background: $tzl-color-surface-base;
}

.login-prompt__wechat-dot--large {
  left: 0;
  top: 1px;
  width: 19px;
  height: 16px;
}

.login-prompt__wechat-dot--small {
  right: 0;
  bottom: 0;
  width: 15px;
  height: 13px;
}

.login-prompt__phone {
  margin-bottom: 20px;
  border: 1px solid #d6dae1;
  background: $tzl-color-surface-base;
  color: $tzl-color-text-primary;
}

.login-prompt__phone .nut-button__text,
.login-prompt__wechat .nut-button__text {
  margin-left: 0;
}

.login-prompt__agreement {
  padding-bottom: 2px;
  --nut-checkbox-label-margin-left: 8px;
  --nut-checkbox-icon-font-size: 11px;
  --nut-checkbox-label-font-size: 12px;
  --nut-checkbox-label-color: #{$tzl-color-text-muted};
  --nut-primary-color: #{$tzl-color-primary};
}

.login-prompt__agreement .nut-checkbox {
  align-items: flex-start;
  margin-right: 0;
}

.login-prompt__agreement .nut-checkbox__icon {
  margin-top: 2px;
}

.login-prompt__agreement .nut-checkbox__label {
  line-height: 19px;
}

.login-prompt__link {
  color: #f4511e;
}
</style>
