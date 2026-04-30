import type {
  CreateVipPlanOrderResultDTO,
  OrderStatusDTO,
  OrderRecordDTO,
  WechatPaymentParamsDTO,
} from '@tzl/shared'
import { get, post } from '../api/api-client'

export interface OrderRecord {
  id: string
  orderNo: string
  orderType: 'vip_plan'
  targetId?: string
  targetCode?: string
  title: string
  payableAmount: number
  currency: string
  status: OrderStatusDTO
  createdAt: string
  paidAt?: string
}

export interface WechatPaymentParams {
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA'
  paySign: string
}

export interface CreateVipPlanOrderResult {
  order: OrderRecord
  payment: WechatPaymentParams
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

function parseOrder(value: unknown): OrderRecord {
  const raw = asRecord(value)

  return {
    id: asString(raw.id),
    orderNo: asString(raw.orderNo),
    orderType: 'vip_plan',
    targetId: raw.targetId == null ? undefined : asString(raw.targetId),
    targetCode: raw.targetCode == null ? undefined : asString(raw.targetCode),
    title: asString(raw.title),
    payableAmount: asNumber(raw.payableAmount),
    currency: asString(raw.currency) || 'CNY',
    status: parseOrderStatus(raw.status),
    createdAt: asString(raw.createdAt),
    paidAt: raw.paidAt == null ? undefined : asString(raw.paidAt),
  }
}

function parseOrderStatus(value: unknown): OrderStatusDTO {
  const status = asString(value)

  if (
    status === 'pending' ||
    status === 'paid' ||
    status === 'granting' ||
    status === 'completed' ||
    status === 'closed' ||
    status === 'refunded' ||
    status === 'grant_failed'
  ) {
    return status
  }

  return 'pending'
}

function parsePayment(value: unknown): WechatPaymentParams {
  const raw = asRecord(value)

  return {
    timeStamp: asString(raw.timeStamp),
    nonceStr: asString(raw.nonceStr),
    package: asString(raw.package),
    signType: 'RSA',
    paySign: asString(raw.paySign),
  }
}

function parseCreateVipPlanOrderResult(
  value: unknown
): CreateVipPlanOrderResult {
  const raw = asRecord(value)

  return {
    order: parseOrder(raw.order),
    payment: parsePayment(raw.payment),
  }
}

export async function createVipPlanOrder(payload: {
  vipPlanId: string
  jsCode: string
}) {
  const data = await post<CreateVipPlanOrderResultDTO>('/api/orders/vip-plan', {
    vipPlanId: payload.vipPlanId,
    jsCode: payload.jsCode,
  })

  return parseCreateVipPlanOrderResult(data)
}

export async function getOrder(orderId: string) {
  const data = await get<OrderRecordDTO>(`/api/orders/${orderId}`)

  return parseOrder(data)
}

export async function syncOrderPayment(orderId: string) {
  const data = await post<OrderRecordDTO>(
    `/api/orders/${orderId}/sync-payment`
  )

  return parseOrder(data)
}

export type {
  CreateVipPlanOrderResultDTO,
  OrderStatusDTO,
  OrderRecordDTO,
  WechatPaymentParamsDTO,
}
