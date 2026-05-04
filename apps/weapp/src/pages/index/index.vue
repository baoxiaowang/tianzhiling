<template>
  <page-scaffold
    ref="pageScaffoldRef"
    class="moments-page"
    body-padding="0"
    background="#ffffff"
    scroll
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <template #header>
      <app-bar
        title="朋友圈"
        background="#ffffff"
        :show-back="false"
        :show-capsule="false"
      />
    </template>

    <view v-if="isCheckingAuth && !hasLoadedPosts" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">
        正在加载动态...
      </text>
    </view>

    <view
      v-else
      class="moments-scroll"
    >
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

      <view
        v-if="hasUnreadNotifications"
        class="moments-notice"
        @tap="handleNotificationTap"
      >
        <image
          class="moments-notice__avatar"
          :src="notificationAvatarUrl"
          mode="aspectFill"
        />
        <text class="moments-notice__text">{{ notificationText }}</text>
      </view>
      <view v-else class="moments-notice-spacer" />

      <view v-if="isPostsLoading" class="moments-feedback">
        <view class="moments-feedback__dot" />
        <text class="moments-feedback__title">正在加载动态...</text>
      </view>

      <view v-else-if="errorMessage && posts.length === 0" class="moments-feedback">
        <text class="moments-feedback__icon">✦</text>
        <text class="moments-feedback__title">{{ errorMessage }}</text>
        <view class="moments-feedback__action" @tap="handleRetry">重新加载</view>
      </view>

      <view v-else-if="posts.length === 0" class="moments-feedback">
        <text class="moments-feedback__icon">✦</text>
        <text class="moments-feedback__title">还没有动态</text>
        <text class="moments-feedback__subtitle">发布第一条内容，让想念留下痕迹</text>
      </view>

      <view v-else class="moments-content">
        <view
          v-for="post in posts"
          :key="post.id"
          class="moment-card"
        >
          <view class="moment-card__avatar-column">
            <image
              v-if="post.authorAvatar"
              class="moment-card__avatar"
              :src="post.authorAvatar"
              mode="aspectFill"
            />
            <view v-else class="moment-card__avatar moment-card__avatar--fallback">
              <text>{{ getPostAuthor(post).slice(0, 1) }}</text>
            </view>
          </view>

          <view class="moment-card__content-column">
            <view class="moment-card__meta">
              <text class="moment-card__author">{{ getPostAuthor(post) }}</text>
              <text v-if="post.content" class="moment-card__body-text">{{ post.content }}</text>
            </view>

            <view
              v-if="getPostImages(post).length"
              class="moment-card__image-grid"
              :class="`moment-card__image-grid--${getPostImages(post).length}`"
            >
              <view
                v-for="(image, index) in getPostImages(post)"
                :key="`${post.id}-${image}-${index}`"
                class="moment-card__image-wrap"
                @tap="handlePreviewImages(post, index)"
              >
                <image class="moment-card__image" :src="image" mode="aspectFill" />
              </view>
            </view>

            <view class="moment-card__stats">
              <text class="moment-card__time">
                {{ formatMomentRelativeTime(post.updatedAt ?? post.createdAt) }}
              </text>
              <view class="moment-card__actions">
                <view class="moment-card__action">
                  <text class="moment-card__action-icon">♡</text>
                  <text class="moment-card__action-count">0</text>
                </view>
                <view class="moment-card__action" @tap="handleCommentTap(post)">
                  <text class="moment-card__action-icon">◌</text>
                  <text class="moment-card__action-count">{{ post.commentCount }}</text>
                </view>
              </view>
            </view>

            <view v-if="post.comments.length" class="moment-card__comments">
              <view
                v-for="comment in post.comments"
                :key="comment.id"
                class="moment-card__comment"
                @tap="handleCommentTap(post)"
              >
                <text class="moment-card__comment-author">
                  {{ formatCommentAuthor(comment.authorName, comment.replyToUserName) }}
                </text>
                <text class="moment-card__comment-text">{{ comment.content }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="moments-floating-publish" @tap="handleCreatePost">
      <text class="moments-floating-publish__plus">+</text>
    </view>

    <view
      v-if="activeCommentPost"
      class="moment-comment-dock"
      :style="commentComposerStyle"
    >
      <view class="moment-comment-composer">
        <input
          class="moment-comment-composer__input"
          :value="commentDraft"
          :focus="shouldFocusCommentInput"
          placeholder="发表评论:"
          placeholder-style="color: #b8b8b8;"
          confirm-type="send"
          :adjust-position="false"
          @input="handleCommentInput"
          @focus="handleCommentFocus"
          @blur="handleCommentBlur"
          @keyboardheightchange="handleCommentKeyboardHeightChange"
          @confirm="handleSubmitComment"
        />
        <view
          v-if="!isCommentEmojiPanelVisible"
          class="moment-comment-composer__icon moment-comment-composer__icon--emoji"
          @tap="handleCommentEmojiToggle"
        >
          ☺
        </view>
        <view
          v-else
          class="moment-comment-composer__send"
          :class="{ 'moment-comment-composer__send--disabled': !canSubmitComment || isSubmittingComment }"
          @tap="handleSubmitComment"
        >
          发送
        </view>
      </view>

      <emoji-picker-panel
        :visible="isCommentEmojiPanelVisible"
        @emoji-select="handleCommentEmojiSelect"
        @backspace="handleCommentEmojiDelete"
      />
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'MomentsIndexPage',
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import {
  createComment,
  getCommentNotificationSummary,
  getPosts,
  markCommentNotificationsRead,
  type PostCommentNotificationSummary,
  type PostItem,
} from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import AppBar from '../../components/app-bar/app-bar.vue'
import EmojiPickerPanel from '../../components/emoji-picker-panel/emoji-picker-panel.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'
import { setCustomTabBarHidden, syncCustomTabBar } from '../../utils/custom-tab-bar'

interface PageScaffoldController {
  openLoginPrompt: () => void
}

const momentsDesign = {
  notificationAvatarUrl: 'https://www.figma.com/api/mcp/asset/f41f54cc-8bf1-440c-9c03-648deafeb2d1',
} as const

const pageScaffoldRef = ref<PageScaffoldController | null>(null)
const isCheckingAuth = ref(true)
const isPostsLoading = ref(false)
const hasLoadedPosts = ref(false)
const errorMessage = ref('')
const posts = ref<PostItem[]>([])
const notificationSummary = ref<PostCommentNotificationSummary | null>(null)
const activeCommentPost = ref<PostItem | null>(null)
const commentDraft = ref('')
const commentKeyboardHeight = ref(0)
const isCommentInputFocused = ref(false)
const shouldFocusCommentInput = ref(false)
const isSubmittingComment = ref(false)
const isCommentEmojiPanelVisible = ref(false)

let refreshDataPromise: Promise<void> | null = null

const session = computed(() => authSession.value)
const hasUnreadNotifications = computed(() => {
  return (notificationSummary.value?.unreadCount ?? 0) > 0 && Boolean(notificationSummary.value?.latest)
})
const notificationAvatarUrl = computed(() => {
  const latestAvatar = notificationSummary.value?.latest?.actorAvatar.trim()
  return latestAvatar ? latestAvatar : momentsDesign.notificationAvatarUrl
})
const notificationText = computed(() => {
  const unreadCount = notificationSummary.value?.unreadCount ?? 0
  return unreadCount > 0 ? `${unreadCount}条新消息` : '暂无新消息'
})
const canSubmitComment = computed(() => commentDraft.value.trim().length > 0)
const commentComposerStyle = computed(() => {
  const shouldFollowKeyboard =
    isCommentInputFocused.value &&
    commentKeyboardHeight.value > 0 &&
    !isCommentEmojiPanelVisible.value

  return {
    transform: shouldFollowKeyboard
      ? `translateY(-${commentKeyboardHeight.value}px)`
      : 'translateY(0)',
  }
})

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function openLoginPrompt() {
  pageScaffoldRef.value?.openLoginPrompt()
}

function getPostAuthor(post: PostItem) {
  const authorName = post.authorName.trim()
  return authorName ? authorName : '天之灵用户'
}

function getPostImages(post: PostItem) {
  return post.images
    .map((image) => image.trim())
    .filter(Boolean)
    .slice(0, 9)
}

function formatMomentRelativeTime(value: string | null) {
  if (!value || !value.trim()) {
    return '刚刚'
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return '刚刚'
  }

  const diffMs = Math.max(0, Date.now() - parsed.getTime())
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return '刚刚'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}分钟前`
  }

  if (diffHours < 24) {
    return `${diffHours}小时前`
  }

  if (diffDays < 7) {
    return `${diffDays}天前`
  }

  const parts = [
    parsed.getFullYear(),
    `${parsed.getMonth() + 1}`.padStart(2, '0'),
    `${parsed.getDate()}`.padStart(2, '0'),
  ]

  return parts.join('-')
}

function formatCommentAuthor(authorName: string, replyToUserName: string) {
  const author = authorName.trim() || '天之灵用户'
  const replyTo = replyToUserName.trim()

  return replyTo ? `${author} 回复 ${replyTo}：` : `${author}：`
}

function sortPostsByTime(items: PostItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0
    return rightTime - leftTime
  })
}

async function refreshMomentsData(showLoading = true) {
  if (refreshDataPromise) {
    return refreshDataPromise
  }

  refreshDataPromise = Promise.resolve()
    .then(async () => {
      if (showLoading) {
        isPostsLoading.value = true
      }

      errorMessage.value = ''

      const [postItems, summary] = await Promise.all([
        getPosts(),
        session.value
          ? getCommentNotificationSummary().catch(() => null)
          : Promise.resolve(null),
      ])

      posts.value = sortPostsByTime(postItems)
      notificationSummary.value = summary
      hasLoadedPosts.value = true
    })
    .catch((error) => {
      if (error instanceof ApiException) {
        errorMessage.value = error.message || '加载动态失败'
      } else {
        errorMessage.value = '加载动态失败，请稍后重试'
      }
    })
    .finally(() => {
      refreshDataPromise = null
      isPostsLoading.value = false
    })

  return refreshDataPromise
}

async function preparePage() {
  if (!hasLoadedPosts.value) {
    isCheckingAuth.value = true
  }

  await restoreAuthSession()
  await refreshMomentsData(!hasLoadedPosts.value)
  isCheckingAuth.value = false
}

function handleRetry() {
  void refreshMomentsData(true)
}

async function handleNotificationTap() {
  const latest = notificationSummary.value?.latest
  const postId = latest?.postId.trim()

  if (!postId) {
    return
  }

  let targetPost = posts.value.find((post) => post.id === postId) ?? null

  if (!targetPost) {
    await refreshMomentsData(false)
    targetPost = posts.value.find((post) => post.id === postId) ?? null
  }

  if (!targetPost) {
    showToast('动态不存在或已删除')
    return
  }

  openCommentComposer(targetPost)
  void markCommentNotificationsRead(postId)
    .then(() => getCommentNotificationSummary())
    .then((summary) => {
      notificationSummary.value = summary
    })
    .catch(() => undefined)
}

function handleCreatePost() {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  void Taro.navigateTo({
    url: '/pages/post-create/index',
  })
}

function openCommentComposer(post: PostItem) {
  activeCommentPost.value = post
  commentDraft.value = ''
  shouldFocusCommentInput.value = false
  isCommentEmojiPanelVisible.value = false
  setCustomTabBarHidden(true)

  void nextTick(() => {
    shouldFocusCommentInput.value = true
  })
}

function handleCommentTap(post: PostItem) {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  openCommentComposer(post)
}

function closeCommentComposer(force = false) {
  if (isSubmittingComment.value && !force) {
    return
  }

  activeCommentPost.value = null
  commentDraft.value = ''
  shouldFocusCommentInput.value = false
  isCommentInputFocused.value = false
  commentKeyboardHeight.value = 0
  isCommentEmojiPanelVisible.value = false
  setCustomTabBarHidden(false)
}

function handleCommentFocus() {
  isCommentInputFocused.value = true
  isCommentEmojiPanelVisible.value = false
}

function handleCommentBlur() {
  isCommentInputFocused.value = false
  shouldFocusCommentInput.value = false
}

function handleCommentKeyboardHeightChange(event: { detail?: { height?: number } }) {
  commentKeyboardHeight.value = event.detail?.height ?? 0

  if (commentKeyboardHeight.value <= 0) {
    isCommentInputFocused.value = false
  }
}

function readInputValue(event: unknown) {
  if (!event || typeof event !== 'object' || !('detail' in event)) {
    return ''
  }

  const detail = (event as { detail?: unknown }).detail

  if (!detail || typeof detail !== 'object' || !('value' in detail)) {
    return ''
  }

  const value = (detail as { value?: unknown }).value
  return typeof value === 'string' ? value : ''
}

function handleCommentInput(event: unknown) {
  commentDraft.value = readInputValue(event)
}

function handleCommentEmojiToggle() {
  isCommentEmojiPanelVisible.value = !isCommentEmojiPanelVisible.value
  shouldFocusCommentInput.value = false

  if (isCommentEmojiPanelVisible.value) {
    isCommentInputFocused.value = false
    commentKeyboardHeight.value = 0
    void Taro.hideKeyboard()
  } else {
    void nextTick(() => {
      shouldFocusCommentInput.value = true
    })
  }
}

function handleCommentEmojiSelect(emoji: string) {
  commentDraft.value = `${commentDraft.value}${emoji}`
}

function handleCommentEmojiDelete() {
  const characters = Array.from(commentDraft.value)

  if (!characters.length) {
    return
  }

  characters.pop()
  commentDraft.value = characters.join('')
}

async function handleSubmitComment() {
  const post = activeCommentPost.value
  const content = commentDraft.value.trim()

  if (!post || !content || isSubmittingComment.value) {
    return
  }

  isSubmittingComment.value = true

  try {
    await createComment(post.id, {
      content,
    })

    commentDraft.value = ''
    await refreshMomentsData(false)
    closeCommentComposer(true)
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      openLoginPrompt()
      return
    }

    showToast(error instanceof ApiException ? error.message : '评论失败，请稍后重试')
  } finally {
    isSubmittingComment.value = false
  }
}

function handlePreviewImages(post: PostItem, index: number) {
  const urls = getPostImages(post)
  const current = urls[index]

  if (!current) {
    return
  }

  void Taro.previewImage({
    urls,
    current,
  })
}

useDidShow(() => {
  syncCustomTabBar('/pages/index/index')
  setCustomTabBarHidden(Boolean(activeCommentPost.value))
  void preparePage()
})

useDidHide(() => {
  setCustomTabBarHidden(false)
  closeCommentComposer()
})
</script>

<style lang="scss">
.moments-page {
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

.moments-scroll {
  box-sizing: border-box;
  min-height: 100%;
  padding-bottom: 128px;
  background: $tzl-color-surface-base;
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

.moments-notice-spacer {
  height: 12px;
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

.moments-feedback {
  min-height: 280px;
  padding: 96px 24px 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.moments-feedback__dot {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(0, 166, 62, 0.18);
  border-top-color: #00a63e;
  border-radius: 999px;
}

.moments-feedback__icon {
  font-size: 36px;
  line-height: 40px;
  color: #b8c1cc;
}

.moments-feedback__title {
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: #364153;
}

.moments-feedback__subtitle {
  font-size: 14px;
  line-height: 20px;
  color: #6a7282;
}

.moments-feedback__action {
  margin-top: 4px;
  padding: 8px 12px;
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
  color: #00a63e;
}

.moments-content {
  padding: 12px 16px 0;
}

.moment-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: $tzl-color-surface-base;
}

.moment-card + .moment-card {
  margin-top: 20px;
}

.moment-card__avatar-column {
  flex: 0 0 40px;
}

.moment-card__content-column {
  flex: 1;
  min-width: 0;
}

.moment-card__avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #e5e7eb;
}

.moment-card__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6a7282;
  font-size: 16px;
  font-weight: 600;
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

.moment-card__image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.moment-card__image-grid--1 {
  width: 68%;
  min-width: 180px;
  max-width: 240px;
}

.moment-card__image-grid--2,
.moment-card__image-grid--4 {
  width: 100%;
  max-width: 100%;
}

.moment-card__image-grid--3,
.moment-card__image-grid--5,
.moment-card__image-grid--6,
.moment-card__image-grid--7,
.moment-card__image-grid--8,
.moment-card__image-grid--9 {
  width: 100%;
}

.moment-card__image-wrap {
  position: relative;
  width: calc((100% - 12px) / 3);
  height: 92px;
  overflow: hidden;
  border-radius: 8px;
  background: #f1f5f9;
}

.moment-card__image-grid--2 .moment-card__image-wrap,
.moment-card__image-grid--4 .moment-card__image-wrap {
  width: calc((100% - 6px) / 2);
  height: 121px;
}

.moment-card__image-grid--1 .moment-card__image-wrap {
  width: 100%;
  height: 188px;
  border-radius: 12px;
}

.moment-card__image {
  width: 100%;
  height: 100%;
  display: block;
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
  padding: 8px 12px;
  border-radius: 8px;
  background: $tzl-color-surface-muted;
}

.moment-card__comment {
  display: block;
}

.moment-card__comment + .moment-card__comment {
  margin-top: 8px;
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

.moments-floating-publish {
  position: fixed;
  right: 20px;
  bottom: calc(env(safe-area-inset-bottom) + 92px);
  z-index: 120;
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: 0 12px 28px rgba(255, 138, 54, 0.34);
}

.moments-floating-publish__plus {
  color: #ffffff;
  font-size: 34px;
  line-height: 56px;
  font-weight: 300;
  transform: translateY(-1px);
}

.moment-comment-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 130;
  background: #f8f8f8;
  transition: transform 0.18s ease;
}

.moment-comment-composer {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 16px;
  box-sizing: border-box;
  border-top: 1px solid #e5e7eb;
  background: #f8f8f8;
}

.moment-comment-composer__input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  box-sizing: border-box;
  border-radius: 2px;
  background: #ffffff;
  color: #111111;
  font-size: 16px;
  line-height: 40px;
}

.moment-comment-composer__icon {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  color: #222222;
  text-align: center;
  font-size: 30px;
  line-height: 34px;
}

.moment-comment-composer__send {
  flex: 0 0 52px;
  height: 34px;
  border-radius: 4px;
  background: #07c160;
  color: #ffffff;
  text-align: center;
  font-size: 15px;
  font-weight: 500;
  line-height: 34px;
}

.moment-comment-composer__send--disabled {
  background: #c8c9cc;
}

</style>
