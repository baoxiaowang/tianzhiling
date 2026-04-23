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
        <scroll-view v-show="activeTab === 'moments'" scroll-y class="moments-scroll">
          <view class="moments-banner">
            <view class="moments-banner__star-glow" />
            <text class="moments-banner__star">★</text>
            <view class="moments-banner__dust moments-banner__dust--left" />
            <view class="moments-banner__dust moments-banner__dust--right" />
            <view class="moments-banner__dust moments-banner__dust--bottom" />
            <view class="moments-banner__body">
              <view class="moments-banner__headline">
                <text class="moments-banner__title">快速了解天之灵AI</text>
                <text class="moments-banner__arrow">›</text>
              </view>
              <text class="moments-banner__subtitle">和另一片星空的人，首视频互动</text>
            </view>
          </view>

          <view class="banner-indicator">
            <view class="banner-indicator__dot banner-indicator__dot--active" />
            <view class="banner-indicator__dot" />
          </view>

          <view class="moments-notice">
            <image
              class="moments-notice__avatar"
              :src="notificationAvatarUrl"
              mode="aspectFill"
            />
            <text class="moments-notice__text">{{ notificationText }}</text>
          </view>

          <view class="moments-content">
            <view class="moment-card">
              <view class="moment-card__header">
                <image
                  class="moment-card__avatar"
                  :src="momentsDesign.post.avatarUrl"
                  mode="aspectFill"
                />
                <view class="moment-card__meta">
                  <text class="moment-card__author">{{ momentsDesign.post.author }}</text>
                  <text class="moment-card__body-text">{{ momentsDesign.post.content }}</text>
                </view>
              </view>

              <image
                class="moment-card__image"
                :src="momentsDesign.post.imageUrl"
                mode="aspectFill"
              />

              <view class="moment-card__stats">
                <text class="moment-card__time">{{ momentsDesign.post.time }}</text>
                <view class="moment-card__actions">
                  <view class="moment-card__action">
                    <text class="moment-card__action-icon">♡</text>
                    <text class="moment-card__action-count">{{ momentsDesign.post.likes }}</text>
                  </view>
                  <view class="moment-card__action">
                    <text class="moment-card__action-icon">◌</text>
                    <text class="moment-card__action-count">{{ momentsDesign.post.comments }}</text>
                  </view>
                </view>
              </view>

              <view class="moment-card__comments">
                <view
                  v-for="comment in momentsDesign.post.commentList"
                  :key="comment.id"
                  class="moment-card__comment"
                >
                  <text class="moment-card__comment-author">{{ comment.author }}</text>
                  <text class="moment-card__comment-text">{{ comment.content }}</text>
                </view>
              </view>
            </view>
          </view>
        </scroll-view>

        <scroll-view v-show="activeTab === 'contacts'" scroll-y class="panel-scroll">
          <view class="empty-panel">
            <text class="empty-panel__title">通讯录</text>
          </view>
        </scroll-view>

        <scroll-view v-show="activeTab === 'me'" scroll-y class="panel-scroll panel-scroll--me">
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

    <template v-if="session && activeTab === 'moments'" #floating>
      <view class="publish-fab-anchor">
        <view class="publish-fab" @tap="handleFeaturePending('发布动态')">
          <view class="publish-fab__plus">
            <view class="publish-fab__line publish-fab__line--horizontal" />
            <view class="publish-fab__line publish-fab__line--vertical" />
          </view>
          <text class="publish-fab__label">发布</text>
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
import {
  getCommentNotificationSummary,
  type PostCommentNotificationSummary,
} from '../../apis/post'
import { getCurrentUser } from '../../auth/api'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'

type HomeTabKey = 'moments' | 'contacts' | 'me'

interface MomentComment {
  id: string
  author: string
  content: string
}

interface MomentPost {
  author: string
  avatarUrl: string
  content: string
  imageUrl: string
  time: string
  likes: number
  comments: number
  commentList: MomentComment[]
}

interface ProfileMenuAction {
  title: string
}

