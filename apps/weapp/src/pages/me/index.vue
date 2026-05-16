<template>
  <page-scaffold
    class="me-tab-page"
    body-padding="0"
    background="#efeff4"
    :safe-area-top="false"
    :safe-area-bottom="false"
    require-auth
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
            <view class="me-profile__name-row">
              <text class="me-profile__name">{{ displayName }}</text>
              <view v-if="isVipUser" class="me-profile__vip-badge">
                <text>VIP</text>
              </view>
            </view>
            <text class="me-profile__account">ID：{{ displayAccount }}</text>
          </view>

          <view class="me-arrow" />
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
              <view class="me-menu-item__right">
                <text
                  v-if="action.title === '我的消息' && unreadMessageCountText"
                  class="me-menu-item__badge"
                >
                  {{ unreadMessageCountText }}
                </text>
                <view class="me-arrow" />
              </view>
            </view>
            <view
              v-if="index !== primaryMenuActions.length - 1"
              class="me-menu-section__divider"
            />
          </view>
        </view>

        <view class="me-page__spacer" />

        <view class="me-menu-section">
          <view class="me-feature-item" @tap="handleMenuTap('VIP 服务')">
            <text class="me-feature-item__label">VIP 服务</text>
            <view class="me-feature-item__right">
              <text class="me-feature-item__value">{{ vipServiceText }}</text>
              <view class="me-arrow me-arrow--muted" />
            </view>
          </view>
          <view class="me-feature-item" @tap="handleMenuTap('声音模型')">
            <text class="me-feature-item__label">声音模型</text>
            <view class="me-feature-item__right">
              <view class="me-voice-stack">
                <view
                  v-for="agent in voicePreviewAgents"
                  :key="agent.id"
                  class="me-voice-stack__avatar"
                >
                  <image
                    v-if="agent.avatar"
                    class="me-voice-stack__avatar-image"
                    :src="agent.avatar"
                    mode="aspectFill"
                  />
                  <text v-else>{{ buildAgentFallback(agent.name) }}</text>
                </view>
              </view>
              <text class="me-feature-item__value">{{ voiceModelCountText }}</text>
              <view class="me-arrow me-arrow--muted" />
            </view>
          </view>
        </view>

        <view class="me-page__spacer" />

        <view class="me-menu-section">
          <view
            v-for="(action, index) in serviceMenuActions"
            :key="action.title"
            class="me-menu-section__item"
            @tap="handleMenuTap(action.title)"
          >
            <view class="me-menu-item">
              <text class="me-menu-item__label">{{ action.title }}</text>
              <view class="me-arrow" />
            </view>
            <view
              v-if="index !== serviceMenuActions.length - 1"
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
import { getAgents, type AgentSummary } from '../../apis/agent'
import { getCurrentUser } from '../../auth/api'
import { authSession, restoreAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { unreadCommentNotificationCount } from '../../post/comment-notification-state'
import { openAgreementDocument } from '../../utils/agreement-nav'
import { showPendingToast } from '../../utils/auth-guard'
import { syncCustomTabBar } from '../../utils/custom-tab-bar'

interface ProfileMenuAction {
  title: string
}

const primaryMenuActions = [
  { title: '我的消息' },
  { title: '我的动态' },
  { title: '我的订单' },
] as const satisfies ProfileMenuAction[]

const serviceMenuActions = [
  { title: '联系客服' },
  { title: '服务协议' },
] as const satisfies ProfileMenuAction[]

const isCheckingAuth = ref(true)
const agents = ref<AgentSummary[]>([])
const hasLoadedProfile = ref(false)

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
const isVipUser = computed(() => Boolean(session.value?.user.isVip))
const vipServiceText = computed(() => {
  return isVipUser.value ? '已开启' : '未开通'
})
const voicePreviewAgents = computed(() => agents.value.slice(0, 4))
const enabledVoiceModelCount = computed(() => {
  return agents.value.filter((agent) => agent.voiceTimbreId.trim()).length
})
const voiceModelCountText = computed(() => {
  return `${enabledVoiceModelCount.value}/${agents.value.length}`
})
const unreadMessageCountText = computed(() => {
  const count = unreadCommentNotificationCount.value

  if (count <= 0) {
    return ''
  }

  return count > 99 ? '99+' : String(count)
})

function buildAgentFallback(name: string) {
  const trimmedName = name.trim()
  return trimmedName ? trimmedName.slice(0, 1) : '灵'
}

async function handleMenuTap(title: string) {
  if (title === '我的消息') {
    await Taro.navigateTo({
      url: '/pages/my-messages/index',
    })
    return
  }

  if (title === '我的动态') {
    await Taro.navigateTo({
      url: '/pages/my-posts/index',
    })
    return
  }

  if (title === '我的订单') {
    await Taro.navigateTo({
      url: '/pages/my-orders/index',
    })
    return
  }

  if (title === 'VIP 服务') {
    await Taro.navigateTo({
      url: '/pages/vip-center/index',
    })
    return
  }

  if (title === '声音模型') {
    await Taro.navigateTo({
      url: '/pages/voice-package/index',
    })
    return
  }

  if (title === '联系客服') {
    await Taro.navigateTo({
      url: '/pages/customer-service/index',
    })
    return
  }

  if (title === '服务协议') {
    await openAgreementDocument('service')
    return
  }

  showPendingToast(`${title} 页面待接入`)
}

async function handleProfileTap() {
  await Taro.navigateTo({
    url: '/pages/user-settings/index',
  })
}

async function refreshProfile() {
  if (refreshProfilePromise) {
    return refreshProfilePromise
  }

  refreshProfilePromise = Promise.all([
    getCurrentUser().catch(() => undefined),
    getAgents()
      .then((items) => {
        agents.value = items
      })
      .catch(() => {
        agents.value = []
      }),
  ])
    .then(() => undefined)
    .finally(() => {
      refreshProfilePromise = null
    })

  return refreshProfilePromise
}

async function preparePage() {
  if (!hasLoadedProfile.value) {
    isCheckingAuth.value = true
  }

  await restoreAuthSession()

  if (authSession.value) {
    await refreshProfile()
  }

  hasLoadedProfile.value = true
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
  background: #efeff4;
}

.me-page {
  min-height: 100%;
  padding-bottom: 110px;
  background: #efeff4;
}

.me-page__spacer {
  height: 10px;
  background: #efeff4;
}

.me-profile {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 120px;
  box-sizing: border-box;
  padding: 0 16px 0 18px;
  background: #ffffff;
}

.me-profile__avatar {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  background: $tzl-color-surface-subtle;
}

.me-profile__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
  color: #ffffff;
  font-size: 28px;
  font-weight: 700;
}

