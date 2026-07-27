import type {
  AgentEntitlementSummaryDTO,
  UserMembershipStatusSnapshotDTO,
  UserMembershipCenterDTO,
  UserMembershipRecordDTO,
  VipPurchaseCenterDTO,
  VipPlanGroupDTO,
  VipPlanBenefitDTO,
  VipPlanRecordDTO,
} from '@tzl/shared'
import { get } from '../api/api-client'

const VIP_PURCHASE_CENTER_CACHE_TTL = 30 * 1000

let vipPurchaseCenterCache:
  | {
      data: MembershipCenter
      expiresAt: number
    }
  | null = null
let vipPurchaseCenterPromise: Promise<MembershipCenter> | null = null

export interface VipPlan {
  id: string
  code: string
  name: string
  description: string
  planGroup: VipPlanGroupDTO
  priceAmount: number
  originalPriceAmount?: number
  currency: string
  durationDays?: number
  lifetime: boolean
  benefits: VipPlanBenefitDTO[]
  couponGrantAmount?: number
  voicePackageId?: string
  voicePackageCode?: string
  voicePackageName?: string
  virtualPaymentProductId?: string
  upgradePayableAmount?: number
}

export interface UserMembership {
  id: string
  vipPlanId: string
  vipPlanCode: string
  status: string
  startedAt: Date | null
  expiredAt: Date | null
  lifetime: boolean
  plan?: VipPlan
}

export interface AgentEntitlementSummary {
  type: AgentEntitlementSummaryDTO['type']
  totalQuota: number
  usedQuota: number
  availableQuota: number
  expiredAt: Date | null
}

export interface MembershipCenter {
  isVip: boolean
  membership?: UserMembership
  plans: VipPlan[]
  serverTime: Date | null
  activityStats: {
    companionshipDays: number
    conversationCount: number
  }
}

export interface MembershipStatus {
  isVip: boolean
  membership?: UserMembership
  entitlements: AgentEntitlementSummary[]
  serverTime: Date | null
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function asDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function asNonNegativeInteger(value: unknown) {
  return Math.max(Math.trunc(asNumber(value)), 0)
}

function parseBenefits(value: unknown): VipPlanBenefitDTO[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      const raw = asRecord(item)
      return {
        title: asString(raw.title).trim(),
        description: asString(raw.description).trim() || undefined,
      }
    })
    .filter((item) => item.title)
}

function parseVipPlan(value: unknown): VipPlan {
  const raw = asRecord(value)
  const planGroup = asString(raw.planGroup)

  return {
    id: asString(raw.id),
    code: asString(raw.code),
    name: asString(raw.name),
    description: asString(raw.description),
    planGroup: planGroup === 'voice' ? 'voice' : 'basic',
    priceAmount: asNumber(raw.priceAmount),
    originalPriceAmount:
      raw.originalPriceAmount == null
        ? undefined
        : asNumber(raw.originalPriceAmount),
    currency: asString(raw.currency) || 'CNY',
    durationDays:
      raw.durationDays == null ? undefined : asNumber(raw.durationDays),
    lifetime: Boolean(raw.lifetime),
    benefits: parseBenefits(raw.benefits),
    couponGrantAmount:
      raw.couponGrantAmount == null
        ? undefined
        : asNumber(raw.couponGrantAmount),
    voicePackageId: asString(raw.voicePackageId) || undefined,
    voicePackageCode: asString(raw.voicePackageCode) || undefined,
    voicePackageName: asString(raw.voicePackageName) || undefined,
    virtualPaymentProductId: asString(raw.virtualPaymentProductId) || undefined,
    upgradePayableAmount:
      raw.upgradePayableAmount == null
        ? undefined
        : Math.max(asNumber(raw.upgradePayableAmount), 0),
  }
}

function parseMembership(value: unknown): UserMembership {
  const raw = asRecord(value)
  const plan = raw.plan ? parseVipPlan(raw.plan) : undefined

  return {
    id: asString(raw.id),
    vipPlanId: asString(raw.vipPlanId),
    vipPlanCode: asString(raw.vipPlanCode),
    status: asString(raw.status),
    startedAt: asDate(raw.startedAt),
    expiredAt: asDate(raw.expiredAt),
    lifetime: Boolean(raw.lifetime),
    plan,
  }
}

function parseEntitlementSummary(value: unknown): AgentEntitlementSummary {
  const raw = asRecord(value)
  const totalQuota = asNumber(raw.totalQuota)
  const usedQuota = asNumber(raw.usedQuota)
  const availableQuota =
    raw.availableQuota == null
      ? Math.max(totalQuota - usedQuota, 0)
      : asNumber(raw.availableQuota)

  return {
    type: asString(raw.type) as AgentEntitlementSummaryDTO['type'],
    totalQuota,
    usedQuota,
    availableQuota,
    expiredAt: asDate(raw.expiredAt),
  }
}

function parseMembershipCenter(value: unknown): MembershipCenter {
  const raw = asRecord(value)
  const plans = Array.isArray(raw.plans) ? raw.plans.map(parseVipPlan) : []
  const activityStats = asRecord(raw.activityStats)

  return {
    isVip: Boolean(raw.isVip),
    membership: raw.membership ? parseMembership(raw.membership) : undefined,
    plans,
    serverTime: asDate(raw.serverTime),
    activityStats: {
      companionshipDays: asNonNegativeInteger(activityStats.companionshipDays),
      conversationCount: asNonNegativeInteger(activityStats.conversationCount),
    },
  }
}

function parseMembershipStatus(value: unknown): MembershipStatus {
  const raw = asRecord(value)
  const entitlements = Array.isArray(raw.entitlements)
    ? raw.entitlements.map(parseEntitlementSummary).filter((item) => item.type)
    : []

  return {
    isVip: Boolean(raw.isVip),
    membership: raw.membership ? parseMembership(raw.membership) : undefined,
    entitlements,
    serverTime: asDate(raw.serverTime),
  }
}

export async function getMembershipCenter() {
  const data = await get<UserMembershipCenterDTO>('/api/membership/center')

  return parseMembershipCenter(data)
}

export async function getVipPurchaseCenter() {
  if (
    vipPurchaseCenterCache &&
    vipPurchaseCenterCache.expiresAt > Date.now()
  ) {
    return vipPurchaseCenterCache.data
  }

  if (vipPurchaseCenterPromise) {
    return vipPurchaseCenterPromise
  }

  vipPurchaseCenterPromise = fetchVipPurchaseCenter().finally(() => {
    vipPurchaseCenterPromise = null
  })

  return vipPurchaseCenterPromise
}

export function preloadVipPurchaseCenter() {
  void getVipPurchaseCenter().catch(() => undefined)
}

async function fetchVipPurchaseCenter() {
  const data = await get<VipPurchaseCenterDTO>(
    '/api/membership/purchase-center'
  )

  const center = parseMembershipCenter(data)
  vipPurchaseCenterCache = {
    data: center,
    expiresAt: Date.now() + VIP_PURCHASE_CENTER_CACHE_TTL,
  }

  return center
}

export async function getMembershipStatus() {
  const data = await get<UserMembershipStatusSnapshotDTO>(
    '/api/membership/status'
  )

  return parseMembershipStatus(data)
}

export type {
  AgentEntitlementSummaryDTO,
  UserMembershipCenterDTO,
  UserMembershipRecordDTO,
  UserMembershipStatusSnapshotDTO,
  VipPurchaseCenterDTO,
  VipPlanRecordDTO,
}
