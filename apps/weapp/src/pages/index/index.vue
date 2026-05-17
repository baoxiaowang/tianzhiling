<template>
  <page-scaffold
    ref="pageScaffoldRef"
    class="moments-page"
    body-padding="0"
    background="#ffffff"
    :scroll="false"
    :safe-area-top="false"
    :safe-area-bottom="false"
  >
    <view v-if="isCheckingAuth && !hasLoadedPosts" class="loading-state">
      <view class="loading-state__dot" />
      <text class="loading-state__text">
        正在加载动态...
      </text>
    </view>

    <view v-else class="moments-main">
      <view class="moments-leading">
        <top-promo-banner />

        <view
          v-if="hasUnreadNotifications"
          class="moments-notice"
          @tap="handleNotificationTap"
        >
          <image
            v-if="notificationAvatarUrl"
            class="moments-notice__avatar"
            :src="notificationAvatarUrl"
            mode="aspectFill"
          />
          <view v-else class="moments-notice__avatar moments-notice__avatar--fallback">
            <text>{{ notificationAvatarFallback }}</text>
          </view>
          <text class="moments-notice__text">{{ notificationText }}</text>
        </view>
        <view v-else class="moments-notice-spacer" />
      </view>

      <view v-if="shouldShowPostsFeedback" class="moments-feedback">
        <view v-if="isPostsLoading" class="moments-feedback__dot" />
        <text v-else-if="errorMessage" class="moments-feedback__icon">✦</text>
        <text v-else class="moments-feedback__icon">✦</text>
        <text class="moments-feedback__title">{{ postsFeedbackTitle }}</text>
        <text v-if="postsFeedbackSubtitle" class="moments-feedback__subtitle">{{ postsFeedbackSubtitle }}</text>
        <view v-if="errorMessage && posts.length === 0" class="moments-feedback__action" @tap="handleRetry">
          重新加载
        </view>
      </view>

      <nut-list
        v-else
        class="moments-scroll"
        :list-data="posts"
        :container-height="momentsListHeight"
        :estimate-row-height="340"
        :buffer-size="4"
        :margin="20"
        @scroll-bottom="handleScrollBottom"
      >
        <template #default="{ item, index }">
          <moment-card
            :post="item"
            @like="handleLikeTap"
            @comment="handleCommentTap"
            @preview="handlePreviewImages"
          />

          <view v-if="isLastPostRow(index)" class="moments-load-footer">
            <text v-if="isLoadingMore" class="moments-load-footer__text">正在加载更多...</text>
            <text v-else-if="loadMoreError" class="moments-load-footer__action" @tap="handleLoadMoreRetry">
              加载失败，点击重试
            </text>
            <text v-else-if="!hasMorePosts" class="moments-load-footer__text">没有更多动态了</text>
          </view>
        </template>
      </nut-list>
    </view>

    <view class="moments-floating-publish" @tap="handleCreatePost">
      <text class="moments-floating-publish__plus">+</text>
    </view>

    <view
      v-if="activeCommentPost"
      class="moment-comment-backdrop"
      @tap="handleCommentOutsideTap"
    />

    <view
      v-if="activeCommentPost"
      class="moment-comment-dock"
      :style="commentComposerStyle"
      @touchstart.stop
      @tap.stop
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
          @touchstart.stop="handleCommentInputTouchStart"
          @tap.stop="handleCommentInputTap"
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
          class="moment-comment-composer__icon moment-comment-composer__icon--keyboard"
          @tap="handleCommentEmojiToggle"
        >
          <image
            class="moment-comment-composer__keyboard-icon"
            :src="keyboardIconUrl"
            mode="aspectFit"
          />
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
  getPosts,
  likePost,
  unlikePost,
  type PostItem,
} from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import keyboardIconUrl from '../../assets/icon/keyboard.svg'
import EmojiPickerPanel from '../../components/emoji-picker-panel/emoji-picker-panel.vue'
import MomentCard from '../../components/moment-card/moment-card.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import TopPromoBanner from '../../components/top-promo-banner/top-promo-banner.vue'
import { authSession, restoreAuthSession } from '../../auth/session'
import {
  hasUnreadCommentNotifications,
  latestUnreadCommentNotification,
  unreadCommentNotificationCount,
} from '../../post/comment-notification-state'
import { setCustomTabBarHidden, syncCustomTabBar } from '../../utils/custom-tab-bar'

interface PageScaffoldController {
  openLoginPrompt: () => void
}

