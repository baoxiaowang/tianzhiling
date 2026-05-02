<template>
  <page-scaffold
    class="me-tab-page"
    body-padding="0"
    background="#f7f7f7"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <template #header>
      <app-bar
        title="我的"
        background="#ffffff"
        :show-capsule="false"
      />
    </template>

    <view v-if="isCheckingAuth" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">
        正在恢复个人中心...
      </text>
    </view>

    <scroll-view v-else-if="session" scroll-y class="me-scroll">
      <view class="me-page">
        <view class="me-profile" @tap="handleProfileTap">
          <image
            v-if="avatarUrl"
            class="me-profile__avatar"
            :src="avatarUrl"
            mode="aspectFill"
          />
          <view v-else class="me-profile__avatar me-profile__avatar--fallback">
            {{ avatarFallback }}
          </view>

          <view class="me-profile__meta">
            <text class="me-profile__name">{{ displayName }}</text>
            <text class="me-profile__account">ID：{{ displayAccount }}</text>
          </view>

          <view class="me-profile__arrow" />
        </view>

        <view class="me-page__spacer" />

        <view class="me-menu-section">
          <view
            v-for="(action, index) in primaryMenuActions"
            :key="action.title"
            class="me-menu-section__item"
            @tap="handleMenuTap(action.title)"
          >
            <view class="me-menu-item">
              <text class="me-menu-item__label">{{ action.title }}</text>
              <view class="me-menu-item__arrow" />
            </view>
            <view
              v-if="index !== primaryMenuActions.length - 1"
              class="me-menu-section__divider"
            />
          </view>
        </view>

        <view class="me-page__spacer" />

        <view class="me-menu-section">
          <view
            v-for="(action, index) in secondaryMenuActions"
            :key="action.title"
            class="me-menu-section__item"
            @tap="handleMenuTap(action.title)"
          >
            <view class="me-menu-item">
              <text class="me-menu-item__label">{{ action.title }}</text>
              <view class="me-menu-item__arrow" />
            </view>
            <view
              v-if="index !== secondaryMenuActions.length - 1"
              class="me-menu-section__divider"
            />
          </view>
        </view>
      </view>
    </scroll-view>

    <view v-else class="me-login-placeholder">
      <view class="me-login-placeholder__avatar">灵</view>
      <text class="me-login-placeholder__title">请先登录</text>
      <text class="me-login-placeholder__subtitle">登录后可查看个人资料、动态和订单信息</text>
      <nut-button
        class="me-login-placeholder__button"
        shape="round"
        type="primary"
        @click="handleLoginPromptTap"
      >
        去登录
      </nut-button>
    </view>

    <login-prompt-popup v-model:visible="isLoginPromptVisible" />
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'MeTabPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { getCurrentUser } from '../../auth/api'
import { authSession, restoreAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import LoginPromptPopup from '../../components/login-prompt-popup/login-prompt-popup.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { showPendingToast } from '../../utils/auth-guard'
import { syncCustomTabBar } from '../../utils/custom-tab-bar'

interface ProfileMenuAction {
  title: string
}

const primaryMenuActions = [
  { title: '我的动态' },
  { title: '现金券' },
  { title: '订单管理' },
  { title: '我的邀请' },
  { title: '联系客服' },
] as const satisfies ProfileMenuAction[]

const secondaryMenuActions = [
  { title: '服务协议' },
  { title: '系统通知' },
] as const satisfies ProfileMenuAction[]

const isCheckingAuth = ref(true)
const isLoginPromptVisible = ref(false)

let refreshProfilePromise: Promise<void> | null = null

const session = computed(() => authSession.value)
const displayName = computed(() => {
  const name = session.value?.user.name.trim()
  return name ? name : '妮妮'
})
const displayAccount = computed(() => {
  const account = session.value?.user.account.trim()
  return account ? account : '12345678'
})
const avatarUrl = computed(() => session.value?.user.avatar.trim() ?? '')
const avatarFallback = computed(() => displayName.value.slice(0, 1))

async function handleMenuTap(title: string) {
  if (!session.value) {
    isLoginPromptVisible.value = true
    return
  }

  if (title === '我的动态') {
    await Taro.navigateTo({
      url: '/pages/my-posts/index',
    })
    return
  }

  showPendingToast(`${title} 页面待接入`)
}

async function handleProfileTap() {
  if (!session.value) {
    isLoginPromptVisible.value = true
    return
  }

  await Taro.navigateTo({
    url: '/pages/user-settings/index',
  })
}

function handleLoginPromptTap() {
  isLoginPromptVisible.value = true
}

async function refreshProfile() {
  if (refreshProfilePromise) {
    return refreshProfilePromise
  }

  refreshProfilePromise = getCurrentUser()
    .catch(() => undefined)
    .then(() => undefined)
    .finally(() => {
      refreshProfilePromise = null
    })

  return refreshProfilePromise
}

async function preparePage() {
  isCheckingAuth.value = true

  await restoreAuthSession()

  if (authSession.value) {
    await refreshProfile()
  }

  isCheckingAuth.value = false
}

useDidShow(() => {
  syncCustomTabBar('/pages/me/index')
  void preparePage()
})
</script>

<style lang="scss">
.me-tab-page {
  min-height: 100vh;
}

.loading-state {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.loading-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.loading-state__text {
  font-size: 14px;
  color: $tzl-color-text-muted;
}

.me-scroll {
  box-sizing: border-box;
  height: 100%;
}

.me-page {
  min-height: 100%;
  padding-bottom: 110px;
  background: #f7f7f7;
}

.me-login-placeholder {
  min-height: calc(100vh - 88px);
  padding: 88px 28px 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: #f7f7f7;
}

.me-login-placeholder__avatar {
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

.me-login-placeholder__title {
  margin-top: 22px;
  font-size: 23px;
  line-height: 31px;
  font-weight: 700;
  color: $tzl-color-text-primary;
}

.me-login-placeholder__subtitle {
  max-width: 260px;
  margin-top: 8px;
  font-size: 14px;
  line-height: 21px;
  color: $tzl-color-text-muted;
}

.me-login-placeholder__button {
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

.me-page__spacer {
  height: 10px;
  background: #f7f7f7;
}

.me-profile {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 141px;
  padding: 0 16px;
  background: $tzl-color-surface-base;
}

.me-profile__avatar {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  border-radius: 14px;
  background: $tzl-color-surface-subtle;
}

.me-profile__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: $tzl-gradient-warm;
  color: $tzl-color-surface-base;
  font-size: 26px;
  font-weight: 700;
}

.me-profile__meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.me-profile__name {
  font-size: 18px;
  line-height: 27px;
  font-weight: 600;
  color: #1a1a1a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-profile__account {
  font-size: 13px;
  line-height: 19.5px;
  color: #999999;
}

.me-profile__arrow {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  margin-right: 3px;
  border-top: 1.5px solid #cfcfcf;
  border-right: 1.5px solid #cfcfcf;
  transform: rotate(45deg);
}

.me-menu-section {
  background: $tzl-color-surface-base;
}

.me-menu-section__item {
  background: $tzl-color-surface-base;
}

.me-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
}

.me-menu-item__label {
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: #333333;
}

.me-menu-item__arrow {
  width: 8px;
  height: 8px;
  margin-right: 3px;
  border-top: 1.5px solid #cfcfcf;
  border-right: 1.5px solid #cfcfcf;
  transform: rotate(45deg);
}

.me-menu-section__divider {
  height: 0.5px;
  margin-left: 16px;
  background: #ebebeb;
}
</style>
