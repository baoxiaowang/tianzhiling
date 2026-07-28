import Taro from '@tarojs/taro'
import { computed, ref } from 'vue'
import {
  getPostNotificationEntrySummary,
  markPostNotificationEntrySeen,
  type PostNotificationEntrySummary,
  type PostNotificationItem,
} from '../apis/post'
import { ApiException } from '../api/api-exception'
import {
  authSession,
  registerAuthSessionClearListener,
  restoreAuthSession,
} from '../auth/session'

const NOTIFICATION_POLL_INTERVAL_MS = 10 * 1000
const NOTIFICATION_RETRY_AFTER_ERROR_MS = 60 * 1000
const LEGACY_NOTIFICATION_SEEN_STORAGE_PREFIX = 'post_notification_seen_v1'

const notificationSummary = ref<PostNotificationEntrySummary | null>(null)

let notificationPollingTimer: ReturnType<typeof setInterval> | null = null
let notificationRefreshPromise: Promise<void> | null = null
let notificationAcknowledgementPromise: Promise<void> | null = null
let shouldRefreshNotificationSummaryAgain = false
let isClearListenerRegistered = false
let nextNotificationRetryAt = 0
let notificationMutationVersion = 0

export const unseenPostNotificationCount = computed(() => {
  return notificationSummary.value?.unseenCount ?? 0
})
export const latestUnseenPostNotification = computed(() => {
  return notificationSummary.value?.latestUnseen ?? null
})
export const hasUnseenPostNotifications = computed(() => {
  return unseenPostNotificationCount.value > 0
})

export function markAllPostNotificationsSeenLocally(
  latestNotification?: PostNotificationItem,
) {
  notificationMutationVersion += 1
  const summary = notificationSummary.value

  if (!summary) {
    if (latestNotification) {
      persistLegacyNotificationSeenItem(latestNotification)
    }
    return
  }

  persistLegacyNotificationSeenMarker(summary)
  notificationSummary.value = {
    ...summary,
    unseenCount: 0,
    latestUnseen: null,
  }
}

export async function acknowledgePostNotificationEntry(
  latestNotification?: PostNotificationItem,
) {
  markAllPostNotificationsSeenLocally(latestNotification)

  if (notificationAcknowledgementPromise) {
    return notificationAcknowledgementPromise
  }

  notificationAcknowledgementPromise = Promise.resolve()
    .then(() => markPostNotificationEntrySeen())
    .catch(() => undefined)
    .finally(async () => {
      notificationAcknowledgementPromise = null
      await refreshCommentNotificationSummary(true)
    })

  return notificationAcknowledgementPromise
}

export async function refreshCommentNotificationSummary(force = false) {
  if (notificationRefreshPromise) {
    shouldRefreshNotificationSummaryAgain = true
    return notificationRefreshPromise
  }

  if (!force && nextNotificationRetryAt > Date.now()) {
    return
  }

  if (!authSession.value) {
    notificationSummary.value = null
    stopCommentNotificationPolling(true)
    return
  }

  const refreshMutationVersion = notificationMutationVersion

  notificationRefreshPromise = Promise.resolve()
    .then(async () => {
      const nextSummary = await getPostNotificationEntrySummary()
      const compatibleSummary = applyLegacyNotificationSeenMarker(nextSummary)

      if (refreshMutationVersion === notificationMutationVersion) {
        notificationSummary.value = compatibleSummary
      }
      nextNotificationRetryAt = 0
    })
    .catch((error) => {
      if (error instanceof ApiException && error.requiresReLogin) {
        notificationSummary.value = null
        stopCommentNotificationPolling(true)
        return
      }

      nextNotificationRetryAt = Date.now() + NOTIFICATION_RETRY_AFTER_ERROR_MS
    })

  await notificationRefreshPromise
  notificationRefreshPromise = null

  if (shouldRefreshNotificationSummaryAgain) {
    shouldRefreshNotificationSummaryAgain = false
    await refreshCommentNotificationSummary(true)
  }
}

export async function startCommentNotificationPolling() {
  await restoreAuthSession()

  if (!authSession.value) {
    stopCommentNotificationPolling(true)
    return
  }

  if (!notificationPollingTimer) {
    notificationPollingTimer = setInterval(() => {
      void refreshCommentNotificationSummary()
    }, NOTIFICATION_POLL_INTERVAL_MS)
  }

  await refreshCommentNotificationSummary()
}