const pageScaffoldRef = ref<PageScaffoldController | null>(null)
const isCheckingAuth = ref(true)
const isPostsLoading = ref(false)
const hasLoadedPosts = ref(false)
const errorMessage = ref('')
const loadMoreError = ref('')
const posts = ref<PostItem[]>([])
const activeCommentPost = ref<PostItem | null>(null)
const commentDraft = ref('')
const commentKeyboardHeight = ref(0)
const isCommentInputFocused = ref(false)
const shouldFocusCommentInput = ref(false)
const isSubmittingComment = ref(false)
const isCommentEmojiPanelVisible = ref(false)
const likingPostIds = ref<string[]>([])
const currentPostPage = ref(1)
const hasMorePosts = ref(true)
const isLoadingMore = ref(false)

let refreshDataPromise: Promise<void> | null = null
let loadMorePromise: Promise<void> | null = null
let isSwitchingCommentInputMode = false
let commentInputSwitchingTimer: ReturnType<typeof setTimeout> | null = null

const POST_PAGE_SIZE = 10
const momentsWindowHeight = Taro.getSystemInfoSync().windowHeight
const TOP_PROMO_BANNER_HEIGHT = 220
const NOTICE_BLOCK_HEIGHT = 52
const NOTICE_SPACER_HEIGHT = 12

const session = computed(() => authSession.value)
const hasUnreadNotifications = hasUnreadCommentNotifications
const notificationAvatarUrl = computed(() => {
  return latestUnreadCommentNotification.value?.actorAvatar.trim() ?? ''
})
const notificationAvatarFallback = computed(() => {
  const actorName = latestUnreadCommentNotification.value?.actorName.trim() ?? ''
  return actorName ? actorName.slice(0, 1) : '评'
})
const notificationText = computed(() => {
  const unreadCount = unreadCommentNotificationCount.value
  return unreadCount > 0 ? `${unreadCount}条新消息` : '暂无新消息'
})
const momentsListHeight = computed(() => {
  const noticeHeight = hasUnreadNotifications.value
    ? NOTICE_BLOCK_HEIGHT
    : NOTICE_SPACER_HEIGHT

  return Math.max(0, momentsWindowHeight - TOP_PROMO_BANNER_HEIGHT - noticeHeight)
})
const shouldShowPostsFeedback = computed(() => {
  return isPostsLoading.value || (posts.value.length === 0 && (Boolean(errorMessage.value) || hasLoadedPosts.value))
})
const postsFeedbackTitle = computed(() => {
  if (isPostsLoading.value) {
    return '正在加载动态...'
  }

  if (errorMessage.value) {
    return errorMessage.value
  }

  return '还没有动态'
})
const postsFeedbackSubtitle = computed(() => {
  return !isPostsLoading.value && !errorMessage.value
    ? '发布第一条内容，让想念留下痕迹'
    : ''
})
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

function getPostImages(post: PostItem) {
  return post.images
    .map((image) => image.trim())
    .filter(Boolean)
    .slice(0, 9)
}

function isPostLikePending(postId: string) {
  return likingPostIds.value.includes(postId)
}

function setPostLikePending(postId: string, pending: boolean) {
  if (pending) {
    if (!likingPostIds.value.includes(postId)) {
      likingPostIds.value = [...likingPostIds.value, postId]
    }
    return
  }

  likingPostIds.value = likingPostIds.value.filter((item) => item !== postId)
}

function isLastPostRow(index: unknown) {
  return Number(index) === posts.value.length - 1
}

function replacePostInList(updatedPost: PostItem) {
  posts.value = posts.value.map((item) =>
    item.id === updatedPost.id ? updatedPost : item
  )
}

