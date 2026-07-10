<template>
  <page-scaffold
    class="my-posts-page"
    background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    @scroll-to-lower="handleScrollToLower"
  >
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
      <moment-card
        v-for="post in posts"
        :key="post.id"
        :post="post"
        show-owner-actions
        show-moderation-status
        :show-comment-action="false"
        :is-deleting="isPostDeletePending(post.id)"
        @like="handleLikeTap"
        @delete="handleDeleteTap"
        @preview="handlePreviewImages"
      />
      <view class="my-posts-load-footer">
        <text v-if="isLoadingMore" class="my-posts-load-footer__text">正在加载更多...</text>
        <text
          v-else-if="loadMoreError"
          class="my-posts-load-footer__action"
          @tap="handleLoadMoreRetry"
        >
          加载失败，点此重试
        </text>
        <text v-else-if="!hasMorePosts" class="my-posts-load-footer__text">没有更多动态了</text>
      </view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'MyPostsPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow } from '@tarojs/taro'
import { computed, onMounted, ref } from 'vue'
import {
  deletePost,
  getPosts,
  likePost,
  unlikePost,
  type PostItem,
} from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import MomentCard from '../../components/moment-card/moment-card.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'

const posts = ref<PostItem[]>([])
const isCheckingAuth = ref(true)
const isLoading = ref(true)
const isLoadingMore = ref(false)
const errorMessage = ref('')
const loadMoreError = ref('')
const likingPostIds = ref<string[]>([])
const deletingPostIds = ref<string[]>([])
const currentPostPage = ref(1)
const hasMorePosts = ref(true)

const session = computed(() => authSession.value)
const MY_POSTS_PAGE_SIZE = 20

let loadingPromise: Promise<void> | null = null
let loadMorePromise: Promise<void> | null = null
let isPreviewingPostImage = false

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
      currentPostPage.value = 1
      hasMorePosts.value = false
      await redirectToAuth()
      return
    }

    isCheckingAuth.value = false
    loadMoreError.value = ''

    try {
      const postResult = await getPosts({
        page: 1,
        pageSize: MY_POSTS_PAGE_SIZE,
        mine: true,
      })
      posts.value = postResult.items
      currentPostPage.value = postResult.page
      hasMorePosts.value = postResult.hasMore
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

async function loadMoreMyPosts() {
  if (
    loadingPromise ||
    loadMorePromise ||
    isLoading.value ||
    isLoadingMore.value ||
    !hasMorePosts.value
  ) {
    return loadMorePromise
  }

  isLoadingMore.value = true
  loadMoreError.value = ''

  loadMorePromise = getPosts({
    page: currentPostPage.value + 1,
    pageSize: MY_POSTS_PAGE_SIZE,
    mine: true,
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
      loadMorePromise = null
      isLoadingMore.value = false
    })

  return loadMorePromise
}

function handleRetry() {
  void loadMyPosts(false)
}

function handleLoadMoreRetry() {
  void loadMoreMyPosts()
}

function handleScrollToLower() {
  void loadMoreMyPosts()
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

function isPostDeletePending(postId: string) {
  return deletingPostIds.value.includes(postId)
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

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

async function handleLikeTap(post: PostItem) {
  if (!session.value) {
    await redirectToAuth()
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
    showToast(error instanceof ApiException ? error.message : '点赞失败，请稍后重试')
  } finally {
    setPostLikePending(post.id, false)
  }
}

async function handleDeleteTap(post: PostItem) {
  if (!session.value) {
    await redirectToAuth()
    return
  }

  if (isPostDeletePending(post.id)) {
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
    showToast('动态已删除')
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    showToast(error instanceof ApiException ? error.message : '删除失败，请稍后重试')
  } finally {
    setPostDeletePending(post.id, false)
  }
}

function getPostImages(post: PostItem) {
  return post.images
    .map((image) => image.trim())
    .filter(Boolean)
    .slice(0, 9)
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

onMounted(() => {
  void loadMyPosts()
})

useDidShow(() => {
  if (isPreviewingPostImage) {
    isPreviewingPostImage = false
    return
  }

  void loadMyPosts(false)
})
</script>

<style lang="scss">
.my-posts-page {
  min-height: 100vh;
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
  padding: 12px 16px 28px;
}

.my-posts-list .moment-card + .moment-card {
  margin-top: 20px;
}

.my-posts-load-footer {
  min-height: 40px;
  padding: 16px 0 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.my-posts-load-footer__text,
.my-posts-load-footer__action {
  color: #98a2b3;
  font-size: 12px;
  line-height: 18px;
}

.my-posts-load-footer__action {
  color: #4f8f6f;
}

</style>
