import Taro from '@tarojs/taro'
import { ref, shallowRef } from 'vue'
import { AuthSessionData, parseAuthSessionData } from './models'

const STORAGE_KEY = 'auth_session'

export const authSession = shallowRef<AuthSessionData | null>(null)
export const authSessionReady = ref(false)

let restorePromise: Promise<void> | null = null
const clearListeners = new Set<() => void | Promise<void>>()

export async function saveAuthSession(value: AuthSessionData) {
  authSession.value = value
  Taro.setStorageSync(STORAGE_KEY, JSON.stringify(value))
}

export async function clearAuthSession() {
  authSession.value = null
  Taro.removeStorageSync(STORAGE_KEY)
  await Promise.all(Array.from(clearListeners).map((listener) => listener()))
}

export function registerAuthSessionClearListener(listener: () => void | Promise<void>) {
  clearListeners.add(listener)

  return () => {
    clearListeners.delete(listener)
  }
}

export async function restoreAuthSession() {
  if (authSessionReady.value) {
    return
  }

  if (restorePromise) {
    return restorePromise
  }

  restorePromise = Promise.resolve().then(async () => {
    const rawSession = Taro.getStorageSync<string>(STORAGE_KEY)

    if (!rawSession) {
      authSessionReady.value = true
      return
    }

    try {
      const session = parseAuthSessionData(JSON.parse(rawSession) as unknown)

      if (!session.accessToken || session.expiresAt <= Date.now()) {
        await clearAuthSession()
        authSessionReady.value = true
        return
      }

      authSession.value = session
    } catch {
      await clearAuthSession()
    }

    authSessionReady.value = true
  }).finally(() => {
    restorePromise = null
  })

  return restorePromise
}
