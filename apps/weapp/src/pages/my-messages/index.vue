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

    <view v-else-if="!hasAnyNotifications" class="my-messages-state">
      <text class="my-messages-state__title">暂无消息</text>
    </view>

    <scroll-view
      v-else
      class="my-messages-scroll"
      scroll-y
      @scrolltolower="handleScrollToLower"
    >
      <view class="my-messages-list">
        <view v-if="unreadNotifications.length" class="my-messages-section">
          <view class="my-messages-section__header">
            <text class="my-messages-section__title">未读消息</text>
          </view>
          <view
            v-for="item in unreadNotifications"
            :key="item.id"
            class="my-messages-item"
            hover-class="my-messages-item--pressed"
            @tap="handleNotificationTap(item)"
          >
            <view class="my-messages-item__unread-dot" />
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
              <view class="my-messages-item__title-row">
                <text class="my-messages-item__name">{{ item.actorName || '新消息' }}</text>
                <text class="my-messages-item__type">{{ getNotificationTypeText(item) }}</text>
              </view>
              <text v-if="item.type !== 'like'" class="my-messages-item__content">
                {{ formatNotificationContent(item) }}
              </text>
              <text class="my-messages-item__time">{{ formatNotificationTime(item.createdAt) }}</text>
            </view>

            <image
              v-if="item.postThumbnail"
              class="my-messages-item__thumb"
              :src="item.postThumbnail"
              mode="aspectFill"
            />
            <view
              v-else-if="item.postContentPreview"
              class="my-messages-item__thumb my-messages-item__thumb--text"
            >
              <text>{{ item.postContentPreview }}</text>
            </view>
          </view>
        </view>

        <view v-else class="my-messages-empty-unread">
          <text class="my-messages-empty-unread__title">暂无未读消息</text>
          <text class="my-messages-empty-unread__subtitle">点赞和评论回复会在这里提醒你</text>
        </view>

        <view
          v-if="shouldShowHistoryToggle"
          class="my-messages-history-toggle"
          hover-class="my-messages-history-toggle--pressed"
          @tap="handleToggleHistory"
        >
          <text class="my-messages-history-toggle__title">
            {{ isHistoryExpanded ? '收起历史互动消息' : '查看历史互动消息' }}
          </text>
        </view>

        <view
          v-if="isHistoryExpanded && historyNotifications.length"
          class="my-messages-section my-messages-section--history"
        >
          <view
            v-for="item in historyNotifications"
            :key="item.id"
            class="my-messages-item my-messages-item--history"
            hover-class="my-messages-item--pressed"
            @tap="handleNotificationTap(item)"
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
              <view class="my-messages-item__title-row">
                <text class="my-messages-item__name">{{ item.actorName || '新消息' }}</text>
                <text class="my-messages-item__type">{{ getNotificationTypeText(item) }}</text>
              </view>
              <text v-if="item.type !== 'like'" class="my-messages-item__content">
                {{ formatNotificationContent(item) }}
              </text>
              <text class="my-messages-item__time">{{ formatNotificationTime(item.createdAt) }}</text>
            </view>

            <image
              v-if="item.postThumbnail"
              class="my-messages-item__thumb"
              :src="item.postThumbnail"
              mode="aspectFill"
            />
            <view
              v-else-if="item.postContentPreview"
              class="my-messages-item__thumb my-messages-item__thumb--text"
            >
              <text>{{ item.postContentPreview }}</text>
            </view>
          </view>
        </view>

        <view v-if="isHistoryExpanded" class="my-messages-load-footer">
          <text v-if="isLoadingMore" class="my-messages-load-footer__text">正在加载更多...</text>
          <text
            v-else-if="loadMoreError"
            class="my-messages-load-footer__action"
            @tap="handleLoadMoreRetry"
          >
            加载失败，点击重试
          </text>
          <text v-else-if="!hasMoreNotifications" class="my-messages-load-footer__text">
            没有更多历史消息了
          </text>
        </view>
        <view
          v-else-if="hasMoreUnreadNotifications"
          class="my-messages-load-footer"
        >
          <text v-if="isLoadingMore" class="my-messages-load-footer__text">正在加载更多未读消息...</text>
          <text
            v-else-if="loadMoreError"
            class="my-messages-load-footer__action"
            @tap="handleLoadMoreRetry"
          >
            加载失败，点击重试
          </text>
          <text v-else class="my-messages-load-footer__text">继续上滑加载更多未读消息</text>
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
import { computed, onMounted, ref } from 'vue'
import {
  getPostDetail,
  getPostNotificationEntrySummary,
  getPostNotifications,
  markPostNotificationRead,
  type PostNotificationItem,
} from '../../apis/post'
import { ApiException } from '../../api/api-exception'
import { authSession, restoreAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import {
  acknowledgePostNotificationEntry,
  getPersistedPostNotificationSeenMarker,
  refreshCommentNotificationSummary,
  type PostNotificationSeenMarker,
} from '../../post/comment-notification-state'

const unreadNotifications = ref<PostNotificationItem[]>([])
const historyNotifications = ref<PostNotificationItem[]>([])
const isCheckingAuth = ref(true)
const isLoading = ref(false)
const isLoadingMore = ref(false)
const errorMessage = ref('')
const loadMoreError = ref('')
const currentPage = ref(1)
const hasMoreUnreadNotifications = ref(false)
const hasMoreNotifications = ref(false)
const isHistoryExpanded = ref(false)

let loadingPromise: Promise<void> | null = null
let loadMorePromise: Promise<void> | null = null
let pendingReadRetryPromise: Promise<void> | null = null
let entrySeenMarker: PostNotificationSeenMarker | null = null
let lastPageClassifiedUnreadCount = 0
const MESSAGE_PAGE_SIZE = 20
const POST_VALIDATION_CONCURRENCY = 4
const INITIAL_NEW_MESSAGE_WINDOW_MS = 15 * 60 * 1000
const PENDING_READ_STORAGE_PREFIX = 'post_notification_read_pending_v2'
const LEGACY_READ_STORAGE_PREFIX = 'post_notification_read_v1'
const MESSAGE_BASELINE_STORAGE_PREFIX = 'post_notification_center_baseline_v1'
const postAvailabilityById = new Map<string, boolean>()
const notificationEntryContext = readNotificationEntryContext()

const hasAnyNotifications = computed(() => {
  return unreadNotifications.value.length > 0 || historyNotifications.value.length > 0
})
const shouldShowHistoryToggle = computed(() => {
  return historyNotifications.value.length > 0
    || hasMoreNotifications.value
})

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
        unreadNotifications.value = []
        historyNotifications.value = []
        await redirectToAuth()
        return
      }

      isCheckingAuth.value = false
      entrySeenMarker = loadNotificationCenterBaseline()
        ?? getPersistedPostNotificationSeenMarker()
      const [result] = await Promise.all([
        getPostNotifications({
          page: 1,
          pageSize: MESSAGE_PAGE_SIZE,
        }),
        ensureNotificationEntryContext(),
      ])

      replaceNotificationPage(result.items)
      persistNotificationCenterBaseline(result.items[0])
      currentPage.value = result.page
      hasMoreNotifications.value = result.hasMore
      hasMoreUnreadNotifications.value = shouldLoadMoreUnreadNotifications(result.hasMore)

      isHistoryExpanded.value = false

      void pruneMissingPostNotifications(result.items)
      void acknowledgeLoadedNotifications()
      void retryPendingNotificationReads()
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

