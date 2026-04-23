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

        <view v-show="activeTab === 'contacts'" class="contacts-page">
          <view class="contacts-page__header">
            <view class="contacts-page__header-spacer" />
            <text class="contacts-page__title">通讯录</text>
            <view class="contacts-page__action" @tap="handleCreateAgent">
              <view class="contacts-page__action-icon">
                <view class="contacts-page__action-head" />
                <view class="contacts-page__action-body" />
                <view class="contacts-page__action-plus contacts-page__action-plus--horizontal" />
                <view class="contacts-page__action-plus contacts-page__action-plus--vertical" />
              </view>
            </view>
          </view>

          <view class="contacts-search">
            <view class="contacts-search__icon" />
            <input
              v-model="contactKeyword"
              class="contacts-search__input"
              type="text"
              confirm-type="search"
              maxlength="20"
              placeholder="搜索"
              placeholder-style="color: #99a1af;"
            />
          </view>

          <scroll-view scroll-y class="contacts-list-scroll">
            <view v-if="isContactsLoading" class="contacts-feedback contacts-feedback--loading">
              <view class="contacts-feedback__spinner" />
              <text class="contacts-feedback__title">正在加载通讯录...</text>
            </view>

            <view v-else-if="contactsLoadError" class="contacts-feedback">
              <text class="contacts-feedback__title">{{ contactsLoadError }}</text>
              <text class="contacts-feedback__action" @tap="handleContactsRetry">重新加载</text>
            </view>

            <view v-else-if="!filteredConversations.length" class="contacts-feedback">
              <text class="contacts-feedback__title">{{ contactsEmptyTitle }}</text>
              <text class="contacts-feedback__desc">{{ contactsEmptyDescription }}</text>
            </view>

            <view v-else class="contacts-list">
              <view
                v-for="conversation in filteredConversations"
                :key="conversation.id"
                class="contacts-item"
                @tap="handleConversationTap(conversation)"
              >
                <image
                  v-if="conversation.agentAvatar"
                  class="contacts-item__avatar"
                  :src="conversation.agentAvatar"
                  mode="aspectFill"
                />
                <view
                  v-else
                  class="contacts-item__avatar contacts-item__avatar--fallback"
                  :class="{
                    'contacts-item__avatar--male': conversation.agentSex === 1,
                    'contacts-item__avatar--female': conversation.agentSex !== 1,
                  }"
                >
                  {{ buildConversationFallback(conversation.agentName) }}
                </view>

                <view class="contacts-item__content">
                  <view class="contacts-item__headline">
                    <text class="contacts-item__name">{{ resolveConversationName(conversation) }}</text>
                    <text class="contacts-item__time">
                      {{ formatConversationUpdatedAt(conversation.updatedAt) }}
                    </text>
                  </view>
                  <text class="contacts-item__preview">
                    {{ buildConversationPreview(conversation.preview) }}
                  </text>
                </view>
              </view>
            </view>
          </scroll-view>
        </view>

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
import { ApiException } from '../../api/api-exception'
import {
  getConversations,
  type ConversationSummary,
} from '../../apis/conversation'
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
const isContactsLoading = ref(true)
const notificationSummary = ref<PostCommentNotificationSummary | null>(null)
const contactKeyword = ref('')
const contactsLoadError = ref('')
const conversations = ref<ConversationSummary[]>([])

