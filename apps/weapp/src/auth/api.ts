import { ApiException } from '../api/api-exception'
import { get, patch, post } from '../api/api-client'
import {
  AuthSessionData,
  AuthUser,
  SendSmsCodeResult,
  parseAuthSessionData,
  parseAuthUser,
  parseSendSmsCodeResult,
} from './models'
import { authSession, clearAuthSession, saveAuthSession } from './session'

export { ApiException }
export type { AuthSessionData, AuthUser, SendSmsCodeResult }

export async function sendSmsCode(phone: string) {
  const data = await post<Record<string, unknown>>('/api/user/sms-code', {
    phone,
  })

  return parseSendSmsCodeResult(data) satisfies SendSmsCodeResult
}

export async function phoneLogin(phone: string, code: string) {
  const data = await post<Record<string, unknown>>('/api/user/phone-login', {
    phone,
    code,
  })
  const session = parseAuthSessionData(data)

  await saveAuthSession(session)

  return session satisfies AuthSessionData
}

export async function passwordLogin(account: string, password: string) {
  const data = await post<Record<string, unknown>>('/api/user/password-login', {
    account,
    password,
  })
  const session = parseAuthSessionData(data)

  await saveAuthSession(session)

  return session satisfies AuthSessionData
}

export async function getCurrentUser() {
  const data = await get<Record<string, unknown>>('/api/user/me')
  const user = parseAuthUser(data)

  if (authSession.value) {
    await saveAuthSession({
      ...authSession.value,
      user,
    })
  }

  return user satisfies AuthUser
}

export async function updateDisplayName(name: string) {
  const data = await patch<Record<string, unknown>>('/api/user/me/name', {
    name,
  })
  const user = parseAuthUser(data)

  if (authSession.value) {
    await saveAuthSession({
      ...authSession.value,
      user,
    })
  }

  return user satisfies AuthUser
}

export async function logout() {
  try {
    await post<Record<string, unknown>>('/api/user/logout')
  } catch (error) {
    if (
      error instanceof ApiException &&
      (error.requiresReLogin || error.code === 'UNAUTHORIZED')
    ) {
      await clearAuthSession()
      return
    }

    throw error
  }
}
