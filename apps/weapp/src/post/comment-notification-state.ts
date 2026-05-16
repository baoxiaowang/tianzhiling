import { computed, ref } from 'vue'
import {
  getCommentNotificationSummary,
  type PostCommentNotificationSummary,
} from '../apis/post'
import { ApiException } from '../api/api-exception'
import {
  authSession,
  registerAuthSessionClearListener,
  restoreAuthSession,
} from '../auth/session'

const NOTIFICATION_POLL_INTERVAL_MS = 10000

const notificationSummary = ref<PostCommentNotificationSummary | null>(null)

let notificationPollingTimer: ReturnType<typeof setInterval> | null = null
let isRefreshingNotificationSummary = false
let isClearListenerRegistered = false

export const unreadCommentNotificationCount = computed(() => {
  return notificationSummary.value?.unreadCount ?? 0
})
export const latestUnreadCommentNotification = computed(() => {
  return notificationSummary.value?.latest ?? null
})
export const hasUnreadCommentNotifications = computed(() => {
  return unreadCommentNotificationCount.value > 0 && Boolean(latestUnreadCommentNotification.value)
})

export async function refreshCommentNotificationSummary() {
  if (isRefreshingNotificationSummary) {
    return
  }

  if (!authSession.value) {
    notificationSummary.value = null
    stopCommentNotificationPolling(true)
    return
  }

  isRefreshingNotificationSummary = true

  try {
    notificationSummary.value = await getCommentNotificationSummary()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      notificationSummary.value = null
      stopCommentNotificationPolling(true)
    }
  } finally {
    isRefreshingNotificationSummary = false
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

  void refreshCommentNotificationSummary()
}

export function stopCommentNotificationPolling(clearSummary = false) {
  if (notificationPollingTimer) {
    clearInterval(notificationPollingTimer)
    notificationPollingTimer = null
  }

  if (clearSummary) {
    notificationSummary.value = null
  }
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
