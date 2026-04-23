<template>
  <page-scaffold
    class="moments-page"
    body-padding="0"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <view v-if="isCheckingAuth || isRedirecting" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">
        {{ isRedirecting ? '正在前往登录页...' : '正在恢复首页...' }}
      </text>
    </view>

    <scroll-view v-else-if="session" scroll-y class="moments-scroll">
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

    <template v-if="session" #floating>
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
  name: 'MomentsIndexPage',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDidShow } from '@tarojs/taro'
import { getCommentNotificationSummary, type PostCommentNotificationSummary } from '../../apis/post'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession } from '../../auth/session'
import { ensureAuthenticatedSession, redirectToAuthPage, showPendingToast } from '../../utils/auth-guard'
import { syncCustomTabBar } from '../../utils/custom-tab-bar'

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

const isCheckingAuth = ref(true)
const isRedirecting = ref(false)
const notificationSummary = ref<PostCommentNotificationSummary | null>(null)

let refreshMomentsPromise: Promise<void> | null = null

const session = computed(() => authSession.value)
const notificationAvatarUrl = computed(() => {
  const latestAvatar = notificationSummary.value?.latest?.actorAvatar.trim()
  return latestAvatar ? latestAvatar : momentsDesign.notificationAvatarUrl
})
const notificationText = computed(() => {
  const unreadCount = notificationSummary.value?.unreadCount ?? 0
  return unreadCount > 0 ? `${unreadCount}条新消息` : '暂无新消息'
})

function handleFeaturePending(featureName: string) {
  showPendingToast(`${featureName} 待接入`)
}

async function refreshMomentsData() {
  if (refreshMomentsPromise) {
    return refreshMomentsPromise
  }

  refreshMomentsPromise = getCommentNotificationSummary()
    .then((summary) => {
      notificationSummary.value = summary
    })
    .catch(() => undefined)
    .then(() => undefined)
    .finally(() => {
      refreshMomentsPromise = null
    })

  return refreshMomentsPromise
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
  await refreshMomentsData()
  isCheckingAuth.value = false
}

useDidShow(() => {
  syncCustomTabBar('/pages/index/index')
  void preparePage()
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
  height: 100%;
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
