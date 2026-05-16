<template>
  <page-scaffold
    class="my-messages-page"
    background="#ffffff"
    header-background="#f6f6f6"
    body-padding="0"
    :safe-area-top="false"
    :scroll="false"
  >
    <template #header>
      <app-bar title="我的消息" background="#f6f6f6" :show-capsule="true" :show-back="true" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="my-messages-state">
      <view class="my-messages-state__dot" />
      <text class="my-messages-state__title">
        {{ isCheckingAuth ? '正在确认登录状态...' : '正在加载消息...' }}
      </text>
    </view>

    <view v-else-if="errorMessage" class="my-messages-state">
      <text class="my-messages-state__title">{{ errorMessage }}</text>
      <view class="my-messages-state__action" @tap="handleRetry">重新加载</view>
    </view>

    <view v-else-if="notifications.length === 0" class="my-messages-state">
      <text class="my-messages-state__title">暂无新消息</text>
    </view>

    <scroll-view
      v-else
      class="my-messages-scroll"
      scroll-y
      @scrolltolower="handleScrollToLower"
    >
      <view class="my-messages-list">
        <view
          v-for="item in notifications"
          :key="item.id"
          class="my-messages-item"
        >
          <image
            v-if="item.actorAvatar"
            class="my-messages-item__avatar"
            :src="item.actorAvatar"
            mode="aspectFill"
          />
          <view v-else class="my-messages-item__avatar my-messages-item__avatar--fallback">
            <text>{{ getAvatarFallback(item.actorName) }}</text>
          </view>

          <view class="my-messages-item__body">
            <text class="my-messages-item__name">{{ item.actorName || '新评论' }}</text>
            <text class="my-messages-item__content">{{ formatNotificationContent(item) }}</text>
            <text class="my-messages-item__time">{{ formatNotificationTime(item.createdAt) }}</text>
          </view>

          <image
            v-if="item.postThumbnail"
            class="my-messages-item__thumb"
            :src="item.postThumbnail"
            mode="aspectFill"
          />
          <view v-else class="my-messages-item__thumb my-messages-item__thumb--fallback" />
        </view>

        <view class="my-messages-load-footer">
          <text v-if="isLoadingMore" class="my-messages-load-footer__text">正在加载更多...</text>
          <text v-else-if="loadMoreError" class="my-messages-load-footer__action" @tap="handleLoadMoreRetry">
            加载失败，点击重试
          </text>
          <text v-else-if="!hasMoreNotifications" class="my-messages-load-footer__text">没有更多消息了</text>
        </view>
      </view>
    </scroll-view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'MyMessagesPage',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { onMounted, ref } from 'vue'