export function stopCommentNotificationPolling(clearSummary = false) {
  if (notificationPollingTimer) {
    clearInterval(notificationPollingTimer)
    notificationPollingTimer = null
  }

  if (clearSummary) {
    notificationMutationVersion += 1
    notificationSummary.value = null
  }

  shouldRefreshNotificationSummaryAgain = false
  nextNotificationRetryAt = 0
}

export function initCommentNotificationPolling() {
  if (!isClearListenerRegistered) {
    registerAuthSessionClearListener(() => {
      stopCommentNotificationPolling(true)
    })
    isClearListenerRegistered = true
  }

  void startCommentNotificationPolling()
}

export interface PostNotificationSeenMarker {
  notificationId: string
  createdAt: string
}

function applyLegacyNotificationSeenMarker(
  summary: PostNotificationEntrySummary,
): PostNotificationEntrySummary {
  if (!summary.isLegacyFallback || !summary.latestUnseen) {
    return summary
  }

  const marker = loadLegacyNotificationSeenMarker()

  if (!marker) {
    return summary
  }

  const latestNotificationId = summary.latestUnseen.id.trim()
  const latestCreatedAt = summary.latestUnseen.createdAt?.trim() ?? ''
  const hasAlreadyBeenSeen = (
    Boolean(latestNotificationId && latestNotificationId === marker.notificationId)
    || Boolean(
      !latestNotificationId
      && isAtOrBeforeSeenMarker(latestCreatedAt, marker.createdAt),
    )
  )

  if (hasAlreadyBeenSeen) {
    return {
      ...summary,
      unseenCount: 0,
      latestUnseen: null,
    }
  }

  return {
    ...summary,
    unseenCount: summary.unseenCount > 0 ? 1 : 0,
  }
}

function persistLegacyNotificationSeenMarker(summary: PostNotificationEntrySummary) {
  if (!summary.latestUnseen) {
    return
  }

  persistLegacyNotificationSeenItem(summary.latestUnseen)
}

function persistLegacyNotificationSeenItem(item: PostNotificationItem) {
  const storageKey = getLegacyNotificationSeenStorageKey()
  const notificationId = item.id.trim()
  const createdAt = item.createdAt?.trim() ?? ''

  if (!storageKey || (!notificationId && !createdAt)) {
    return
  }

  const marker: PostNotificationSeenMarker = {
    notificationId,
    createdAt,
  }

  try {
    Taro.setStorageSync(storageKey, JSON.stringify(marker))
  } catch {
    // A failed compatibility marker must not block opening the message page.
  }
}

export function getPersistedPostNotificationSeenMarker(): PostNotificationSeenMarker | null {
  return loadLegacyNotificationSeenMarker()
}

function loadLegacyNotificationSeenMarker(): PostNotificationSeenMarker | null {
  const storageKey = getLegacyNotificationSeenStorageKey()

  if (!storageKey) {
    return null
  }

  try {
    const rawValue = Taro.getStorageSync<string>(storageKey)
    const parsedValue = rawValue ? JSON.parse(rawValue) : null

    if (!parsedValue || typeof parsedValue !== 'object') {
      return null
    }

    const marker = parsedValue as Partial<PostNotificationSeenMarker>

    return {
      notificationId: typeof marker.notificationId === 'string'
        ? marker.notificationId.trim()
        : '',
      createdAt: typeof marker.createdAt === 'string'
        ? marker.createdAt.trim()
        : '',
    }
  } catch {
    return null
  }
}

function getLegacyNotificationSeenStorageKey() {
  const userId = authSession.value?.user.id.trim()

  return userId
    ? `${LEGACY_NOTIFICATION_SEEN_STORAGE_PREFIX}:${userId}`
    : ''
}

function isAtOrBeforeSeenMarker(value: string, markerValue: string) {
  const valueTime = Date.parse(value)
  const markerTime = Date.parse(markerValue)

  return Number.isFinite(valueTime)
    && Number.isFinite(markerTime)
    && valueTime <= markerTime
}
