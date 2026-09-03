import { ApiException } from '../api/api-exception'
import { get, patch, post } from '../api/api-client'
import {
  AuthSessionData,
  AuthUser,
  SendSmsCodeResult,
  UserGender,
  UserRegion,
  parseAuthSessionData,
  parseAuthUser,
  parseSendSmsCodeResult,
} from './models'
import { authSession, clearAuthSession, saveAuthSession } from './session'

export { ApiException }
export type {
  AuthSessionData,
  AuthUser,
  SendSmsCodeResult,
  UserGender,
  UserRegion,
}

export interface AccountCancellationBlocker {
  code: 'ORDER_PROCESSING' | 'VOICE_PROCESSING' | 'IMPORT_PROCESSING'
  title: string
  description: string
  count: number
  actionText: string
  actionPath: string
}

export interface AccountCancellationCheck {
  eligible: boolean
  blockers: AccountCancellationBlocker[]
  consequences: string[]
  confirmationText: string
}

export interface AccountCancellationResult {
  canceledAt: number
  cleanupStatus: 'completed' | 'processing'
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function parseCancellationBlocker(value: unknown): AccountCancellationBlocker {
  const raw = asRecord(value)
  const code = asString(raw.code)
  const normalizedCode =
    code === 'VOICE_PROCESSING' || code === 'IMPORT_PROCESSING'
      ? code
      : 'ORDER_PROCESSING'

  return {
    code: normalizedCode,
    title: asString(raw.title),
    description: asString(raw.description),
    count: Math.max(0, Number(raw.count) || 0),
    actionText: asString(raw.actionText),
    actionPath: asString(raw.actionPath),
  }
}

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

export async function weappLogin(
  jsCode: string,
  options: { allowCreate?: boolean } = {},
) {
  const data = await post<Record<string, unknown>>('/api/user/weapp-login', {
    jsCode,
    allowCreate: options.allowCreate,
  })
  const session = parseAuthSessionData(data)

  await saveAuthSession(session)

  return session satisfies AuthSessionData
}

export async function weappPhoneLogin(jsCode: string, phoneCode: string) {
  const data = await post<Record<string, unknown>>(
    '/api/user/weapp-phone-login',
    {
      jsCode,
      phoneCode,
    },
  )
  const session = parseAuthSessionData(data)

  await saveAuthSession(session)

  return session satisfies AuthSessionData
}

export async function devLogin(account: string, openid: string) {
  const data = await post<Record<string, unknown>>('/api/user/dev-login', {
    account,
    openid,
  })
  const session = parseAuthSessionData(data)

  await saveAuthSession(session)

  return session satisfies AuthSessionData
}

export async function bindWeappPhone(phoneCode: string) {
  const data = await post<Record<string, unknown>>('/api/user/me/weapp-phone', {
    phoneCode,
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

export async function updateAvatar(avatar: string) {
  const data = await patch<Record<string, unknown>>('/api/user/me/avatar', {
    avatar,
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

export async function updateGender(gender: UserGender) {
  const data = await patch<Record<string, unknown>>('/api/user/me/gender', {
    gender,
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

export async function updateRegion(payload: {
  provinceCode: string
  cityCode: string
}) {
  const data = await patch<Record<string, unknown>>('/api/user/me/region', payload)
  const user = parseAuthUser(data)

  if (authSession.value) {
    await saveAuthSession({
      ...authSession.value,
      user,
    })
  }

  return user satisfies AuthUser
}

export async function updateUserPreferences(payload: {
  contactsCoverImage?: string
}) {
  const data = await patch<Record<string, unknown>>(
    '/api/user/me/preferences',
    payload,
  )
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

export async function checkAccountCancellation() {
  const data = await get<Record<string, unknown>>(
    '/api/user/me/cancellation-check',
  )

  return {
    eligible: data.eligible === true,
    blockers: Array.isArray(data.blockers)
      ? data.blockers.map(parseCancellationBlocker)
      : [],
    consequences: Array.isArray(data.consequences)
      ? data.consequences.map(asString).filter(Boolean)
      : [],
    confirmationText: asString(data.confirmationText) || '确认注销',
  } satisfies AccountCancellationCheck
}

export async function cancelCurrentUser(jsCode: string, confirmation: string) {
  const data = await post<Record<string, unknown>>(
    '/api/user/me/cancel',
    { jsCode, confirmation },
    { timeout: 5 * 60 * 1000 },
  )
  const cleanupStatus =
    data.cleanupStatus === 'processing' ? 'processing' : 'completed'

  return {
    canceledAt: Number(data.canceledAt) || Date.now(),
    cleanupStatus,
  } satisfies AccountCancellationResult
}