.me-profile__meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
}

.me-profile__name-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.me-profile__name {
  min-width: 0;
  flex-shrink: 1;
  font-size: 20px;
  line-height: 29px;
  font-weight: 600;
  color: #000000;
  letter-spacing: -0.08px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.me-profile__vip-badge {
  flex-shrink: 0;
  height: 17px;
  padding: 0 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #2c1d12 0%, #8a5728 100%);
  color: #ffe7ba;
  font-size: 10px;
  line-height: 17px;
  font-weight: 800;
}

.me-profile__account {
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  color: #999999;
  letter-spacing: -0.08px;
}

.me-menu-section {
  background: #ffffff;
}

.me-menu-section__item {
  background: #ffffff;
}

.me-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
  box-sizing: border-box;
}

.me-menu-item__label {
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: #333333;
  letter-spacing: -0.31px;
}

.me-menu-item__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.me-menu-item__badge {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  box-sizing: border-box;
  border-radius: 999px;
  background: #ff4d4f;
  color: #ffffff;
  font-size: 11px;
  line-height: 18px;
  font-weight: 600;
  text-align: center;
}

.me-menu-section__divider {
  height: 1px;
  margin-left: 20px;
  margin-right: 19px;
  background: #ebebeb;
  transform: scaleY(0.5);
  transform-origin: center bottom;
}

.me-feature-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 58px;
  box-sizing: border-box;
  padding: 0 16px;
  border-bottom: 0.5px solid #e5e5e5;
  background: #ffffff;
}

.me-feature-item__label {
  flex-shrink: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: #0a0a0a;
  letter-spacing: -0.31px;
}

.me-feature-item__right {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.me-feature-item__value {
  flex-shrink: 0;
  font-size: 14px;
  line-height: 24px;
  color: #999999;
  letter-spacing: -0.31px;
}

.me-voice-stack {
  display: flex;
  align-items: center;
  gap: 4px;
}

.me-voice-stack__avatar {
  width: 28px;
  height: 28px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #ff7f61;
  border-radius: 999px;
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
  color: #ffffff;
  font-size: 12px;
  line-height: 28px;
  font-weight: 700;
}

.me-voice-stack__avatar-image {
  width: 100%;
  height: 100%;
  border-radius: 999px;
}

.me-arrow {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  margin-right: 3px;
  border-top: 1.5px solid #cfcfcf;
  border-right: 1.5px solid #cfcfcf;
  transform: rotate(45deg);
}

.me-arrow--muted {
  border-color: #c8c8c8;
}
</style>