async function acknowledgeLoadedNotifications() {
  unreadNotifications.value = unreadNotifications.value.map((notification) => ({
    ...notification,
    isSeen: true,
  }))
  const latestNotification = mergeNotificationItems(
    unreadNotifications.value,
    historyNotifications.value,
  )[0]

  await acknowledgePostNotificationEntry(latestNotification).catch(() => undefined)
}

async function loadMoreMessages() {
  const hasMoreCurrentSection = isHistoryExpanded.value
    ? hasMoreNotifications.value
    : hasMoreUnreadNotifications.value

  if (loadMorePromise || isLoading.value || !hasMoreCurrentSection) {
    return loadMorePromise
  }

  isLoadingMore.value = true
  loadMoreError.value = ''

  const nextPage = currentPage.value + 1

  loadMorePromise = getPostNotifications({
    page: nextPage,
    pageSize: MESSAGE_PAGE_SIZE,
  })
    .then((result) => {
      appendNotificationPage(result.items)
      currentPage.value = result.page
      hasMoreNotifications.value = result.hasMore
      hasMoreUnreadNotifications.value = shouldLoadMoreUnreadNotifications(result.hasMore)
      void pruneMissingPostNotifications(result.items)
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

function handleToggleHistory() {
  isHistoryExpanded.value = !isHistoryExpanded.value

  if (
    isHistoryExpanded.value
    && historyNotifications.value.length === 0
    && hasMoreNotifications.value
  ) {
    void loadMoreMessages()
  }
}

function handleNotificationTap(item: PostNotificationItem) {
  const postId = getNotificationPostId(item)

  if (item.isRead !== true) {
    markNotificationAsRead(item)
  }

  if (!postId) {
    void Taro.showToast({
      title: '缺少动态路径',
      icon: 'none',
      duration: 1800,
    })
    return
  }

  const url = `/pages/post-detail/index?postId=${encodeURIComponent(postId)}`

  void Taro.navigateTo({ url }).catch(() => {
    void Taro.showToast({
      title: '打开动态失败',
      icon: 'none',
      duration: 1800,
    })
  })
}

function markNotificationAsRead(item: PostNotificationItem) {
  const readItem = {
    ...item,
    isSeen: true,
    isRead: true,
  }

  enqueuePendingNotificationRead(item)
  unreadNotifications.value = unreadNotifications.value.filter(
    (notification) => notification.id !== item.id,
  )
  historyNotifications.value = mergeNotificationItems(
    [readItem],
    historyNotifications.value,
  )

  void persistNotificationRead(item)
}

async function persistNotificationRead(item: PostNotificationItem) {
  try {
    await markPostNotificationRead(item.id)
    await refreshCommentNotificationSummary()
  } catch {
    // Keep the local pending state until a later list response confirms the read.
  }
}

function applyPendingReadState(items: PostNotificationItem[]) {
  const readKeys = new Set(
    loadPendingNotificationReads().flatMap((item) => getPendingReadKeys(item)),
  )

  if (!readKeys.size) {
    return items
  }

  return items.map((item) =>
    getNotificationReadKeys(item).some((key) => readKeys.has(key))
      ? {
          ...item,
          isSeen: true,
          isRead: true,
        }
      : item,
  )
}

function reconcileConfirmedPendingReads(items: PostNotificationItem[]) {
  const confirmedReadKeys = new Set(
    items
      .filter((item) => item.isRead === true)
      .flatMap((item) => getNotificationReadKeys(item)),
  )

  if (!confirmedReadKeys.size) {
    return
  }

  const pendingReads = loadPendingNotificationReads()
  const nextPendingReads = pendingReads.filter(
    (pendingRead) =>
      !getPendingReadKeys(pendingRead).some((key) => confirmedReadKeys.has(key)),
  )

  if (nextPendingReads.length !== pendingReads.length) {
    savePendingNotificationReads(nextPendingReads)
  }
}

interface PendingNotificationRead {
  notificationId: string
  commentId: string
}

function enqueuePendingNotificationRead(item: PostNotificationItem) {
  const pendingReads = loadPendingNotificationReads()
  const nextPendingRead: PendingNotificationRead = {
    notificationId: typeof item.id === 'string' ? item.id.trim() : '',
    commentId: typeof item.commentId === 'string' ? item.commentId.trim() : '',
  }

  if (!nextPendingRead.notificationId) {
    return
  }
  const nextPendingReads = [
    ...pendingReads.filter(
      (pendingRead) => pendingRead.notificationId !== nextPendingRead.notificationId,
    ),
    nextPendingRead,
  ]

  savePendingNotificationReads(nextPendingReads)
}

function loadPendingNotificationReads(): PendingNotificationRead[] {
  const storageKey = getPendingReadStorageKey()

  if (!storageKey) {
    return []
  }

  try {
    const storedValue = Taro.getStorageSync<string>(storageKey)
    const parsedValue = storedValue ? JSON.parse(storedValue) : []

    if (Array.isArray(parsedValue) && parsedValue.length > 0) {
      return parsePendingNotificationReads(parsedValue)
    }

    return migrateLegacyPendingNotificationReads()
  } catch {
    return []
  }
}

function parsePendingNotificationReads(values: unknown[]): PendingNotificationRead[] {
  return values.flatMap((value): PendingNotificationRead[] => {
    if (!value || typeof value !== 'object') {
      return []
    }

    const record = value as Partial<PendingNotificationRead>
    const notificationId = typeof record.notificationId === 'string'
      ? record.notificationId.trim()
      : ''

    if (!notificationId) {
      return []
    }

    return [{
      notificationId,
      commentId: typeof record.commentId === 'string'
        ? record.commentId.trim()
        : '',
    }]
  })
}

function migrateLegacyPendingNotificationReads() {
  const userId = authSession.value?.user.id.trim()

  if (!userId) {
    return []
  }

  const legacyStorageKey = `${LEGACY_READ_STORAGE_PREFIX}:${userId}`

  try {
    const storedValue = Taro.getStorageSync<string>(legacyStorageKey)
    const parsedValue = storedValue ? JSON.parse(storedValue) : []
    const pendingReads = Array.isArray(parsedValue)
      ? parsedValue.flatMap((value): PendingNotificationRead[] => {
          if (typeof value !== 'string' || !value.startsWith('id:')) {
            return []
          }

          const notificationId = value.slice(3).trim()
          return notificationId
            ? [{ notificationId, commentId: '' }]
            : []
        })
      : []

    if (pendingReads.length > 0) {
      savePendingNotificationReads(pendingReads)
    }
    Taro.removeStorageSync(legacyStorageKey)
    return pendingReads
  } catch {
    return []
  }
}

function savePendingNotificationReads(items: PendingNotificationRead[]) {
  const storageKey = getPendingReadStorageKey()

  if (!storageKey) {
    return
  }

  try {
    if (items.length === 0) {
      Taro.removeStorageSync(storageKey)
      return
    }

    Taro.setStorageSync(storageKey, JSON.stringify(items))
  } catch {
    // Pending reads will be retried only when local storage is available.
  }
}

function retryPendingNotificationReads() {
  if (pendingReadRetryPromise) {
    return pendingReadRetryPromise
  }

  const pendingReads = loadPendingNotificationReads()

  pendingReadRetryPromise = Promise.all(
    pendingReads.map(async (pendingRead) => {
      try {
        await markPostNotificationRead(pendingRead.notificationId)
      } catch {
        // Retry on the next page load; list reconciliation clears confirmed reads.
      }
    }),
  )
    .then(() => undefined)
    .finally(() => {
      pendingReadRetryPromise = null
    })

  return pendingReadRetryPromise
}

function getPendingReadStorageKey() {
  const userId = authSession.value?.user.id.trim()

  return userId
    ? `${PENDING_READ_STORAGE_PREFIX}:${userId}`
    : ''
}

function getNotificationReadKeys(item: PostNotificationItem) {
  const keys = item.id ? [`id:${item.id}`] : []

  if (item.commentId) {
    keys.push(`comment:${item.commentId}`)
  }

  return keys
}

function getPendingReadKeys(item: PendingNotificationRead) {
  const keys = item.notificationId ? [`id:${item.notificationId}`] : []

  if (item.commentId) {
    keys.push(`comment:${item.commentId}`)
  }

  return keys
}

interface NotificationEntryContext {
  hasSnapshot: boolean
  unseenCount: number
  latestNotificationId: string
  latestCreatedAt: string
}

function readNotificationEntryContext(): NotificationEntryContext {
  const params = Taro.getCurrentInstance().router?.params ?? {}
  const rawUnseenCount = readRouterParam(params.unseenCount)
  const parsedUnseenCount = Number(rawUnseenCount)

  return {
    hasSnapshot: rawUnseenCount !== '',
    unseenCount: Number.isFinite(parsedUnseenCount)
      ? Math.max(0, Math.floor(parsedUnseenCount))
      : 0,
    latestNotificationId: readRouterParam(params.latestNotificationId),
    latestCreatedAt: readRouterParam(params.latestCreatedAt),
  }
}

function readRouterParam(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function loadNotificationCenterBaseline(): PostNotificationSeenMarker | null {
  const storageKey = getNotificationCenterBaselineStorageKey()

  if (!storageKey) {
    return null
  }

  try {
    const rawValue = Taro.getStorageSync<string>(storageKey)
    const parsedValue = rawValue ? JSON.parse(rawValue) : null

    if (!parsedValue || typeof parsedValue !== 'object') {
      return null
    }

    const baseline = parsedValue as Partial<PostNotificationSeenMarker>
    const notificationId = typeof baseline.notificationId === 'string'
      ? baseline.notificationId.trim()
      : ''
    const createdAt = typeof baseline.createdAt === 'string'
      ? baseline.createdAt.trim()
      : ''

    return notificationId || createdAt
      ? { notificationId, createdAt }
      : null
  } catch {
    return null
  }
}

function persistNotificationCenterBaseline(item?: PostNotificationItem) {
  const storageKey = getNotificationCenterBaselineStorageKey()

  if (!storageKey || !item) {
    return
  }

  try {
    Taro.setStorageSync(storageKey, JSON.stringify({
      notificationId: item.id.trim(),
      createdAt: item.createdAt?.trim() ?? '',
    }))
  } catch {
    // The server-side seen marker remains available when local storage is unavailable.
  }
}

function getNotificationCenterBaselineStorageKey() {
  const userId = authSession.value?.user.id.trim()

  return userId
    ? `${MESSAGE_BASELINE_STORAGE_PREFIX}:${userId}`
    : ''
}

async function ensureNotificationEntryContext() {
  if (notificationEntryContext.hasSnapshot) {
    return
  }

  try {
    const summary = await getPostNotificationEntrySummary()

    notificationEntryContext.hasSnapshot = true
    notificationEntryContext.unseenCount = summary.unseenCount
    notificationEntryContext.latestNotificationId = summary.latestUnseen?.id ?? ''
    notificationEntryContext.latestCreatedAt = summary.latestUnseen?.createdAt ?? ''
  } catch {
    notificationEntryContext.hasSnapshot = true
  }
}

async function filterExistingPostNotifications(items: PostNotificationItem[]) {
  const postIds = Array.from(new Set(items.map(getNotificationPostId).filter(Boolean)))
  const uncheckedPostIds = postIds.filter((postId) => !postAvailabilityById.has(postId))

  for (let index = 0; index < uncheckedPostIds.length; index += POST_VALIDATION_CONCURRENCY) {
    const postIdBatch = uncheckedPostIds.slice(index, index + POST_VALIDATION_CONCURRENCY)

    await Promise.all(postIdBatch.map(validateNotificationPost))
  }

  return items.filter((item) => {
    const postId = getNotificationPostId(item)
    return Boolean(postId && postAvailabilityById.get(postId) !== false)
  })
}

async function pruneMissingPostNotifications(items: PostNotificationItem[]) {
  const validItems = await filterExistingPostNotifications(items)

  if (validItems.length === items.length) {
    return
  }

  const validNotificationIds = new Set(validItems.map((item) => item.id))
  const checkedNotificationIds = new Set(items.map((item) => item.id))
  unreadNotifications.value = unreadNotifications.value.filter(
    (item) => validNotificationIds.has(item.id) || !checkedNotificationIds.has(item.id),
  )
  historyNotifications.value = historyNotifications.value.filter(
    (item) => validNotificationIds.has(item.id) || !checkedNotificationIds.has(item.id),
  )
}

async function validateNotificationPost(postId: string) {
  try {
    await getPostDetail(postId)
    postAvailabilityById.set(postId, true)
  } catch (error) {
    const isDeletedOrMissing = error instanceof ApiException && error.code === 'POST_NOT_FOUND'
    postAvailabilityById.set(postId, !isDeletedOrMissing)
  }
}

function replaceNotificationPage(items: PostNotificationItem[]) {
  reconcileConfirmedPendingReads(items)
  const adjustedItems = applyPendingReadState(items)
  const unreadIds = getEntryUnreadNotificationIds(adjustedItems)
  lastPageClassifiedUnreadCount = unreadIds.size

  unreadNotifications.value = adjustedItems.filter((item) => unreadIds.has(item.id))
  historyNotifications.value = adjustedItems.filter((item) => !unreadIds.has(item.id))
}

function appendNotificationPage(items: PostNotificationItem[]) {
  reconcileConfirmedPendingReads(items)
  const adjustedItems = applyPendingReadState(items)
  const unreadIds = getEntryUnreadNotificationIds(adjustedItems)
  lastPageClassifiedUnreadCount = unreadIds.size

  unreadNotifications.value = mergeNotificationItems(
    unreadNotifications.value,
    adjustedItems.filter((item) => unreadIds.has(item.id)),
  )
  historyNotifications.value = mergeNotificationItems(
    historyNotifications.value,
    adjustedItems.filter((item) => !unreadIds.has(item.id)),
  )
}

function getEntryUnreadNotificationIds(items: PostNotificationItem[]) {
  const unreadIds = new Set<string>()

  if (notificationEntryContext.unseenCount <= 0) {
    return unreadIds
  }

  const snapshotTime = parseNotificationTime(notificationEntryContext.latestCreatedAt)
  const markerTime = parseNotificationTime(entrySeenMarker?.createdAt ?? '')
  const candidates = items.filter((item) => {
    if (item.isRead === true) {
      return false
    }

    const itemTime = parseNotificationTime(item.createdAt ?? '')

    if (snapshotTime && (!itemTime || itemTime > snapshotTime)) {
      return false
    }

    if (markerTime) {
      if (itemTime > markerTime) {
        return true
      }

      return Boolean(
        itemTime === markerTime
        && notificationEntryContext.latestNotificationId
        && notificationEntryContext.latestNotificationId !== entrySeenMarker?.notificationId
        && item.id === notificationEntryContext.latestNotificationId,
      )
    }

    return item.isSeen !== true
  })
  const visibleCandidates = markerTime
    ? candidates
    : getInitialRecentNotificationBatch(candidates, snapshotTime)

  for (const item of visibleCandidates) {
    unreadIds.add(item.id)
  }

  return unreadIds
}

function shouldLoadMoreUnreadNotifications(serverHasMore: boolean) {
  return serverHasMore
    && lastPageClassifiedUnreadCount === MESSAGE_PAGE_SIZE
}

function getInitialRecentNotificationBatch(
  items: PostNotificationItem[],
  snapshotTime: number,
) {
  const newestTime = snapshotTime || parseNotificationTime(items[0]?.createdAt ?? '')

  if (!newestTime) {
    return items.slice(0, 1)
  }

  return items.filter((item) => {
    const itemTime = parseNotificationTime(item.createdAt ?? '')
    return Boolean(
      itemTime
      && newestTime - itemTime <= INITIAL_NEW_MESSAGE_WINDOW_MS,
    )
  })
}

function parseNotificationTime(value: string) {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

function mergeNotificationItems(
  currentItems: PostNotificationItem[],
  incomingItems: PostNotificationItem[],
) {
  const mergedItems = new Map<string, PostNotificationItem>()

  for (const item of [...currentItems, ...incomingItems]) {
    const existingItem = mergedItems.get(item.id)

    mergedItems.set(item.id, existingItem?.isRead === true
      ? {
          ...item,
          isSeen: true,
          isRead: true,
        }
      : item)
  }

  return Array.from(mergedItems.values()).sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0
    return rightTime - leftTime
  })
}

function getNotificationPostId(item: PostNotificationItem) {
  const rawItem = item as PostNotificationItem & Record<string, unknown>

  return (
    normalizeObjectIdString(rawItem.postId) ||
    normalizeObjectIdString(rawItem.post_id) ||
    normalizeObjectIdString(rawItem.postID) ||
    normalizeObjectIdString(rawItem.targetPostId) ||
    normalizeObjectIdString(rawItem.target_post_id) ||
    normalizeObjectIdString((rawItem.post as Record<string, unknown> | undefined)?.id) ||
    normalizeObjectIdString((rawItem.post as Record<string, unknown> | undefined)?._id)
  )
}

function normalizeObjectIdString(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>

  return (
    normalizeObjectIdString(record.$oid) ||
    normalizeObjectIdString(record.oid) ||
    normalizeObjectIdString(record.id) ||
    normalizeObjectIdString(record._id)
  )
}

function getAvatarFallback(name: string) {
  const trimmedName = name.trim()
  return trimmedName ? trimmedName.slice(0, 1) : '消'
}

function formatNotificationContent(item: PostNotificationItem) {
  if (item.type === 'like') {
    return ''
  }

  return item.contentPreview.trim() || '留下了一条评论'
}

function getNotificationTypeText(item: PostNotificationItem) {
  if (item.type === 'like') {
    return '点赞了你的动态'
  }

  const replyToUserName = item.replyToUserName.trim()
  return replyToUserName ? `回复了 ${replyToUserName}` : '评论了你的动态'
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
  box-sizing: border-box;
  border-top: 10px solid #f6f7f9;
  border-bottom: 24px solid #f6f7f9;
  background: #f6f7f9;
}

.my-messages-section {
  background: #ffffff;
}

.my-messages-section--history {
  margin-top: 8px;
}

.my-messages-section__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px 8px;
}

.my-messages-section__title {
  color: #101828;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.my-messages-empty-unread {
  margin: 0 12px;
  padding: 26px 16px;
  border-radius: 8px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.my-messages-empty-unread__title {
  color: #101828;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}

.my-messages-empty-unread__subtitle {
  color: #98a2b3;
  font-size: 13px;
  line-height: 20px;
}

.my-messages-history-toggle {
  margin-top: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
}

.my-messages-history-toggle--pressed {
  background: #f7f8fa;
}

.my-messages-history-toggle__title {
  color: #98a2b3;
  font-size: 12px;
  line-height: 18px;
  font-weight: 400;
}

.my-messages-item {
  position: relative;
  box-sizing: border-box;
  min-height: 88px;
  padding: 10px 12px 10px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  border-bottom: 1px solid #e8e8e8;
  background: #ffffff;
}

.my-messages-item--history {
  opacity: 0.86;
}

.my-messages-item--pressed {
  background: #f7f8fa;
}

.my-messages-item__unread-dot {
  position: absolute;
  left: 6px;
  top: 31px;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #ff4d4f;
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

.my-messages-item__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.my-messages-item__name {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #101828;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.my-messages-item__type {
  flex-shrink: 0;
  color: #667085;
  font-size: 12px;
  line-height: 18px;
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

.my-messages-item__thumb--text {
  box-sizing: border-box;
  padding: 6px;
  overflow: hidden;
  color: #667085;
  font-size: 11px;
  line-height: 17px;
  word-break: break-all;
}

.my-messages-item__thumb--text text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
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
