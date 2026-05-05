<template>
  <page-scaffold
    class="my-posts-page"
    background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
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
        @preview="handlePreviewImages"
      />
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
import { getPosts, type PostItem } from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import MomentCard from '../../components/moment-card/moment-card.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { authSession, restoreAuthSession } from '../../auth/session'

const posts = ref<PostItem[]>([])
const isCheckingAuth = ref(true)
const isLoading = ref(true)
const errorMessage = ref('')

const session = computed(() => authSession.value)
const currentUserId = computed(() => session.value?.user.id.trim() ?? '')

let loadingPromise: Promise<void> | null = null

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

  void Taro.previewImage({
    urls,
    current,
  })
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

</style>
