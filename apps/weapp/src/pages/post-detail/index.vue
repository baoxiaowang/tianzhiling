<template>
  <page-scaffold
    class="post-detail-page"
    background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <view v-if="isCheckingAuth || isLoading" class="post-detail-state">
      <view class="post-detail-state__dot" />
      <text class="post-detail-state__title">
        {{ isCheckingAuth ? '正在确认登录状态...' : '正在加载动态...' }}
      </text>
    </view>

    <view v-else-if="errorMessage" class="post-detail-state post-detail-state--card">
      <text class="post-detail-state__title">{{ errorMessage }}</text>
      <view class="post-detail-state__action" @tap="handleRetry">重新加载</view>
    </view>

    <view v-else-if="!post" class="post-detail-state post-detail-state--card">
      <text class="post-detail-state__title">动态不存在</text>
      <text class="post-detail-state__subtitle">这条动态可能已被删除</text>
    </view>

    <view v-else class="post-detail-content">
      <moment-card
        :post="post"
        :show-owner-actions="isMyPost"
        :show-moderation-status="isMyPost"
        :show-comment-action="false"
        :is-deleting="isDeleting"
        @like="handleLikeTap"
        @delete="handleDeleteTap"
        @preview="handlePreviewImages"
      />
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'PostDetailPage',
}
</script>

<script setup lang="ts">
import Taro, { useDidShow, useLoad } from '@tarojs/taro'
import { computed, ref } from 'vue'
import {
  deletePost,
  getPostDetail,
  likePost,
  unlikePost,
  type PostItem,
} from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import { authSession, restoreAuthSession } from '../../auth/session'
import MomentCard from '../../components/moment-card/moment-card.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'

const postId = ref('')
const post = ref<PostItem | null>(null)
const isCheckingAuth = ref(true)
const isLoading = ref(true)
const errorMessage = ref('')
const isLikePending = ref(false)
const isDeleting = ref(false)

let loadingPromise: Promise<void> | null = null
let isPreviewingPostImage = false

const session = computed(() => authSession.value)
const isMyPost = computed(() => {
  return Boolean(session.value?.user.id && post.value?.userId === session.value.user.id)
})

async function redirectToAuth() {
  await Taro.reLaunch({
    url: '/pages/auth/index',
  })
}

async function loadPostDetail(showLoading = true) {
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
      post.value = null
      await redirectToAuth()
      return
    }

    isCheckingAuth.value = false

    if (!postId.value) {
      post.value = null
      errorMessage.value = '动态参数缺失'
      return
    }

    try {
      post.value = await getPostDetail(postId.value)
    } catch (error) {
      if (error instanceof ApiException && error.requiresReLogin) {
        await redirectToAuth()
        return
      }

      errorMessage.value = error instanceof ApiException
        ? error.message || '加载动态失败'
        : '加载动态失败，请稍后重试'
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
  void loadPostDetail(false)
}

function patchPostLikeState(likedByMe: boolean, likeCount: number) {
  if (!post.value) {
    return
  }

  post.value = {
    ...post.value,
    likedByMe,
    likeCount: Math.max(0, likeCount),
  }
}

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

async function handleLikeTap(currentPost: PostItem) {
  if (!session.value) {
    await redirectToAuth()
    return
  }

  if (isLikePending.value) {
    return
  }

  const nextLikedByMe = !currentPost.likedByMe
  const nextLikeCount = currentPost.likeCount + (nextLikedByMe ? 1 : -1)

  isLikePending.value = true
  patchPostLikeState(nextLikedByMe, nextLikeCount)

  try {
    post.value = nextLikedByMe
      ? await likePost(currentPost.id)
      : await unlikePost(currentPost.id)
  } catch (error) {
    patchPostLikeState(currentPost.likedByMe, currentPost.likeCount)
    showToast(error instanceof ApiException ? error.message : '点赞失败，请稍后重试')
  } finally {
    isLikePending.value = false
  }
}

async function handleDeleteTap(currentPost: PostItem) {
  if (!session.value) {
    await redirectToAuth()
    return
  }

  if (isDeleting.value) {
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

  isDeleting.value = true

  try {
    await deletePost(currentPost.id)
    showToast('动态已删除')
    await Taro.navigateBack()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuth()
      return
    }

    showToast(error instanceof ApiException ? error.message : '删除失败，请稍后重试')
  } finally {
    isDeleting.value = false
  }
}

function getPostImages(currentPost: PostItem) {
  return currentPost.images
    .map((image) => image.trim())
    .filter(Boolean)
    .slice(0, 9)
}

function handlePreviewImages(currentPost: PostItem, index: number) {
  const urls = getPostImages(currentPost)
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

useLoad((options) => {
  postId.value = typeof options.postId === 'string'
    ? decodeURIComponent(options.postId)
    : ''
  void loadPostDetail()
})

useDidShow(() => {
  if (isPreviewingPostImage) {
    isPreviewingPostImage = false
    return
  }

  if (postId.value) {
    void loadPostDetail(false)
  }
})
</script>

<style lang="scss">
.post-detail-page {
  min-height: 100vh;
}

.post-detail-content {
  padding: 12px 16px 28px;
}

.post-detail-state {
  min-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  text-align: center;
}

.post-detail-state--card {
  margin: 24px 16px 0;
  min-height: 280px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.9);
}

.post-detail-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-success;
  box-shadow: $tzl-shadow-success-sm;
}

.post-detail-state__title {
  color: #364153;
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
}

.post-detail-state__subtitle {
  color: $tzl-color-text-muted;
  font-size: 13px;
  line-height: 20px;
}

.post-detail-state__action {
  padding: 8px 18px;
  border-radius: 999px;
  background: $tzl-gradient-success;
  color: $tzl-color-surface-base;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}
</style>
