<template>
  <nut-popup
    v-model:visible="visible"
    class="login-prompt-popup"
    position="bottom"
    round
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

      <nut-button
        class="login-prompt__wechat"
        block
        shape="round"
        type="primary"
        @click="handlePendingLogin"
      >
        <view class="login-prompt__wechat-icon">
          <text class="login-prompt__wechat-dot login-prompt__wechat-dot--large" />
          <text class="login-prompt__wechat-dot login-prompt__wechat-dot--small" />
        </view>
        <text>小程序授权登录</text>
      </nut-button>

      <nut-button
        class="login-prompt__phone"
        block
        shape="round"
        plain
        @click="handlePendingLogin"
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
          <text class="login-prompt__link">《天之灵用户服务协议》</text>
          及
          <text class="login-prompt__link">《隐私政策》</text>
        </nut-checkbox>
      </view>

      <view class="login-prompt__skip" @tap="handleClose">
        点击遮罩或下滑可暂不登录
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

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
}>()

const agreed = ref(true)

const visible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value),
})

function handleClose() {
  visible.value = false
}

function handlePendingLogin() {
  void Taro.showToast({
    title: '登录功能稍后接入',
    icon: 'none',
    duration: 1600,
  })
}
</script>

<style lang="scss">
.login-prompt-popup {
  overflow: visible;
  background: transparent;
}

.login-prompt {
  padding: 36px 28px 28px;
  border-radius: 28px 28px 0 0;
  background: $tzl-color-surface-base;
}

.login-prompt__handle {
  width: 36px;
  height: 4px;
  margin: -18px auto 26px;
  border-radius: 999px;
  background: #d1d5db;
}

.login-prompt__intro {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 28px;
}

.login-prompt__logo {
  flex-shrink: 0;
  width: 62px;
  height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: $tzl-gradient-primary;
  color: $tzl-color-surface-base;
  font-size: 40px;
  line-height: 1;
  font-weight: 700;
  box-shadow: $tzl-shadow-primary-md;
}

.login-prompt__copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.login-prompt__title {
  font-size: 24px;
  line-height: 32px;
  font-weight: 700;
  color: $tzl-color-text-primary;
}

.login-prompt__subtitle {
  font-size: 14px;
  line-height: 21px;
  color: $tzl-color-text-muted;
}

.login-prompt__wechat,
.login-prompt__phone {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 58px;
  font-size: 19px;
  font-weight: 700;
  --nut-button-border-radius: 999px;
  --nut-button-default-padding: 0 18px;
}

.login-prompt__wechat {
  margin-bottom: 14px;
  background: $tzl-gradient-primary;
  border: 0;
  box-shadow: $tzl-shadow-primary-lg;
  --nut-button-primary-background-color: #{$tzl-gradient-primary};
}

.login-prompt__wechat .nut-button__wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.login-prompt__wechat-icon {
  position: relative;
  width: 34px;
  height: 24px;
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
  width: 21px;
  height: 17px;
}

.login-prompt__wechat-dot--small {
  right: 0;
  bottom: 0;
  width: 17px;
  height: 14px;
}

.login-prompt__phone {
  margin-bottom: 22px;
  border: 1px solid #d1d5db;
  background: $tzl-color-surface-base;
  color: $tzl-color-text-primary;
}

.login-prompt__phone .nut-button__text,
.login-prompt__wechat .nut-button__text {
  margin-left: 0;
}

.login-prompt__agreement {
  margin-bottom: 26px;
  --nut-checkbox-label-margin-left: 8px;
  --nut-checkbox-icon-font-size: 11px;
  --nut-checkbox-label-font-size: 13px;
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
  line-height: 20px;
}

.login-prompt__link {
  color: #f4511e;
}

.login-prompt__skip {
  text-align: center;
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-text-soft;
}
</style>