let ensureSessionPromise: Promise<void> | null = null
let refreshHomePromise: Promise<void> | null = null
let refreshContactsPromise: Promise<void> | null = null

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
const filteredConversations = computed(() => {
  const keyword = contactKeyword.value.trim().toLowerCase()

  if (!keyword) {
    return conversations.value
  }

  return conversations.value.filter((conversation) => {
    return [
      conversation.agentName,
      conversation.iCallAgent,
      conversation.agentCallMe,
    ]
      .map((value) => value.trim().toLowerCase())
      .some((value) => value.includes(keyword))
  })
})
const contactsEmptyTitle = computed(() => {
  return contactKeyword.value.trim() ? '没有找到匹配的联系人' : '还没有联系人'
})
const contactsEmptyDescription = computed(() => {
  return contactKeyword.value.trim()
    ? '换个关键词试试，支持按联系人昵称和互称搜索。'
    : '通讯录会展示你已经开始聊天的联系人。'
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

async function handleCreateAgent() {
  await Taro.navigateTo({
    url: '/pages/agent-create/index',
  })
}

function handleContactsRetry() {
  void refreshContactsData({ showLoading: true })
}

function handleConversationTap(conversation: ConversationSummary) {
  const query = [
    ['conversationId', conversation.id],
    ['agentName', resolveConversationName(conversation)],
    ['agentAvatar', conversation.agentAvatar],
    ['agentSex', String(conversation.agentSex)],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  void Taro.navigateTo({
    url: `/pages/chat/index?${query}`,
  })
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

function resolveConversationName(conversation: ConversationSummary) {
  const trimmedName = conversation.agentName.trim()
  return trimmedName ? trimmedName : '未命名联系人'
}

function buildConversationFallback(name: string) {
  const trimmedName = name.trim()
  return trimmedName ? trimmedName.slice(0, 1) : 'A'
}

function buildConversationPreview(preview: string) {
  const segments = preview
    .split('</fenge>')
    .map((item) => item.trim())
    .filter(Boolean)
  const rawPreview = segments.length ? segments[segments.length - 1] : preview.trim()
  const cleanedPreview = rawPreview.replace(/<[^>]+>/g, '').trim()

  return cleanedPreview || '点击开始和 TA 对话'
}

function formatConversationUpdatedAt(value: Date | null) {
  if (!value) {
    return ''
  }

  const now = new Date()
  const isSameDay =
    now.getFullYear() === value.getFullYear() &&
    now.getMonth() === value.getMonth() &&
    now.getDate() === value.getDate()

  if (isSameDay) {
    const hour = String(value.getHours()).padStart(2, '0')
    const minute = String(value.getMinutes()).padStart(2, '0')
    return `${hour}:${minute}`
  }

  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

async function refreshContactsData(options: { showLoading?: boolean } = {}) {
  if (refreshContactsPromise) {
    return refreshContactsPromise
  }

  if (options.showLoading ?? conversations.value.length === 0) {
    isContactsLoading.value = true
  }

  contactsLoadError.value = ''

  refreshContactsPromise = getConversations()
    .then((items) => {
      conversations.value = items
    })
    .catch((error: unknown) => {
      if (error instanceof ApiException && error.requiresReLogin) {
        contactsLoadError.value = error.message
        return
      }

      contactsLoadError.value =
        error instanceof ApiException
          ? error.message
          : '加载通讯录失败，请稍后重试'
    })
    .finally(() => {
      isContactsLoading.value = false
      refreshContactsPromise = null
    })

  return refreshContactsPromise
}

async function refreshHomeData() {
  if (refreshHomePromise) {
    return refreshHomePromise
  }

  refreshHomePromise = Promise.all([
    getCurrentUser().catch(() => undefined),
    refreshContactsData({
      showLoading: conversations.value.length === 0,
    }),
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

.contacts-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: $tzl-color-surface-base;
}

.contacts-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 52px;
  padding: calc(env(safe-area-inset-top) + 4px) 16px 0;
  background: $tzl-color-surface-base;
}

.contacts-page__header-spacer,
.contacts-page__action {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}

.contacts-page__action {
  display: flex;
  align-items: center;
  justify-content: center;
}

.contacts-page__title {
  font-size: 18px;
  line-height: 28px;
  font-weight: 600;
  color: #111111;
}

.contacts-page__action-icon {
  position: relative;
  width: 20px;
  height: 20px;
}

.contacts-page__action-head,
.contacts-page__action-body,
.contacts-page__action-plus {
  position: absolute;
  box-sizing: border-box;
}

.contacts-page__action-head {
  left: 1px;
  top: 1px;
  width: 7px;
  height: 7px;
  border: 1.6px solid #111111;
  border-radius: 50%;
}

.contacts-page__action-body {
  left: 0;
  bottom: 2px;
  width: 10px;
  height: 7px;
  border: 1.6px solid #111111;
  border-top-left-radius: 7px;
  border-top-right-radius: 7px;
  border-bottom: 0;
}

.contacts-page__action-plus {
  right: 0;
  top: 50%;
  background: #111111;
  border-radius: 999px;
  transform: translateY(-50%);
}

.contacts-page__action-plus--horizontal {
  width: 9px;
  height: 1.6px;
}

.contacts-page__action-plus--vertical {
  right: 3.7px;
  width: 1.6px;
  height: 9px;
}

.contacts-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin: 8px 16px 2px;
  padding: 0 12px;
  border-radius: 8px;
  background: #f3f4f6;
}

.contacts-search__icon {
  position: relative;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.contacts-search__icon::before,
.contacts-search__icon::after {
  content: '';
  position: absolute;
  box-sizing: border-box;
}

.contacts-search__icon::before {
  left: 0;
  top: 0;
  width: 11px;
  height: 11px;
  border: 1.6px solid #98a2b3;
  border-radius: 50%;
}

.contacts-search__icon::after {
  right: 1px;
  bottom: 1px;
  width: 6px;
  height: 1.6px;
  background: #98a2b3;
  border-radius: 999px;
  transform: rotate(45deg);
  transform-origin: center;
}

.contacts-search__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 14px;
  color: #111827;
}

.contacts-list-scroll {
  flex: 1;
  min-height: 0;
  padding-bottom: 110px;
}

.contacts-list {
  background: $tzl-color-surface-base;
}

.contacts-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 72px;
  padding: 0 16px;
  background: $tzl-color-surface-base;
}

.contacts-item::after {
  content: '';
  position: absolute;
  left: 76px;
  right: 0;
  bottom: 0;
  height: 0.5px;
  background: #f0f2f5;
}

.contacts-item:last-child::after {
  display: none;
}

.contacts-item__avatar {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: #eef2f7;
}

.contacts-item__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: $tzl-color-surface-base;
  font-size: 20px;
  font-weight: 700;
}

.contacts-item__avatar--male {
  background: linear-gradient(135deg, #b6dbff 0%, #5d8fff 100%);
}

.contacts-item__avatar--female {
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
}

.contacts-item__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.contacts-item__headline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.contacts-item__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #101828;
}

.contacts-item__time {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 16px;
  color: #99a1af;
}

.contacts-item__preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  color: #99a1af;
}

.contacts-feedback {
  min-height: calc(100vh - 260px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
}

.contacts-feedback--loading {
  gap: 12px;
}

.contacts-feedback__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 138, 54, 0.18);
  border-top-color: $tzl-color-primary;
  border-radius: 50%;
  animation: contacts-spinner 0.9s linear infinite;
}

.contacts-feedback__title {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #344054;
}

.contacts-feedback__desc {
  font-size: 14px;
  line-height: 20px;
  color: #98a2b3;
}

.contacts-feedback__action {
  margin-top: 4px;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
  color: $tzl-color-primary;
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

@keyframes contacts-spinner {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