const tabItems = [
  { key: 'moments', label: '朋友圈' },
  { key: 'contacts', label: '通讯录' },
  { key: 'me', label: '我的' },
] as const satisfies Array<{ key: HomeTabKey; label: string }>

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

const momentsDesign = {
  notificationAvatarUrl: 'https://www.figma.com/api/mcp/asset/f41f54cc-8bf1-440c-9c03-648deafeb2d1',
  post: {
    author: '柠檬',
    avatarUrl: 'https://www.figma.com/api/mcp/asset/245d5202-c1ef-49a7-9d99-874da30534ca',
    content:
      '外公，今天看到了好美的荷花，想起以前我们在院子里种的那些花儿，牡丹，月季，君子兰，茉莉。',
    imageUrl: 'https://www.figma.com/api/mcp/asset/af0c2530-3775-4e9e-b5da-faf6054359f1',
    time: '6分钟前',
    likes: 99,
    comments: 99,
    commentList: [
      {
        id: 'c1',
        author: '孙传侠：',
        content: '仪金金啊，看到这荷花，外公心里也暖暖的呢，想起你们子里那些郁郁花',
      },
      {
        id: 'c2',
        author: '柠檬回复孙传侠：',
        content: '仪是啊，我重喜欢这荷花，能一起赏花就好了',
      },
    ],
  },
} as const satisfies { notificationAvatarUrl: string; post: MomentPost }

const activeTab = ref<HomeTabKey>('moments')
const isCheckingAuth = ref(true)
const isRedirecting = ref(false)
const notificationSummary = ref<PostCommentNotificationSummary | null>(null)

let ensureSessionPromise: Promise<void> | null = null
let refreshHomePromise: Promise<void> | null = null

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
const notificationAvatarUrl = computed(() => {
  const latestAvatar = notificationSummary.value?.latest?.actorAvatar.trim()
  return latestAvatar ? latestAvatar : momentsDesign.notificationAvatarUrl
})
const notificationText = computed(() => {
  const unreadCount = notificationSummary.value?.unreadCount ?? 0

  return unreadCount > 0 ? `${unreadCount}条新消息` : '暂无新消息'
})

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

function handleFeaturePending(featureName: string) {
  showToast(`${featureName} 待接入`)
}

async function handleMenuTap(title: string) {
  if (title === '我的动态') {
    await Taro.navigateTo({
      url: '/pages/my-posts/index',
    })
    return
  }

  showToast(`${title} 页面待接入`)
}

function showToast(message: string) {
  void Taro.showToast({
    title: message,
    icon: 'none',
    duration: 1800,
  })
}

async function refreshHomeData() {
  if (refreshHomePromise) {
    return refreshHomePromise
  }

  refreshHomePromise = Promise.all([
    getCurrentUser().catch(() => undefined),
    getCommentNotificationSummary()
      .then((summary) => {
        notificationSummary.value = summary
      })
      .catch(() => undefined),
  ])
    .then(async () => {
      if (!authSession.value) {
        await redirectToAuth()
      }
    })
    .finally(() => {
      refreshHomePromise = null
    })

  return refreshHomePromise
}

async function prepareHomePage() {
  await ensureAuthenticated()

  if (!authSession.value) {
    return
  }

  await refreshHomeData()
}

onMounted(() => {
  void prepareHomePage()
})

