import Taro from '@tarojs/taro'
import { authSession, restoreAuthSession } from '../auth/session'

let ensureSessionPromise: Promise<boolean> | null = null

export async function redirectToAuthPage() {
  await Taro.reLaunch({
    url: '/pages/auth/index',
  })
}

export async function ensureAuthenticatedSession() {
  if (ensureSessionPromise) {
    return ensureSessionPromise
  }

  ensureSessionPromise = Promise.resolve()
    .then(async () => {
      await restoreAuthSession()
      return Boolean(authSession.value)
    })
    .finally(() => {
      ensureSessionPromise = null
    })

  return ensureSessionPromise
}

export function showPendingToast(message: string) {
  void Taro.showToast({
    title: message,
    icon: 'none',
    duration: 1800,
  })
}
