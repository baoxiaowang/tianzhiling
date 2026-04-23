<template>
  <page-scaffold
    class="me-tab-page"
    body-padding="0"
    background="#f7f7f7"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <view v-if="isCheckingAuth || isRedirecting" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">
        {{ isRedirecting ? '正在前往登录页...' : '正在恢复个人中心...' }}
      </text>
    </view>

    <scroll-view v-else-if="session" scroll-y class="me-scroll">
      <view class="me-page">
        <view class="me-profile">
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
import { authSession } from '../../auth/session'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage, showPendingToast } from '../../utils/auth-guard'
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
const isRedirecting = ref(false)

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
  if (title === '我的动态') {
    await Taro.navigateTo({
      url: '/pages/my-posts/index',
    })
    return
  }

  showPendingToast(`${title} 页面待接入`)
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

  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated || !authSession.value) {
    isRedirecting.value = true
    await redirectToAuthPage()
    return
  }

  isRedirecting.value = false
  await refreshProfile()
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
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.me-profile__name {
  font-size: 18px;
  line-height: 27px;
  font-weight: 600;
  color: #1a1a1a;
}

.me-profile__account {
  font-size: 13px;
  line-height: 19.5px;
  color: #999999;
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
