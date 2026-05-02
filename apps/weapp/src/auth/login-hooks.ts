import Taro from '@tarojs/taro'
import { computed, ref } from 'vue'
import { ApiException, weappLogin, weappPhoneLogin } from './api'
import { authSession } from './session'
import { refreshMembershipStatus } from '../membership/session'

function getLoginErrorMessage(error: unknown) {
  if (error instanceof ApiException && error.message) {
    return error.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object' && 'errMsg' in error) {
    const errMsg = String(error.errMsg)

    if (/cancel/i.test(errMsg)) {
      return '已取消授权登录'
    }
  }

  return '授权登录失败，请稍后重试'
}

export function useLoginHooks() {
  const isLoggingIn = ref(false)
  const loginErrorMessage = ref('')
  const session = computed(() => authSession.value)
  const isAuthenticated = computed(() => Boolean(authSession.value?.accessToken))

  async function loginWithWeapp() {
    if (isLoggingIn.value) {
      return authSession.value
    }

    isLoggingIn.value = true
    loginErrorMessage.value = ''

    try {
      const loginResult = await Taro.login()
      const jsCode = loginResult.code?.trim()

      if (!jsCode) {
        throw new Error('微信登录凭证获取失败，请稍后重试')
      }

      const session = await weappLogin(jsCode)
      await refreshMembershipAfterLogin()
      return session
    } catch (error) {
      loginErrorMessage.value = getLoginErrorMessage(error)
      throw error
    } finally {
      isLoggingIn.value = false
    }
  }

  async function loginWithWeappPhone(phoneCode: string) {
    if (isLoggingIn.value) {
      return authSession.value
    }

    const normalizedPhoneCode = phoneCode.trim()

    if (!normalizedPhoneCode) {
      loginErrorMessage.value = '请授权手机号后继续登录'
      throw new Error(loginErrorMessage.value)
    }

    isLoggingIn.value = true
    loginErrorMessage.value = ''

    try {
      const loginResult = await Taro.login()
      const jsCode = loginResult.code?.trim()

      if (!jsCode) {
        throw new Error('微信登录凭证获取失败，请稍后重试')
      }

      const session = await weappPhoneLogin(jsCode, normalizedPhoneCode)
      await refreshMembershipAfterLogin()
      return session
    } catch (error) {
      loginErrorMessage.value = getLoginErrorMessage(error)
      throw error
    } finally {
      isLoggingIn.value = false
    }
  }

  return {
    session,
    isAuthenticated,
    isLoggingIn,
    loginErrorMessage,
    loginWithWeapp,
    loginWithWeappPhone,
  }
}

export const useWeappLogin = useLoginHooks

export async function silentWeappLogin() {
  if (authSession.value?.accessToken) {
    return authSession.value
  }

  try {
    const loginResult = await Taro.login()
    const jsCode = loginResult.code?.trim()

    if (!jsCode) {
      return null
    }

    const session = await weappLogin(jsCode)
    await refreshMembershipAfterLogin()
    return session
  } catch {
    return null
  }
}

async function refreshMembershipAfterLogin() {
  await refreshMembershipStatus({ force: true }).catch(() => undefined)
}
