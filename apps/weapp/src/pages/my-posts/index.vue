<template>
  <view class="my-posts-page">
    <view v-if="isCheckingAuth || isLoading" class="my-posts-state">
      <view class="my-posts-state__dot" />
      <text class="my-posts-state__title">
        {{ isCheckingAuth ? '正在确认登录状态...' : '正在加载我的动态...' }}
      </text>
    </view>

    <view v-else-if="errorMessage" class="my-posts-state my-posts-state--card">
      <text class="my-posts-state__title">{{ errorMessage }}</text>
      <view class="my-posts-state__action" @tap="handleRetry">重新加载</view>
    </view>

    <view v-else-if="posts.length === 0" class="my-posts-state my-posts-state--card">
      <text class="my-posts-state__title">还没有动态</text>
      <text class="my-posts-state__subtitle">发布第一条内容，让想念留下痕迹</text>
    </view>

    <view v-else class="my-posts-list">
      <view class="my-posts-toolbar">
        <text class="my-posts-toolbar__summary">共 {{ posts.length }} 条动态</text>
        <text class="my-posts-toolbar__action" @tap="handleRetry">刷新</text>
      </view>

      <view
        v-for="post in posts"
        :key="post.id"
        class="my-post-card"
      >
        <view class="my-post-card__header">
          <image
            v-if="post.authorAvatar"
            class="my-post-card__avatar"
            :src="post.authorAvatar"
            mode="aspectFill"
          />
          <view v-else class="my-post-card__avatar my-post-card__avatar--fallback">
            {{ displayName.slice(0, 1) }}
          </view>

          <view class="my-post-card__meta">
            <text class="my-post-card__author">{{ post.authorName || displayName }}</text>
            <text class="my-post-card__time">{{ formatPostTime(post.updatedAt ?? post.createdAt) }}</text>
          </view>
        </view>

        <text v-if="post.content" class="my-post-card__content">{{ post.content }}</text>

        <view v-if="post.images.length" class="my-post-card__image-grid">
          <view
            v-for="(image, index) in post.images.slice(0, 3)"
            :key="`${post.id}-${image}-${index}`"
            class="my-post-card__image-wrap"
            :class="{
              'my-post-card__image-wrap--single': post.images.length === 1,
            }"
          >
            <image class="my-post-card__image" :src="image" mode="aspectFill" />
            <view
              v-if="index === 2 && post.images.length > 3"
              class="my-post-card__image-mask"
            >
              +{{ post.images.length - 3 }}
            </view>
          </view>
        </view>

        <view class="my-post-card__footer">
          <text class="my-post-card__stat">评论 {{ post.commentCount }}</text>
          <text class="my-post-card__stat">提醒 {{ post.remindAgentIds.length }}</text>
        </view>

        <view v-if="post.comments.length" class="my-post-card__comments">
          <view
            v-for="comment in post.comments.slice(0, 2)"
            :key="comment.id"
            class="my-post-card__comment"
          >
            <text class="my-post-card__comment-author">
              {{ formatCommentAuthor(comment.authorName, comment.replyToUserName) }}
            </text>
            <text class="my-post-card__comment-content">{{ comment.content }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'MyPostsPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, onMounted, ref } from 'vue'
import { getPosts, type PostItem } from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import { authSession, restoreAuthSession } from '../../auth/session'

const posts = ref<PostItem[]>([])
const isCheckingAuth = ref(true)
const isLoading = ref(true)
const errorMessage = ref('')

const session = computed(() => authSession.value)
const displayName = computed(() => {
  const name = session.value?.user.name.trim()
  return name ? name : '天之灵用户'
})
const currentUserId = computed(() => session.value?.user.id.trim() ?? '')

let loadingPromise: Promise<void> | null = null

function formatPostTime(value: string | null) {
  if (!value || !value.trim()) {
    return '刚刚'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return '刚刚'
  }

  const parts = [
    parsed.getFullYear(),
    `${parsed.getMonth() + 1}`.padStart(2, '0'),
    `${parsed.getDate()}`.padStart(2, '0'),
  ]
  const time = [
    `${parsed.getHours()}`.padStart(2, '0'),
    `${parsed.getMinutes()}`.padStart(2, '0'),
  ]

  return `${parts.join('-')} ${time.join(':')}`
}

function formatCommentAuthor(authorName: string, replyToUserName: string) {
  const author = authorName.trim() || '天之灵用户'
  const replyTo = replyToUserName.trim()

  return replyTo ? `${author} 回复 ${replyTo}：` : `${author}：`
}

async function redirectToAuth() {
  await Taro.reLaunch({
    url: '/pages/auth/index',
  })
}

async function loadMyPosts(showLoading = true) {
  if (loadingPromise) {
    return loadingPromise
  }

  loadingPromise = Promise.resolve().then(async () => {
    if (showLoading) {
      isLoading.value = true
    }

    errorMessage.value = ''
    isCheckingAuth.value = true

    await restoreAuthSession()

    if (!authSession.value) {
      posts.value = []
      await redirectToAuth()
      return
    }

    isCheckingAuth.value = false

    const userId = currentUserId.value

    if (!userId) {
      posts.value = []
      isLoading.value = false
      return
    }

    try {
      const allPosts = await getPosts()
      posts.value = allPosts
        .filter((item) => item.userId.trim() === userId)
        .sort((left, right) => {
          const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0
          const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0
          return rightTime - leftTime
        })
    } catch (error) {
      if (error instanceof ApiException) {
        errorMessage.value = error.message || '加载动态失败'
      } else {
        errorMessage.value = '加载动态失败，请稍后重试'
      }
    } finally {
      isLoading.value = false
    }
  }).finally(() => {
    loadingPromise = null
    isCheckingAuth.value = false
  })

  return loadingPromise
}

function handleRetry() {
  void loadMyPosts(false)
}

onMounted(() => {
  void loadMyPosts()
})

useDidShow(() => {
  void loadMyPosts(false)
})
</script>

<style lang="scss">
.my-posts-page {
  min-height: 100vh;
  padding: 12px 16px 28px;
  background: #f7f8fa;
  box-sizing: border-box;
}

.my-posts-state {
  min-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.my-posts-state--card {
  margin-top: 24px;
  min-height: 280px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.9);
}

.my-posts-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-success;
  box-shadow: $tzl-shadow-success-sm;
}

