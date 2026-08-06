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
      <view
        class="moments-collapsed-app-bar"
        :class="{ 'moments-collapsed-app-bar--visible': showCollapsedAppBar }"
      >
        <app-bar
          title="动态"
          background="#ffffff"
          border-color="#eeeeee"
          :show-capsule="false"
          :show-back="false"
        />

        <view class="moments-compact-banner" @tap="handleCompactBannerTap">
          <image
            class="moments-compact-banner__img"
            :src="compactBannerUrl"
            mode="aspectFill"
          />
        </view>

        <view class="moments-compact-row">
          <view
            class="moments-compact-row__avatar"
            @tap="handleProfileEntryTap"
          >
            <image
              v-if="currentUserAvatar"
              class="moments-compact-row__avatar-img"
              :src="currentUserAvatar"
              mode="aspectFill"
            />
            <view v-else class="moments-compact-row__avatar-fallback">
              {{ currentUserAvatarFallback }}
            </view>
          </view>

          <view
            v-if="hasUnreadNotifications"
            class="moments-compact-row__notice"
            @tap="handleNotificationTap"
          >
            <image
              v-if="notificationAvatarUrl"
              class="moments-compact-row__notice-avatar"
              :src="notificationAvatarUrl"
              mode="aspectFill"
            />
            <view v-else class="moments-compact-row__notice-avatar moments-compact-row__notice-avatar--fallback">
              <text>{{ notificationAvatarFallback }}</text>
            </view>
            <text class="moments-compact-row__notice-text">{{ notificationText }}</text>
          </view>
        </view>
      </view>

      <scroll-view
        class="moments-scroll"
        :scroll-y="true"
        :show-scrollbar="false"
        :refresher-enabled="true"
        :refresher-triggered="isPullRefreshing"
        refresher-background="#ffffff"
        :lower-threshold="120"
        @scroll="handleMomentsScroll"
        @refresherrefresh="handlePullRefresh"
        @scrolltolower="handleScrollBottom"
      >
        <view class="moments-leading">
          <top-promo-banner />

          <view
            class="moments-profile-entry"
            hover-class="moments-profile-entry--pressed"
            @tap="handleProfileEntryTap"
          >
            <image
              v-if="currentUserAvatar"
              class="moments-profile-entry__avatar"
              :src="currentUserAvatar"
              mode="aspectFill"
            />
            <view v-else class="moments-profile-entry__fallback">
              {{ currentUserAvatarFallback }}
            </view>
          </view>

          <view
            v-if="hasUnreadNotifications"
            class="moments-notice"
            hover-class="moments-notice--pressed"
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

          <moments-ticker />
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

        <view v-else class="moments-feed">
          <view
            v-for="(item, index) in posts"
            :key="item.id"
            class="moments-feed__item"
          >
            <moment-card
              :post="item"
              :show-owner-actions="isMyPost(item)"
              :show-moderation-status="isMyPost(item)"
              show-comment-action
              :is-deleting="isPostDeletePending(item.id)"
              @like="handleLikeTap"
              @comment="handleCommentTap"
              @delete="handleDeleteTap"
              @preview="handlePreviewImages"
            />

            <view v-if="isLastPostRow(index)" class="moments-load-footer">
              <text v-if="isLoadingMore" class="moments-load-footer__text">正在加载更多...</text>
              <text v-else-if="loadMoreError" class="moments-load-footer__action" @tap="handleLoadMoreRetry">
                加载失败，点击重试
              </text>
              <text v-else-if="!hasMorePosts" class="moments-load-footer__text">没有更多动态了</text>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>

    <view class="moments-floating-publish" @tap="handleCreatePost">
      <view class="moments-floating-publish__camera">
        <view class="moments-floating-publish__lens" />
      </view>
    </view>

    <template #overlay>
      <view
        v-show="activeCommentPost"
        class="moment-comment-backdrop"
        @tap="handleCommentOutsideTap"
      />

      <view
        v-show="activeCommentPost"
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
            :placeholder="commentInputPlaceholder"
            placeholder-style="color: #b8b8b8;"
            confirm-type="send"
            :adjust-position="false"
            cursor-spacing="16"
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
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'MomentsIndexPage',
}
</script>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import Taro, { useDidHide, useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { buildOssMediaUrl } from '@tzl/shared'
import {
  createComment,
  deletePost,
  getCachedPostFeed,
  getPosts,
  likePost,
  unlikePost,
  type PostCommentItem,
  type PostItem,
} from '../../apis/post'
import { preloadConversations } from '../../apis/conversation'
import { ApiException } from '../../api/api-exception'
import keyboardIconUrl from '../../assets/icon/keyboard.svg'
import AppBar from '../../components/app-bar/app-bar.vue'
import EmojiPickerPanel from '../../components/emoji-picker-panel/emoji-picker-panel.vue'
import MomentCard from '../../components/moment-card/moment-card.vue'
import MomentsTicker from '../../components/moments-ticker/moments-ticker.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import TopPromoBanner from '../../components/top-promo-banner/top-promo-banner.vue'
import { authSession, restoreAuthSession } from '../../auth/session'
import {
  hasUnseenPostNotifications,
  initCommentNotificationPolling,
  latestUnseenPostNotification,
  refreshCommentNotificationSummary,
  unseenPostNotificationCount,
} from '../../post/comment-notification-state'
import { syncCustomTabBar } from '../../utils/custom-tab-bar'
import { reportPerformanceEvent } from '../../utils/product-analytics'

interface PageScaffoldController {
  openLoginPrompt: () => void
}

const momentsPageStartedAt = Date.now()
let hasReportedCachedContent = false
let hasReportedFirstData = false

const pageScaffoldRef = ref<PageScaffoldController | null>(null)
const isCheckingAuth = ref(true)
const isPostsLoading = ref(false)
const isPullRefreshing = ref(false)
const hasLoadedPosts = ref(false)
const errorMessage = ref('')
const loadMoreError = ref('')
const posts = ref<PostItem[]>([])
const activeCommentPost = ref<PostItem | null>(null)
const activeReplyComment = ref<PostCommentItem | null>(null)
const commentDraft = ref('')
const commentKeyboardHeight = ref(0)
const isCommentInputFocused = ref(false)
const shouldFocusCommentInput = ref(false)
const isSubmittingComment = ref(false)
const isCommentEmojiPanelVisible = ref(false)
const likingPostIds = ref<string[]>([])
const deletingPostIds = ref<string[]>([])
const currentPostPage = ref(1)
const hasMorePosts = ref(true)
const isLoadingMore = ref(false)
const showCollapsedAppBar = ref(false)

let refreshDataPromise: Promise<void> | null = null
let loadMorePromise: Promise<void> | null = null
let isSwitchingCommentInputMode = false
let commentInputSwitchingTimer: ReturnType<typeof setTimeout> | null = null
let commentBlurCloseTimer: ReturnType<typeof setTimeout> | null = null
let commentFocusTimer: ReturnType<typeof setTimeout> | null = null
let conversationPreloadTimer: ReturnType<typeof setTimeout> | null = null
let lastKnownMomentsScrollTop = 0
let isPreviewingPostImage = false

const POST_PAGE_SIZE = 10
const TOP_PROMO_BANNER_HEIGHT = 220
const COLLAPSED_APP_BAR_SHOW_SCROLL_TOP = 188
const COLLAPSED_APP_BAR_HIDE_SCROLL_TOP = 172
const COMMENT_BLUR_CLOSE_DELAY = 120
const COMPACT_BANNER_URL = buildOssMediaUrl('/weapp/post-banner-vip.png')
const COMPACT_BANNER_LINK = '/pages/vip-center/index'

const MOMENTS_SHARE_PATH = '/pages/index/index'

const session = computed(() => authSession.value)
const compactBannerUrl = computed(() => COMPACT_BANNER_URL)
const currentUserAvatar = computed(() => normalizeText(session.value?.user?.avatar))
const currentUserAvatarFallback = computed(() => {
  const name = normalizeText(session.value?.user?.name)
  const account = normalizeText(session.value?.user?.account)
  const fallback = name || account || '我'

  return fallback.slice(0, 1)
})
const hasUnreadNotifications = hasUnseenPostNotifications
const notificationAvatarUrl = computed(() => {
  return normalizeText(latestUnseenPostNotification.value?.actorAvatar)
})
const notificationAvatarFallback = computed(() => {
  const actorName = normalizeText(latestUnseenPostNotification.value?.actorName)
  return actorName ? actorName.slice(0, 1) : '评'
})
const notificationText = computed(() => {
  const unseenCount = unseenPostNotificationCount.value
  const displayCount = unseenCount > 99 ? '99+' : String(unseenCount)
  return unseenCount > 0 ? `${displayCount}条新消息` : '暂无新消息'
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
const commentInputPlaceholder = computed(() => {
  const replyName = activeReplyComment.value
    ? getReplyTargetName(activeReplyComment.value)
    : ''

  return replyName ? `@${replyName}` : '发表评论:'
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

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getPostImages(post: PostItem) {
  return post.images
    .map(normalizeText)
    .filter(Boolean)
    .slice(0, 9)
}

function getReplyTargetName(comment: PostCommentItem) {
  return normalizeText(comment.replyToUserName) || normalizeText(comment.authorName) || '天之灵用户'
}

function isPostLikePending(postId: string) {
  return likingPostIds.value.includes(postId)
}

function isPostDeletePending(postId: string) {
  return deletingPostIds.value.includes(postId)
}

function isMyPost(post: PostItem) {
  const userId = session.value?.user?.id

  return Boolean(userId && post.userId === userId)
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

function setPostDeletePending(postId: string, pending: boolean) {
  if (pending) {
    if (!deletingPostIds.value.includes(postId)) {
      deletingPostIds.value = [...deletingPostIds.value, postId]
    }
    return
  }

  deletingPostIds.value = deletingPostIds.value.filter((item) => item !== postId)
}

function isLastPostRow(index: unknown) {
  return Number(index) === posts.value.length - 1
}

function normalizeScrollTop(value: unknown) {
  const scrollTop = Number(value ?? 0)
  return Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
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

function appendCommentToPost(postId: string, comment: PostCommentItem) {
  posts.value = posts.value.map((item) => {
    if (item.id !== postId) {
      return item
    }

    const currentComments = Array.isArray(item.comments) ? item.comments : []

    if (currentComments.some((existingComment) => existingComment.id === comment.id)) {
      return item
    }

    const nextComments = [...currentComments, comment]
    const currentCommentCount = Number.isFinite(item.commentCount)
      ? item.commentCount
      : currentComments.length

    return {
      ...item,
      comments: nextComments,
      commentCount: Math.max(currentCommentCount + 1, nextComments.length),
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
      if (!hasReportedFirstData) {
        hasReportedFirstData = true
        reportPerformanceEvent(
          'first_data',
          'moments',
          Date.now() - momentsPageStartedAt,
          'network',
        )
      }
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

  try {
    await Promise.race([
      restoreAuthSession().catch(() => undefined),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 3000)
      }),
    ])

    if (!hasLoadedPosts.value) {
      let cachedFeed: ReturnType<typeof getCachedPostFeed>
      try {
        cachedFeed = getCachedPostFeed(POST_PAGE_SIZE)
      } catch (error) {
        console.error('[moments] cached feed read failed', error)
      }

      if (cachedFeed?.items.length) {
        posts.value = cachedFeed.items
        currentPostPage.value = cachedFeed.page
        hasMorePosts.value = cachedFeed.hasMore
        hasLoadedPosts.value = true
        isCheckingAuth.value = false
        if (!hasReportedCachedContent) {
          hasReportedCachedContent = true
          reportPerformanceEvent(
            'first_cached_content',
            'moments',
            Date.now() - momentsPageStartedAt,
            'storage',
          )
        }
      }
    }

    await refreshMomentsData(!hasLoadedPosts.value)
    scheduleConversationPreload()
  } catch (error) {
    console.error('[moments] preparePage failed', error)
  } finally {
    isCheckingAuth.value = false
  }
}

function handleRetry() {
  void refreshMomentsData(true)
}

async function handlePullRefresh() {
  if (isPullRefreshing.value) {
    return
  }

  isPullRefreshing.value = true

  try {
    await refreshMomentsData(false)

    if (errorMessage.value && posts.value.length > 0) {
      showToast(errorMessage.value)
    }
  } finally {
    isPullRefreshing.value = false
  }
}

function handleLoadMoreRetry() {
  void loadMorePosts()
}

function handleMomentsScroll(event: { detail?: { scrollTop?: number } }) {
  const scrollTop = normalizeScrollTop(event.detail?.scrollTop)

  lastKnownMomentsScrollTop = scrollTop

  if (showCollapsedAppBar.value) {
    if (scrollTop <= COLLAPSED_APP_BAR_HIDE_SCROLL_TOP) {
      showCollapsedAppBar.value = false
    }
    return
  }

  if (scrollTop >= COLLAPSED_APP_BAR_SHOW_SCROLL_TOP) {
    showCollapsedAppBar.value = true
  }
}

function handleScrollBottom() {
  if (shouldShowPostsFeedback.value) {
    return
  }

  void loadMorePosts()
}

function handleCompactBannerTap() {
  void Taro.navigateTo({ url: COMPACT_BANNER_LINK })
}

function handleProfileEntryTap() {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  void Taro.switchTab({
    url: '/pages/me/index',
  })
}

function handleNotificationTap() {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  const latestNotification = latestUnseenPostNotification.value
  const queryParts = [
    `unseenCount=${encodeURIComponent(String(unseenPostNotificationCount.value))}`,
  ]

  if (latestNotification?.id) {
    queryParts.push(`latestNotificationId=${encodeURIComponent(latestNotification.id)}`)
  }

  if (latestNotification?.createdAt) {
    queryParts.push(`latestCreatedAt=${encodeURIComponent(latestNotification.createdAt)}`)
  }

  void Taro.navigateTo({
    url: `/pages/my-messages/index?${queryParts.join('&')}`,
  }).catch(() => {
    void refreshCommentNotificationSummary()
    showToast('打开消息失败，请稍后重试')
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

function openCommentComposer(post: PostItem, replyToComment?: PostCommentItem) {
  clearCommentBlurCloseTimer()
  clearCommentFocusTimer()
  activeCommentPost.value = post
  activeReplyComment.value = replyToComment ?? null
  commentDraft.value = ''
  shouldFocusCommentInput.value = false
  isCommentEmojiPanelVisible.value = false

  void nextTick(() => {
    commentFocusTimer = setTimeout(() => {
      commentFocusTimer = null

      if (activeCommentPost.value) {
        shouldFocusCommentInput.value = true
      }
    }, 80)
  })
}

function handleCommentTap(post: PostItem, replyToComment?: PostCommentItem) {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  openCommentComposer(post, replyToComment)
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

async function handleDeleteTap(post: PostItem) {
  if (!session.value) {
    openLoginPrompt()
    return
  }

  if (!isMyPost(post) || isPostDeletePending(post.id)) {
    return
  }

  const result = await Taro.showModal({
    title: '删除动态',
    content: '删除后这条动态将不再展示，确认删除吗？',
    confirmText: '删除',
    confirmColor: '#cf1322',
  })

  if (!result.confirm) {
    return
  }

  setPostDeletePending(post.id, true)

  try {
    await deletePost(post.id)
    posts.value = posts.value.filter((item) => item.id !== post.id)

    if (activeCommentPost.value?.id === post.id) {
      closeCommentComposer(true)
    }

    void refreshCommentNotificationSummary()
    showToast('动态已删除')
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      openLoginPrompt()
      return
    }

    showToast(error instanceof ApiException ? error.message : '删除失败，请稍后重试')
  } finally {
    setPostDeletePending(post.id, false)
  }
}

function closeCommentComposer(force = false) {
  if (isSubmittingComment.value && !force) {
    return
  }

  clearCommentBlurCloseTimer()
  clearCommentFocusTimer()
  resetCommentInputModeSwitching()
  activeCommentPost.value = null
  activeReplyComment.value = null
  commentDraft.value = ''
  shouldFocusCommentInput.value = false
  isCommentInputFocused.value = false
  commentKeyboardHeight.value = 0
  isCommentEmojiPanelVisible.value = false
}

function clearCommentBlurCloseTimer() {
  if (commentBlurCloseTimer) {
    clearTimeout(commentBlurCloseTimer)
    commentBlurCloseTimer = null
  }
}

function clearCommentFocusTimer() {
  if (commentFocusTimer) {
    clearTimeout(commentFocusTimer)
    commentFocusTimer = null
  }
}

function scheduleCommentCloseAfterBlur() {
  clearCommentBlurCloseTimer()

  commentBlurCloseTimer = setTimeout(() => {
    commentBlurCloseTimer = null

    if (
      !activeCommentPost.value ||
      isSubmittingComment.value ||
      isSwitchingCommentInputMode ||
      isCommentInputFocused.value ||
      isCommentEmojiPanelVisible.value
    ) {
      return
    }

    closeCommentComposer()
  }, COMMENT_BLUR_CLOSE_DELAY)
}

function handleCommentInputLostFocus() {
  if (isSwitchingCommentInputMode || isCommentEmojiPanelVisible.value) {
    return
  }

  scheduleCommentCloseAfterBlur()
}

function handleCommentFocus() {
  clearCommentBlurCloseTimer()
  isCommentInputFocused.value = true
}

function handleCommentBlur() {
  isCommentInputFocused.value = false
  shouldFocusCommentInput.value = false
  handleCommentInputLostFocus()
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
  const wasCommentInputFocused = isCommentInputFocused.value
  commentKeyboardHeight.value = event.detail?.height ?? 0

  if (commentKeyboardHeight.value <= 0) {
    isCommentInputFocused.value = false

    if (wasCommentInputFocused) {
      handleCommentInputLostFocus()
    }
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
    const comment = await createComment(post.id, {
      content,
      replyToCommentId: activeReplyComment.value?.id,
    })

    appendCommentToPost(post.id, comment)
    commentDraft.value = ''
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

  isPreviewingPostImage = true
  void Taro.previewImage({
    urls,
    current,
  })
}

function showMomentsShareMenu() {
  void Taro.showShareMenu({
    showShareItems: ['shareAppMessage', 'shareTimeline'],
  }).catch(() => undefined)
}

useShareAppMessage(() => ({
  title: MOMENTS_SHARE_TITLE,
  path: MOMENTS_SHARE_PATH,
}))

useShareTimeline(() => ({
  title: MOMENTS_SHARE_TITLE,
}))

useDidShow(() => {
  syncCustomTabBar('/pages/index/index')
  showMomentsShareMenu()
  initCommentNotificationPolling()

  if (isPreviewingPostImage) {
    isPreviewingPostImage = false
    return
  }

  void preparePage()
})

function scheduleConversationPreload() {
  if (!authSession.value || conversationPreloadTimer) {
    return
  }

  conversationPreloadTimer = setTimeout(() => {
    conversationPreloadTimer = null
    preloadConversations()
  }, 1500)
}

useDidHide(() => {
  if (conversationPreloadTimer) {
    clearTimeout(conversationPreloadTimer)
    conversationPreloadTimer = null
  }

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
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: $tzl-color-surface-base;
}

.moments-collapsed-app-bar {
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 118;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-8px);
  transition: opacity 0.14s ease, transform 0.14s ease;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}

.moments-collapsed-app-bar--visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}

.moments-compact-banner {
  height: 60px;
  overflow: hidden;
  background: #f8fafc;
}

.moments-compact-banner__img {
  width: 100%;
  height: 60px;
  display: block;
}

.moments-compact-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 16px;
  box-sizing: border-box;
  background: #ffffff;
}

.moments-compact-row__avatar {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  overflow: hidden;
}

.moments-compact-row__avatar-img,
.moments-compact-row__avatar-fallback {
  width: 30px;
  height: 30px;
  display: block;
}

.moments-compact-row__avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
}

.moments-compact-row__notice {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: #4c4c4c;
}

.moments-compact-row__notice-avatar {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  flex-shrink: 0;
}

.moments-compact-row__notice-avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 9px;
  font-weight: 600;
}

.moments-compact-row__notice-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ffffff;
  font-size: 12px;
  line-height: 18px;
}

.moments-scroll {
  flex: 1;
  height: 100%;
  box-sizing: border-box;
  min-height: 0;
  background: $tzl-color-surface-base;
}

.moments-leading {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.moments-profile-entry {
  position: absolute;
  top: 188px;
  left: 22px;
  z-index: 3;
  width: 64px;
  height: 64px;
  box-sizing: border-box;
  padding: 4px;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16);
}

.moments-profile-entry--pressed {
  opacity: 0.82;
}

.moments-profile-entry__avatar,
.moments-profile-entry__fallback {
  width: 56px;
  height: 56px;
  border-radius: 12px;
}

.moments-profile-entry__avatar {
  display: block;
  background: $tzl-color-surface-subtle;
}

.moments-profile-entry__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
  color: #ffffff;
  font-size: 24px;
  font-weight: 700;
}

.moments-notice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  margin: 14px auto 2px;
  padding: 0 12px;
  border-radius: 6px;
  background: #4c4c4c;
}

.moments-notice--pressed {
  opacity: 0.82;
}

.moments-notice-spacer {
  height: 52px;
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

.moments-feed {
  padding: 0 4px;
  box-sizing: border-box;
  background: $tzl-color-surface-base;
}

.moments-feed__item + .moments-feed__item {
  // margin-top: 20px;
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
  bottom: calc(env(safe-area-inset-bottom) + 148px);
  z-index: 120;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(42, 42, 42, 0.92);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.26);
}

.moments-floating-publish__camera {
  position: relative;
  width: 25px;
  height: 18px;
  box-sizing: border-box;
  border: 2px solid #ffffff;
  border-radius: 4px;
}

.moments-floating-publish__camera::before {
  content: '';
  position: absolute;
  left: 5px;
  top: -6px;
  width: 10px;
  height: 5px;
  box-sizing: border-box;
  border: 2px solid #ffffff;
  border-bottom: 0;
  border-radius: 3px 3px 0 0;
}

.moments-floating-publish__camera::after {
  content: '';
  position: absolute;
  right: 3px;
  top: 3px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #ffffff;
}

.moments-floating-publish__lens {
  position: absolute;
  left: 7px;
  top: 4px;
  width: 7px;
  height: 7px;
  box-sizing: border-box;
  border: 2px solid #ffffff;
  border-radius: 50%;
}

.moment-comment-backdrop {
  position: absolute;
  inset: 0;
  z-index: 10000;
  background: transparent;
}

.moment-comment-dock {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10001;
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
