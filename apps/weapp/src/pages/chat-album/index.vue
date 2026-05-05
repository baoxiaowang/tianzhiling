<template>
  <page-scaffold
    class="chat-album-page"
    background="#f7f7f7"
    body-padding="0"
    :scroll="false"
    :safe-area-top="false"
    require-auth
    auth-loading-text="正在恢复相册信息..."
    login-placeholder-subtitle="登录后可查看聊天相册"
  >
    <template #header>
      <app-bar title="聊天相册" background="#f7f7f7" :show-capsule="true" />
    </template>

    <view v-if="isCheckingAuth || isLoading" class="chat-album-state">
      <view class="chat-album-state__dot" />
      <text class="chat-album-state__text">
        {{ isCheckingAuth ? '正在恢复会话...' : '正在加载聊天相册...' }}
      </text>
    </view>

    <view v-else-if="loadError" class="chat-album-state">
      <text class="chat-album-state__title">相册加载失败</text>
      <text class="chat-album-state__text">{{ loadError }}</text>
      <view class="chat-album-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else-if="!albumImages.length" class="chat-album-state">
      <text class="chat-album-state__title">暂无图片</text>
      <text class="chat-album-state__text">聊天记录里的图片会自动收录到这里。</text>
    </view>

    <scroll-view v-else scroll-y class="chat-album-scroll">
      <view class="chat-album-list">
        <view
          v-for="group in groupedAlbumImages"
          :key="group.key"
          class="chat-album-group"
        >
          <text class="chat-album-group__title">{{ group.title }}</text>
          <view class="chat-album-grid">
            <view
              v-for="image in group.items"
              :key="image.id"
              class="chat-album-grid__item"
              @tap="handlePreviewImage(image.url)"
            >
              <image
                class="chat-album-grid__image"
                :src="image.url"
                mode="aspectFill"
              />
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'ChatAlbumPage',
}
</script>

<script setup lang="ts">
import Taro, { useLoad } from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiConfig } from '../../api/api-config'
import { ApiException } from '../../api/api-exception'
import {
  getConversationMessages,
  getConversations,
  type ConversationImagePayload,
} from '../../apis/conversation'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

type AlbumImage = {
  id: string
  url: string
  createdAt: Date | null
}

type AlbumImageGroup = {
  key: string
  title: string
  items: AlbumImage[]
}

const conversationId = ref('')
const agentId = ref('')
const albumImages = ref<AlbumImage[]>([])
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const loadError = ref('')

const allImageUrls = computed(() => albumImages.value.map((image) => image.url))
const groupedAlbumImages = computed<AlbumImageGroup[]>(() => {
  const groupMap = new Map<string, AlbumImageGroup>()

  albumImages.value.forEach((image) => {
    const key = getDateGroupKey(image.createdAt)
    const existingGroup = groupMap.get(key)

    if (existingGroup) {
      existingGroup.items.push(image)
      return
    }

    groupMap.set(key, {
      key,
      title: formatDateGroupTitle(image.createdAt),
      items: [image],
    })
  })

  return Array.from(groupMap.values())
})

useLoad((options) => {
  conversationId.value = decodeRouteParam(options?.conversationId)
  agentId.value = decodeRouteParam(options?.agentId)
  void preparePage()
})

function decodeRouteParam(value?: string) {
  if (typeof value !== 'string') {
    return ''
  }

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function preparePage() {
  isCheckingAuth.value = true
  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  isCheckingAuth.value = false
  await loadAlbumImages()
}

async function loadAlbumImages() {
  const resolvedConversationId = await resolveConversationId()

  if (!resolvedConversationId) {
    loadError.value = '缺少会话信息，请返回通讯录重新进入'
    return
  }

  isLoading.value = true
  loadError.value = ''

  try {
    const messages = await getConversationMessages(resolvedConversationId)
    const seenUrls = new Set<string>()

    albumImages.value = messages
      .filter((message) => message.type === 'image' && message.role !== 'system')
      .map((message) => ({
        id: message.id,
        url: resolveImageMessageUrl(message.image),
        createdAt: message.createdAt ?? message.updatedAt,
      }))
      .filter((image) => {
        if (!image.url || seenUrls.has(image.url)) {
          return false
        }

        seenUrls.add(image.url)
        return true
      })
      .sort((first, second) => getImageTime(second) - getImageTime(first))
  } catch (error) {
    albumImages.value = []

    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    loadError.value = error instanceof ApiException
      ? error.message
      : '聊天相册加载失败，请稍后重试'
  } finally {
    isLoading.value = false
  }
}

async function resolveConversationId() {
  if (conversationId.value) {
    return conversationId.value
  }

  if (!agentId.value) {
    return ''
  }

  const conversations = await getConversations()
  const matchedConversation = conversations.find((conversation) => {
    return conversation.agentId === agentId.value
  })
  const matchedConversationId = matchedConversation?.id ?? ''
  conversationId.value = matchedConversationId

  return matchedConversationId
}

function resolveImageMessageUrl(image?: ConversationImagePayload) {
  const directUrl = image?.url?.trim()
  if (directUrl) {
    return directUrl
  }

  const objectKey = image?.objectKey?.trim()
  if (!objectKey || !ApiConfig.mediaBaseUrl) {
    return ''
  }

  const encodedKey = objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `${ApiConfig.mediaBaseUrl}/${encodedKey}`
}

function getImageTime(image: AlbumImage) {
  const time = image.createdAt?.getTime() ?? 0
  return Number.isNaN(time) ? 0 : time
}

function getDateGroupKey(value: Date | null) {
  if (!value) {
    return 'unknown'
  }

  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`
}

function formatDateGroupTitle(value: Date | null) {
  if (!value) {
    return '未知日期'
  }

  const now = new Date()
  if (isSameDate(value, now)) {
    return '今天'
  }

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDate(value, yesterday)) {
    return '昨天'
  }

  if (value.getFullYear() === now.getFullYear()) {
    return `${value.getMonth() + 1}月${value.getDate()}日`
  }

  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`
}

function isSameDate(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
}

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

function handlePreviewImage(url: string) {
  if (!url) {
    return
  }

  void Taro.previewImage({
    current: url,
    urls: allImageUrls.value,
  })
}

function handleRetry() {
  void loadAlbumImages()
}
</script>

<style lang="scss">
.chat-album-page {
  min-height: 100vh;
}

.chat-album-scroll {
  height: 100%;
  box-sizing: border-box;
  background: #f7f7f7;
}

.chat-album-list {
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding: 18px 16px calc(32px + env(safe-area-inset-bottom));
  background: #f7f7f7;
}

.chat-album-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-album-group__title {
  color: #0a0a0a;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
}

.chat-album-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 5px;
}

.chat-album-grid__item {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 2px;
  background: #eeeeee;
}

.chat-album-grid__image {
  width: 100%;
  height: 100%;
}

.chat-album-state {
  min-height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 32px;
  text-align: center;
  background: #f7f7f7;
}

.chat-album-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.chat-album-state__title {
  color: #333333;
  font-size: 18px;
  line-height: 26px;
  font-weight: 600;
}

.chat-album-state__text {
  color: #999999;
  font-size: 14px;
  line-height: 22px;
}

.chat-album-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}
</style>
