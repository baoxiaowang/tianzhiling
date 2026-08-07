import { createApp } from 'vue'
import Taro from '@tarojs/taro'
import { silentWeappLogin } from './auth/login-hooks'
import { authSession, restoreAuthSession } from './auth/session'
import { ensureInnerAudioPlaybackOptions } from './utils/audio'
import { initSafeAreaInsets } from './utils/safe-area'
import { reportPerformanceEvent } from './utils/product-analytics'

import './app.scss'

const isVoiceTrainingTestMode =
  process.env.TARO_APP_VOICE_TRAINING_TEST_MODE === 'true'

let didAttemptRecovery = false
let isRecovering = false
const APP_ERROR_STORAGE_KEY = '__tzl_last_app_error__'
const RECOVERY_COUNT_STORAGE_KEY = '__tzl_recovery_count__'
const POST_FEED_CACHE_KEY = 'tzl_post_feed_cache_v1'

const FALLBACK_LAUNCH_PAGE = '/pages/index/index'
const FALLBACK_ONBOARDING_PAGE = '/pages/onboarding/index'
const MAX_RECOVERY_ATTEMPTS = 2
const FALLBACK_ROUTES = [FALLBACK_ONBOARDING_PAGE, FALLBACK_LAUNCH_PAGE]
const RECOVERY_COUNT_TTL_MS = 30_000

function getPersistedRecoveryCount(): number {
  try {
    const raw = Taro.getStorageSync<{ count: number; ts: number }>(RECOVERY_COUNT_STORAGE_KEY)
    if (raw && Date.now() - (raw.ts || 0) < RECOVERY_COUNT_TTL_MS) {
      return raw.count || 0
    }
  } catch { /* ignore */ }
  return 0
}

function setPersistedRecoveryCount(count: number) {
  try {
    Taro.setStorageSync(RECOVERY_COUNT_STORAGE_KEY, { count, ts: Date.now() })
  } catch { /* ignore */ }
}

function clearStaleCachesOnRecovery() {
  try { Taro.removeStorageSync(POST_FEED_CACHE_KEY) } catch { /* ignore */ }
}

function recoverToOnboardingRoute() {
  const persistedCount = getPersistedRecoveryCount()
  if (isRecovering || didAttemptRecovery || persistedCount >= MAX_RECOVERY_ATTEMPTS) {
    return
  }

  isRecovering = true
  didAttemptRecovery = true
  setPersistedRecoveryCount(persistedCount + 1)
  clearStaleCachesOnRecovery()

  const recoverAttempt = async () => {
    for (const url of FALLBACK_ROUTES) {
      try {
        await Taro.reLaunch({ url })
        return
      } catch {
        try {
          await Taro.redirectTo({ url })
          return
        } catch {
          // continue
        }
      }
    }
  }

  void recoverAttempt().catch(() => {
    // Keep recovery resumable for the next trigger.
  }).finally(() => {
    isRecovering = false
    didAttemptRecovery = false
  })
}

function persistAppError(error: unknown) {
  try {
    const fallback = String(error)
    Taro.setStorageSync(APP_ERROR_STORAGE_KEY, fallback)
  } catch {
    // Ignore storage failures; diagnostics are best-effort.
  }
}

const App = createApp({
  onLaunch() {
    const launchStartedAt = Date.now()
    initSafeAreaInsets()
    void ensureInnerAudioPlaybackOptions()
    reportPerformanceEvent('app_launch', 'app', Date.now() - launchStartedAt)

    // The isolated voice test page owns its login so stale production sessions
    // cannot block or redirect the test bootstrap.
    if (isVoiceTrainingTestMode) {
      return
    }

    // Clear stale recovery count when app starts successfully.
    try { Taro.removeStorageSync(RECOVERY_COUNT_STORAGE_KEY) } catch { /* ignore */ }

    void restoreAuthSession()
      .then(async () => {
        if (!authSession.value?.accessToken) {
          await silentWeappLogin()
        }

        reportPerformanceEvent(
          'route_visible',
          'app_session_ready',
          Date.now() - launchStartedAt,
          authSession.value?.accessToken ? 'authenticated' : 'guest',
        )
      })
      .catch(() => {
        reportPerformanceEvent('route_visible', 'app_session_ready', Date.now() - launchStartedAt, 'guest')
      })
  },
  onError(error) {
    persistAppError(
      error && typeof error === 'object' && 'message' in error
        ? `Unhandled app error: ${(error as Error).message}`
        : `Unhandled app error: ${String(error)}`
    )
    recoverToOnboardingRoute()
  },
  onPageNotFound(e) {
    persistAppError(`onPageNotFound: ${String(e?.path || 'unknown')}`)
    recoverToOnboardingRoute()
  },
  // 入口组件不需要实现 render 方法，即使实现了也会被 taro 所覆盖
})

export default App