function patchPostLikeState(postId: string, likedByMe: boolean, likeCount: number) {
  posts.value = posts.value.map((item) => {
    if (item.id !== postId) {
      return item
    }

    return {
      ...item,
      likedByMe,
      likeCount: Math.max(0, likeCount),
    }
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

      loadMoreError.value = ''

      const postResult = await getPosts({
        page: 1,
        pageSize: POST_PAGE_SIZE,
      })

      posts.value = postResult.items
      currentPostPage.value = postResult.page
      hasMorePosts.value = postResult.hasMore
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

async function loadMorePosts() {
  if (loadMorePromise || isPostsLoading.value || !hasMorePosts.value) {
    return loadMorePromise
  }

  isLoadingMore.value = true
  loadMoreError.value = ''

  loadMorePromise = getPosts({
    page: currentPostPage.value + 1,
    pageSize: POST_PAGE_SIZE,
  })
    .then((result) => {
      const knownPostIds = new Set(posts.value.map((post) => post.id))
      const nextItems = result.items.filter((post) => !knownPostIds.has(post.id))

      posts.value = [...posts.value, ...nextItems]
      currentPostPage.value = result.page
      hasMorePosts.value = result.hasMore
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

function handleLoadMoreRetry() {
  void loadMorePosts()
}

function handleScrollBottom() {
  void loadMorePosts()
}

function handleNotificationTap() {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  void Taro.navigateTo({
    url: '/pages/my-messages/index',
  })
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

async function handleLikeTap(post: PostItem) {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  if (isPostLikePending(post.id)) {
    return
  }

  const nextLikedByMe = !post.likedByMe
  const nextLikeCount = post.likeCount + (nextLikedByMe ? 1 : -1)

  setPostLikePending(post.id, true)
  patchPostLikeState(post.id, nextLikedByMe, nextLikeCount)

  try {
    const updatedPost = nextLikedByMe
      ? await likePost(post.id)
      : await unlikePost(post.id)

    replacePostInList(updatedPost)
  } catch (error) {
    patchPostLikeState(post.id, post.likedByMe, post.likeCount)

    if (error instanceof ApiException && error.requiresReLogin) {
      openLoginPrompt()
      return
    }

    showToast(error instanceof ApiException ? error.message : '点赞失败，请稍后重试')
  } finally {
    setPostLikePending(post.id, false)
  }
}

function closeCommentComposer(force = false) {
  if (isSubmittingComment.value && !force) {
    return
  }

  resetCommentInputModeSwitching()
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
}

function handleCommentBlur() {
  isCommentInputFocused.value = false
  shouldFocusCommentInput.value = false
}

function handleCommentOutsideTap() {
  if (isSwitchingCommentInputMode) {
    return
  }

  closeCommentComposer()
}

function markCommentInputModeSwitching() {
  isSwitchingCommentInputMode = true

  if (commentInputSwitchingTimer) {
    clearTimeout(commentInputSwitchingTimer)
  }

  commentInputSwitchingTimer = setTimeout(() => {
    isSwitchingCommentInputMode = false
    commentInputSwitchingTimer = null
  }, 180)
}

function resetCommentInputModeSwitching() {
  isSwitchingCommentInputMode = false

  if (commentInputSwitchingTimer) {
    clearTimeout(commentInputSwitchingTimer)
    commentInputSwitchingTimer = null
  }
}

function requestCommentInputFocus() {
  if (isCommentInputFocused.value) {
    shouldFocusCommentInput.value = true
    return
  }

  shouldFocusCommentInput.value = false

  void nextTick(() => {
    shouldFocusCommentInput.value = true
  })
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

function switchCommentInputToKeyboard() {
  markCommentInputModeSwitching()

  if (isCommentEmojiPanelVisible.value) {
    isCommentEmojiPanelVisible.value = false
  }

  requestCommentInputFocus()
}

function handleCommentInputTouchStart() {
  if (!isCommentEmojiPanelVisible.value) {
    markCommentInputModeSwitching()
    return
  }

  switchCommentInputToKeyboard()
}

function handleCommentInputTap() {
  if (!isCommentEmojiPanelVisible.value && isCommentInputFocused.value) {
    return
  }

  switchCommentInputToKeyboard()
}

function handleCommentEmojiToggle() {
  markCommentInputModeSwitching()
  isCommentEmojiPanelVisible.value = !isCommentEmojiPanelVisible.value
  shouldFocusCommentInput.value = false

  if (isCommentEmojiPanelVisible.value) {
    isCommentInputFocused.value = false
    commentKeyboardHeight.value = 0
    void Taro.hideKeyboard()
  } else {
    requestCommentInputFocus()
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

.moments-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: $tzl-color-surface-base;
}

.moments-scroll {
  flex: 1;
  box-sizing: border-box;
  min-height: 100%;
  background: $tzl-color-surface-base;
}

.moments-scroll .nut-list {
  background: $tzl-color-surface-base;
}

.moments-leading {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
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
  background: rgba(255, 255, 255, 0.16);
}

.moments-notice__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: $tzl-color-surface-base;
  font-size: 12px;
  font-weight: 600;
}

.moments-notice__text {
  font-size: 14px;
  line-height: 20px;
  color: $tzl-color-surface-base;
}

.moments-feedback {
  flex: 1;
  background: $tzl-color-surface-base;
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

.moments-scroll .nut-list-item + .nut-list-item {
  margin-top: 20px;
}

.moments-load-footer {
  min-height: 64px;
  padding: 18px 24px 128px;
  box-sizing: border-box;
  text-align: center;
}

.moments-load-footer__text,
.moments-load-footer__action {
  font-size: 13px;
  line-height: 20px;
  color: #8a94a6;
}

.moments-load-footer__action {
  color: #00a63e;
  font-weight: 600;
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

.moment-comment-backdrop {
  position: fixed;
  inset: 0;
  z-index: 125;
  background: transparent;
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

.moment-comment-composer__icon--keyboard {
  display: flex;
  align-items: center;
  justify-content: center;
}

.moment-comment-composer__keyboard-icon {
  width: 30px;
  height: 30px;
}

</style>
