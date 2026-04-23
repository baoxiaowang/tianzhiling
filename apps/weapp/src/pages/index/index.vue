<template>
  <page-scaffold
    class="home-page"
    body-padding="0"
    :safe-area-bottom="false"
  >
    <view v-if="isCheckingAuth || isRedirecting" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">
        {{ isRedirecting ? '正在前往登录页...' : '正在恢复首页...' }}
      </text>
    </view>

    <view v-else-if="session" class="home-shell">
      <view class="home-shell__content">
        <scroll-view v-show="activeTab === 'moments'" scroll-y class="panel-scroll">
          <view class="empty-panel">
            <text class="empty-panel__title">朋友圈</text>
          </view>
        </scroll-view>

        <scroll-view v-show="activeTab === 'contacts'" scroll-y class="panel-scroll">
          <view class="empty-panel">
            <text class="empty-panel__title">通讯录</text>
          </view>
        </scroll-view>

        <scroll-view v-show="activeTab === 'me'" scroll-y class="panel-scroll">
          <view class="empty-panel">
            <text class="empty-panel__title">我的</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <template v-if="session" #bottom>
      <view class="tabbar">
        <view
          v-for="item in tabItems"
          :key="item.key"
          class="tabbar__item"
          :class="{ 'is-active': activeTab === item.key }"
          @tap="activeTab = item.key"
        >
          <view class="tabbar__icon" :class="`tabbar__icon--${item.key}`">
            <view class="tabbar__shape" />
          </view>
          <text class="tabbar__label">{{ item.label }}</text>
        </view>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'HomeIndexPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, onMounted, ref } from 'vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'

type HomeTabKey = 'moments' | 'contacts' | 'me'

const tabItems = [
  { key: 'moments', label: '朋友圈' },
  { key: 'contacts', label: '通讯录' },
  { key: 'me', label: '我的' },
] as const satisfies Array<{ key: HomeTabKey; label: string }>

const activeTab = ref<HomeTabKey>('moments')
const isCheckingAuth = ref(true)
const isRedirecting = ref(false)

let ensureSessionPromise: Promise<void> | null = null

const session = computed(() => authSession.value)

async function redirectToAuth() {
  isRedirecting.value = true
  await Taro.reLaunch({
    url: '/pages/auth/index',
  })
}

async function ensureAuthenticated() {
  if (ensureSessionPromise) {
    return ensureSessionPromise
  }

  ensureSessionPromise = Promise.resolve()
    .then(async () => {
      isCheckingAuth.value = true
      await restoreAuthSession()

      if (!authSession.value) {
        await redirectToAuth()
        return
      }

      isRedirecting.value = false
      isCheckingAuth.value = false
    })
    .finally(() => {
      ensureSessionPromise = null

      if (authSession.value) {
        isCheckingAuth.value = false
      }
    })

  return ensureSessionPromise
}

onMounted(() => {
  void ensureAuthenticated()
})

useDidShow(() => {
  void ensureAuthenticated()
})
</script>

<style lang="scss">
.home-page {
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

.home-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.home-shell__content {
  flex: 1;
  min-height: 0;
}

.panel-scroll {
  box-sizing: border-box;
  height: 100%;
  padding: 24px 18px 110px;
}

.empty-panel {
  min-height: calc(100vh - 180px);
  border-radius: 24px;
  border: 1px solid $tzl-color-border-light;
  background: rgba(255, 255, 255, 0.5);
}

.empty-panel__title {
  display: block;
  padding: 20px 18px;
  font-size: 24px;
  line-height: 1.1;
  font-weight: 700;
  color: $tzl-color-text-primary;
}

.tabbar {
  position: sticky;
  bottom: 0;
  z-index: 10;
  display: flex;
  padding: 8px 10px calc(env(safe-area-inset-bottom) + 8px);
  border-top: 1px solid rgba(17, 24, 39, 0.06);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(14px);
}

.tabbar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding-top: 6px;
  color: $tzl-color-text-soft;
}

.tabbar__item.is-active {
  color: $tzl-color-primary-deep;
}

.tabbar__label {
  font-size: 12px;
  font-weight: 600;
}

.tabbar__icon {
  position: relative;
  width: 28px;
  height: 28px;
}

.tabbar__shape {
  position: absolute;
  inset: 0;
}

.tabbar__icon--moments .tabbar__shape {
  border: 1.5px solid currentColor;
  border-radius: 50%;
}

.tabbar__icon--moments .tabbar__shape::after {
  content: '';
  position: absolute;
  left: 8px;
  top: 8px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
}

.tabbar__icon--contacts .tabbar__shape::before,
.tabbar__icon--contacts .tabbar__shape::after {
  content: '';
  position: absolute;
  left: 5px;
  right: 5px;
  height: 5px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
}

.tabbar__icon--contacts .tabbar__shape::before {
  top: 5px;
}

.tabbar__icon--contacts .tabbar__shape::after {
  bottom: 5px;
}

.tabbar__icon--me .tabbar__shape::before,
.tabbar__icon--me .tabbar__shape::after {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.tabbar__icon--me .tabbar__shape::before {
  top: 4px;
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
}

.tabbar__icon--me .tabbar__shape::after {
  bottom: 3px;
  width: 18px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  border-bottom: none;
}
</style>