.my-posts-state__title {
  color: #364153;
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
}

.my-posts-state__subtitle {
  color: $tzl-color-text-muted;
  font-size: 13px;
  line-height: 20px;
}

.my-posts-state__action {
  padding: 8px 18px;
  border-radius: 999px;
  background: $tzl-gradient-success;
  color: $tzl-color-surface-base;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.my-posts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.my-posts-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px 0;
}

.my-posts-toolbar__summary {
  color: $tzl-color-text-muted;
  font-size: 13px;
  line-height: 20px;
}

.my-posts-toolbar__action {
  color: $tzl-color-success;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.my-post-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 10px 28px rgba(17, 24, 39, 0.06);
}

.my-post-card__header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.my-post-card__avatar {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: $tzl-color-surface-subtle;
}

.my-post-card__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: $tzl-gradient-warm;
  color: $tzl-color-surface-base;
  font-size: 16px;
  font-weight: 700;
}

.my-post-card__meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.my-post-card__author {
  color: #111827;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.my-post-card__time {
  color: $tzl-color-text-muted;
  font-size: 12px;
  line-height: 18px;
}

.my-post-card__content {
  color: #364153;
  font-size: 14px;
  line-height: 22px;
}

.my-post-card__image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.my-post-card__image-wrap {
  position: relative;
  width: calc((100% - 16px) / 3);
  height: 108px;
  overflow: hidden;
  border-radius: 12px;
  background: $tzl-color-surface-subtle;
}

.my-post-card__image-wrap--single {
  width: 100%;
  height: 196px;
}

.my-post-card__image {
  width: 100%;
  height: 100%;
}

.my-post-card__image-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.4);
  color: $tzl-color-surface-base;
  font-size: 20px;
  font-weight: 700;
}

.my-post-card__footer {
  display: flex;
  align-items: center;
  gap: 16px;
}

.my-post-card__stat {
  color: $tzl-color-slate-500;
  font-size: 13px;
  line-height: 20px;
}

.my-post-card__comments {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 12px;
  background: $tzl-color-surface-muted;
}

.my-post-card__comment {
  font-size: 13px;
  line-height: 20px;
}

.my-post-card__comment-author {
  color: #111827;
  font-weight: 600;
}

.my-post-card__comment-content {
  color: #364153;
}
</style>
