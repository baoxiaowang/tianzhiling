<template>
  <view class="page-scaffold" :style="rootStyle">
    <view
      v-if="hasHeader"
      class="page-scaffold__header"
      :class="{ 'page-scaffold__header--safe-top': safeAreaTop }"
      :style="headerStyle"
    >
      <slot name="header" />
    </view>

    <scroll-view
      v-if="scroll && canRenderDefaultSlot"
      :scroll-y="true"
      class="page-scaffold__body page-scaffold__body--scroll"
      :style="bodyStyle"
      :scroll-into-view="scrollIntoView"
      :scroll-with-animation="scrollWithAnimation"
      :show-scrollbar="showScrollbar"
    >
      <slot />
    </scroll-view>

    <view
      v-else-if="canRenderDefaultSlot"
      class="page-scaffold__body"
      :class="{ 'page-scaffold__body--safe-bottom': safeAreaBottom && !hasVisibleBottom }"
      :style="bodyStyle"
    >
      <slot />
    </view>

    <view
      v-else
      class="page-scaffold__body page-scaffold__body--auth"
      :class="{ 'page-scaffold__body--safe-bottom': safeAreaBottom && !hasVisibleBottom }"
      :style="bodyStyle"
    >
      <view v-if="isAuthRestoring" class="page-scaffold__auth-state">
        <view class="page-scaffold__auth-dot" />
        <text class="page-scaffold__auth-text">{{ authLoadingText }}</text>
      </view>

      <view v-else class="page-scaffold__login-placeholder">
        <view class="page-scaffold__login-avatar">{{ loginPlaceholderAvatar }}</view>
        <text class="page-scaffold__login-title">{{ loginPlaceholderTitle }}</text>
        <text class="page-scaffold__login-subtitle">{{ loginPlaceholderSubtitle }}</text>
        <nut-button
          class="page-scaffold__login-button"
          shape="round"
          type="primary"
          @click="openLoginPrompt"
        >
          {{ loginPlaceholderActionText }}
        </nut-button>
      </view>
    </view>

    <view
      v-if="hasVisibleBottom"
      class="page-scaffold__bottom"
      :class="{ 'page-scaffold__bottom--safe-bottom': safeAreaBottom }"
      :style="bottomStyle"
    >
      <slot name="bottom" />
    </view>

    <view
      v-if="canRenderDefaultSlot && hasFloating"
      class="page-scaffold__floating"
      :class="{ 'page-scaffold__floating--safe-bottom': safeAreaBottom && !hasVisibleBottom }"
    >
      <view class="page-scaffold__floating-content">
        <slot name="floating" />
      </view>
    </view>

    <login-prompt-popup v-model:visible="isLoginPromptVisible" />
  </view>
</template>

<script lang="ts">
export default {
  name: 'PageScaffold',
}
</script>

<script setup lang="ts">
import { computed, ref, useSlots, watch } from 'vue'
import LoginPromptPopup from '../login-prompt-popup/login-prompt-popup.vue'
import { authSession, authSessionReady, restoreAuthSession } from '../../auth/session'
import { createSafeAreaCssVars } from '../../utils/safe-area'

const props = withDefaults(
  defineProps<{
    background?: string
    headerBackground?: string
    bottomBackground?: string
    bodyPadding?: string
    scroll?: boolean
    scrollIntoView?: string
    scrollWithAnimation?: boolean
    showScrollbar?: boolean
    safeAreaTop?: boolean
    safeAreaBottom?: boolean
    requireAuth?: boolean
    authLoadingText?: string
    loginPlaceholderAvatar?: string
    loginPlaceholderTitle?: string
    loginPlaceholderSubtitle?: string
    loginPlaceholderActionText?: string
  }>(),
  {
    background: 'transparent',
    headerBackground: '',
    bottomBackground: '',
    bodyPadding: '0',
    scroll: false,
    scrollIntoView: '',
    scrollWithAnimation: false,
    showScrollbar: true,
    safeAreaTop: true,
    safeAreaBottom: true,
    requireAuth: false,
    authLoadingText: '正在恢复登录状态...',
    loginPlaceholderAvatar: '灵',
    loginPlaceholderTitle: '请先登录',
    loginPlaceholderSubtitle: '登录后可查看个人资料、动态和订单信息',
    loginPlaceholderActionText: '去登录',
  },
)

const slots = useSlots()