useDidShow(() => {
  void prepareHomePage()
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

.moments-scroll,
.panel-scroll {
  box-sizing: border-box;
  height: 100%;
}

.panel-scroll {
  padding: 24px 18px 110px;
}

.panel-scroll--me {
  padding: 0;
  background: #f7f7f7;
}

.moments-scroll {
  padding-bottom: 128px;
}

.moments-banner {
  position: relative;
  height: 216px;
  overflow: hidden;
  background: #000000;
}

.moments-banner__star-glow {
  position: absolute;
  left: 22px;
  top: 10px;
  width: 108px;
  height: 108px;
  border-radius: 999px;
  background: rgba(255, 223, 32, 0.6);
  filter: blur(24px);
}

.moments-banner__star {
  position: absolute;
  left: 44px;
  top: 18px;
  font-size: 64px;
  line-height: 1;
  color: #ffdf20;
}

.moments-banner__dust {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
}

.moments-banner__dust--left {
  left: 40px;
  top: 48px;
}

.moments-banner__dust--right {
  right: 80px;
  top: 64px;
}

.moments-banner__dust--bottom {
  left: 98px;
  bottom: 40px;
}

.moments-banner__body {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.moments-banner__headline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.moments-banner__title {
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
  color: $tzl-color-surface-base;
}

.moments-banner__arrow {
  font-size: 22px;
  line-height: 1;
  color: $tzl-color-surface-base;
}

.moments-banner__subtitle {
  margin-top: 8px;
  font-size: 14px;
  line-height: 20px;
  color: rgba(255, 255, 255, 0.9);
}

.banner-indicator {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  height: 32px;
  padding-top: 12px;
  background: $tzl-color-surface-muted;
}

.banner-indicator__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #d1d5dc;
}

.banner-indicator__dot--active {
  background: #155dfc;
}

.moments-notice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  margin: 12px auto 0;
  padding: 0 16px;
  border-radius: 999px;
  background: $tzl-color-dark-pill;
}

.moments-notice__avatar {
  width: 24px;
  height: 24px;
  border-radius: 999px;
}

.moments-notice__text {
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-surface-base;
}

.moments-content {
  padding: 12px 16px 0;
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

.moment-card {
  background: $tzl-color-surface-base;
}

.moment-card__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.moment-card__avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 999px;
}

.moment-card__meta {
  flex: 1;
}

.moment-card__author {
  display: block;
  font-size: 18px;
  line-height: 27px;
  font-weight: 500;
  color: #0a0a0a;
}

.moment-card__body-text {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  line-height: 22.75px;
  color: $tzl-color-slate-700;
}

.moment-card__image {
  width: 100%;
  height: 192px;
  margin-top: 12px;
  border-radius: 10px;
}

.moment-card__stats {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.moment-card__time {
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-slate-500;
}

.moment-card__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.moment-card__action {
  display: flex;
  align-items: center;
  gap: 4px;
  color: $tzl-color-slate-500;
}

.moment-card__action-icon {
  font-size: 16px;
  line-height: 1;
}

.moment-card__action-count {
  font-size: 14px;
  line-height: 20px;
}

.moment-card__comments {
  margin-top: 12px;
  background: $tzl-color-surface-muted;
}

.moment-card__comment {
  padding: 8px 12px;
  border-radius: 4px;
}

.moment-card__comment + .moment-card__comment {
  margin-top: 12px;
}

.moment-card__comment-author {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: #101828;
}

.moment-card__comment-text {
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-slate-700;
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
  color: $tzl-color-tab-muted;
}

.tabbar__item.is-active {
  color: $tzl-color-success;
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
  border-radius: 50%;
  border: 1.5px solid currentColor;
}

.tabbar__item.is-active .tabbar__icon--moments .tabbar__shape {
  border: none;
  background: $tzl-gradient-success;
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

.tabbar__item.is-active .tabbar__icon--moments .tabbar__shape::after {
  background: $tzl-color-surface-base;
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

.publish-fab-anchor {
  display: flex;
  justify-content: flex-end;
  padding-right: 24px;
  padding-bottom: calc(env(safe-area-inset-bottom) + 96px);
}

.publish-fab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  background: $tzl-color-dark-surface;
  box-shadow: $tzl-shadow-fab;
}

.publish-fab__plus {
  position: relative;
  width: 28px;
  height: 28px;
}

.publish-fab__line {
  position: absolute;
  left: 50%;
  top: 50%;
  background: $tzl-color-surface-base;
  transform: translate(-50%, -50%);
}

.publish-fab__line--horizontal {
  width: 18px;
  height: 2px;
  border-radius: 999px;
}

.publish-fab__line--vertical {
  width: 2px;
  height: 18px;
  border-radius: 999px;
}

.publish-fab__label {
  margin-top: -2px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: $tzl-color-surface-base;
}
</style>
