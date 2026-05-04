export interface AuthUser {
  id: string
  name: string
  avatar: string
  account: string
  phone: string
  phoneVerified: boolean
  isVip: boolean
}

export interface AuthSessionData {
  accessToken: string
  tokenType: string
  expiresAt: number
  user: AuthUser
  isNewUser: boolean
}

export interface SendSmsCodeResult {
  expiresInSeconds: number
  resendAfterSeconds: number
  debugCode?: string
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

export function parseAuthUser(value: unknown): AuthUser {
  const raw = asRecord(value)

  return {
    id: asString(raw.id),
    name: asString(raw.name),
    avatar: asString(raw.avatar),
    account: asString(raw.account),
    phone: asString(raw.phone),
    phoneVerified: asBoolean(raw.phoneVerified),
    isVip: asBoolean(raw.isVip),
  }
}

export function parseAuthSessionData(value: unknown): AuthSessionData {
  const raw = asRecord(value)

  return {
    accessToken: asString(raw.accessToken),
    tokenType: asString(raw.tokenType, 'Bearer'),
    expiresAt: asNumber(raw.expiresAt),
    user: parseAuthUser(raw.user),
    isNewUser: asBoolean(raw.isNewUser),
  }
}

export function parseSendSmsCodeResult(value: unknown): SendSmsCodeResult {
  const raw = asRecord(value)

  return {
    expiresInSeconds: asNumber(raw.expiresInSeconds, 300),
    resendAfterSeconds: asNumber(raw.resendAfterSeconds, 60),
    debugCode:
      typeof raw.debugCode === 'string' && raw.debugCode.trim()
        ? raw.debugCode
        : undefined,
  }
}