const hasHeader = computed(() => Boolean(slots.header))
const hasBottom = computed(() => Boolean(slots.bottom))
const hasFloating = computed(() => Boolean(slots.floating))
const isLoginPromptVisible = ref(false)
const isAuthenticated = computed(() => Boolean(authSession.value))
const isAuthRestoring = computed(() => props.requireAuth && !authSessionReady.value)
const canRenderDefaultSlot = computed(() => !props.requireAuth || isAuthenticated.value)
const hasVisibleBottom = computed(() => canRenderDefaultSlot.value && hasBottom.value)

function openLoginPrompt() {
  isLoginPromptVisible.value = true
}

function closeLoginPrompt() {
  isLoginPromptVisible.value = false
}

defineExpose({
  closeLoginPrompt,
  openLoginPrompt,
})

watch(
  () => props.requireAuth,
  (requireAuth) => {
    if (requireAuth) {
      void restoreAuthSession()
    }
  },
  { immediate: true },
)

const resolveSectionBackground = (background: string | undefined) => {
  return background && background.trim() ? background : props.background
}

const expandPadding = (padding: string): [string, string, string, string] => {
  const values = padding.trim().split(/\s+/).filter(Boolean)

  if (values.length === 0) {
    return ['0', '0', '0', '0']
  }

  if (values.length === 1) {
    return [values[0], values[0], values[0], values[0]]
  }

  if (values.length === 2) {
    return [values[0], values[1], values[0], values[1]]
  }

  if (values.length === 3) {
    return [values[0], values[1], values[2], values[1]]
  }

  return [values[0], values[1], values[2], values[3]]
}

const rootStyle = computed(() => {
  return {
    background: props.background,
    ...createSafeAreaCssVars('page-scaffold-safe'),
  }
})

const headerStyle = computed(() => {
  return {
    background: resolveSectionBackground(props.headerBackground),
  }
})

const bottomStyle = computed(() => {
  return {
    background: resolveSectionBackground(props.bottomBackground),
  }
})

const bodyStyle = computed(() => {
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = expandPadding(props.bodyPadding)

  return {
    paddingTop,
    paddingRight,
    paddingBottom:
      props.safeAreaBottom && !hasVisibleBottom.value
        ? `calc(${paddingBottom} + var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom)))`
        : paddingBottom,
    paddingLeft,
  }
})
</script>

<style lang="scss">
.page-scaffold {
  position: relative;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-scaffold__header {
  flex-shrink: 0;
}

.page-scaffold__header--safe-top {
  padding-top: constant(safe-area-inset-top);
  padding-top: env(safe-area-inset-top);
  padding-top: var(--page-scaffold-safe-top, env(safe-area-inset-top));
}

.page-scaffold__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.page-scaffold__body--scroll {
  flex: 1;
  min-height: 0;
}

.page-scaffold__body > * {
  min-height: 0;
}

.page-scaffold__body--safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom));
}

.page-scaffold__body--auth {
  background: inherit;
}

.page-scaffold__auth-state {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.page-scaffold__auth-dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.page-scaffold__auth-text {
  font-size: 14px;
  color: $tzl-color-text-muted;
}

.page-scaffold__login-placeholder {
  min-height: 100%;
  padding: 88px 28px 120px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.page-scaffold__login-avatar {
  width: 72px;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: $tzl-gradient-primary;
  color: $tzl-color-surface-base;
  font-size: 42px;
  line-height: 1;
  font-weight: 700;
  box-shadow: $tzl-shadow-primary-md;
}

.page-scaffold__login-title {
  margin-top: 22px;
  font-size: 23px;
  line-height: 31px;
  font-weight: 700;
  color: $tzl-color-text-primary;
}

.page-scaffold__login-subtitle {
  max-width: 260px;
  margin-top: 8px;
  font-size: 14px;
  line-height: 21px;
  color: $tzl-color-text-muted;
}

.page-scaffold__login-button {
  width: 180px;
  height: 48px;
  margin-top: 28px;
  background: $tzl-gradient-primary;
  font-size: 16px;
  font-weight: 700;
  box-shadow: $tzl-shadow-primary-lg;
  --nut-button-border-radius: 999px;
  --nut-button-primary-background-color: #{$tzl-gradient-primary};
}

.page-scaffold__bottom {
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.page-scaffold__bottom--safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom));
}

.page-scaffold__floating {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
}

.page-scaffold__floating--safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom));
}

.page-scaffold__floating-content {
  pointer-events: auto;
}
</style>