import {
  getCommentNotifications,
  readUnreadCommentNotifications,
  type PostCommentNotificationItem,
} from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import { authSession, restoreAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { refreshCommentNotificationSummary } from '../../post/comment-notification-state'

const notifications = ref<PostCommentNotificationItem[]>([])
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const errorMessage = ref('')
const loadMoreError = ref('')
const currentPage = ref(1)
const hasMoreNotifications = ref(true)

let loadingPromise: Promise<void> | null = null
let loadMorePromise: Promise<void> | null = null
const MESSAGE_PAGE_SIZE = 20

async function redirectToAuth() {
  await Taro.reLaunch({
    url: '/pages/auth/index',
  })
}

async function loadMessages() {
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = Promise.resolve()
    .then(async () => {
      errorMessage.value = ''
      isCheckingAuth.value = true
      isLoading.value = true
      loadMoreError.value = ''

      await restoreAuthSession()

      if (!authSession.value) {
        notifications.value = []
        await redirectToAuth()
        return
      }

      isCheckingAuth.value = false

      const result = await getCommentNotifications({
        page: 1,
        pageSize: MESSAGE_PAGE_SIZE,
      })
      notifications.value = result.items
      currentPage.value = result.page
      hasMoreNotifications.value = result.hasMore

      await readUnreadCommentNotifications()
      void refreshCommentNotificationSummary()
    })
    .catch((error) => {
      if (error instanceof ApiException) {
        errorMessage.value = error.message || '加载消息失败'
      } else {
        errorMessage.value = '加载消息失败，请稍后重试'
      }
    })
    .finally(() => {
      isLoading.value = false
      isCheckingAuth.value = false
      loadingPromise = null
    })

  return loadingPromise
}

function handleRetry() {
  void loadMessages()
}

async function loadMoreMessages() {
  if (loadMorePromise || isLoading.value || !hasMoreNotifications.value) {
    return loadMorePromise
  }

  isLoadingMore.value = true
  loadMoreError.value = ''

  loadMorePromise = getCommentNotifications({
    page: currentPage.value + 1,
    pageSize: MESSAGE_PAGE_SIZE,
  })
    .then((result) => {
      const knownIds = new Set(notifications.value.map((item) => item.id))
      const nextItems = result.items.filter((item) => !knownIds.has(item.id))

      notifications.value = [...notifications.value, ...nextItems]
      currentPage.value = result.page
      hasMoreNotifications.value = result.hasMore
    })
    .catch((error) => {
      loadMoreError.value = error instanceof ApiException
        ? error.message || '加载更多失败'
        : '加载更多失败，请稍后重试'
    })
    .finally(() => {
      isLoadingMore.value = false
      loadMorePromise = null
    })

  return loadMorePromise
}

function handleScrollToLower() {
  void loadMoreMessages()
}

function handleLoadMoreRetry() {
  void loadMoreMessages()
}

function getAvatarFallback(name: string) {
  const trimmedName = name.trim()
  return trimmedName ? trimmedName.slice(0, 1) : '评'
}

function formatNotificationContent(item: PostCommentNotificationItem) {
  const content = item.commentPreview.trim() || '评论了你的动态'
  const replyToUserName = item.replyToUserName.trim()

  return replyToUserName ? `回复 ${replyToUserName}：${content}` : content
}

function formatNotificationTime(value: string | null) {
  if (!value) {
    return ''
  }

  const time = Date.parse(value)

  if (!Number.isFinite(time)) {
    return ''
  }

  const diffMs = Date.now() - time
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (diffMs < minuteMs) {
    return '刚刚'
  }

  if (diffMs < hourMs) {
    return `${Math.max(1, Math.floor(diffMs / minuteMs))} 分钟前`
  }

  if (diffMs < dayMs) {
    return `${Math.floor(diffMs / hourMs)} 小时前`
  }

  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

onMounted(() => {
  void loadMessages()
})
</script>

<style lang="scss">
.my-messages-page {
  min-height: 100vh;
  background: #ffffff;
}

.my-messages-scroll {
  height: 100%;
  background: #ffffff;
}

.my-messages-state {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
  color: #101828;
}

.my-messages-state__dot {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(16, 24, 40, 0.14);
  border-top-color: #101828;
  border-radius: 999px;
}

.my-messages-state__title {
  font-size: 15px;
  line-height: 22px;
  color: #101828;
}

.my-messages-state__action {
  padding: 8px 12px;
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
  color: #00a63e;
}

.my-messages-list {
  min-height: 100%;
  background: #ffffff;
}

.my-messages-item {
  box-sizing: border-box;
  min-height: 88px;
  padding: 10px 12px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-bottom: 1px solid #e8e8e8;
  background: #ffffff;
}

.my-messages-item__avatar {
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
  border-radius: 4px;
  background: #f2f4f7;
}

.my-messages-item__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #667085;
  font-size: 18px;
  font-weight: 600;
}

.my-messages-item__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: #101828;
}

.my-messages-item__name {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #101828;
}

.my-messages-item__content {
  display: block;
  font-size: 14px;
  line-height: 24px;
  font-weight: 500;
  color: #101828;
  word-break: break-all;
}

.my-messages-item__time {
  font-size: 14px;
  line-height: 24px;
  font-weight: 500;
  color: #101828;
}

.my-messages-item__thumb {
  flex: 0 0 64px;
  width: 64px;
  height: 64px;
  border-radius: 4px;
  background: #f2f4f7;
}

.my-messages-item__thumb--fallback {
  opacity: 0;
}

.my-messages-load-footer {
  min-height: 72px;
  padding: 18px 24px 36px;
  box-sizing: border-box;
  text-align: center;
}

.my-messages-load-footer__text,
.my-messages-load-footer__action {
  font-size: 13px;
  line-height: 20px;
  color: #8a94a6;
}

.my-messages-load-footer__action {
  color: #00a63e;
  font-weight: 600;
}
</style>
