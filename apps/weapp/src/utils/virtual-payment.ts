import Taro from '@tarojs/taro'
import {
  type OrderRecord,
  syncOrderPayment,
  type WechatPaymentParams,
  type WechatVirtualPaymentParams,
} from '../apis/order'

interface MiniProgramSystemInfo {
  platform?: string
  SDKVersion?: string
}

interface VirtualPaymentFail {
  errMsg?: string
  errCode?: number
  errno?: number
  code?: number | string
}

type RequestVirtualPayment = (
  options: WechatVirtualPaymentParams & {
    success?: () => void
    fail?: (error: VirtualPaymentFail) => void
  }
) => void

const minVirtualPaymentSdkVersion = '2.19.2'
const isVirtualPaymentDebugVisible = process.env.NODE_ENV !== 'production'

interface WechatVirtualPaymentAlert {
  title: string
  content: string
  confirmText?: string
}

interface WechatVirtualPaymentOrderResult {
  order: OrderRecord
  virtualPayment: WechatVirtualPaymentParams
}

interface WechatPaymentOrderResult {
  order: OrderRecord
  payment: WechatPaymentParams
}

export class WechatVirtualPaymentError extends Error {
  readonly errMsg?: string
  readonly errCode?: number
  readonly rawError: VirtualPaymentFail
  readonly debugInfo: string

  constructor(error: VirtualPaymentFail, params: WechatVirtualPaymentParams) {
    const debugInfo = buildVirtualPaymentDebugInfo(error, params)
    super(`虚拟支付失败：${getVirtualPaymentRawMessage(error)}\n${debugInfo}`)
    this.name = 'WechatVirtualPaymentError'
    this.errMsg = error.errMsg
    this.errCode = error.errCode
    this.rawError = error
    this.debugInfo = debugInfo
  }
}

export function assertVirtualPaymentAvailable() {
  const systemInfo = Taro.getSystemInfoSync() as MiniProgramSystemInfo
  // const platform = systemInfo.platform?.toLowerCase() ?? ''

  // if (platform === 'ios') {
  //   throw new Error('暂不支持 iOS 端购买，请使用安卓/鸿蒙/Windows 微信客户端购买')
  // }

  if (
    compareVersion(systemInfo.SDKVersion ?? '', minVirtualPaymentSdkVersion) < 0 &&
    !canUseVirtualPayment()
  ) {
    throw new Error('当前微信版本过低，请升级微信后再购买')
  }
}

export async function requestWechatVirtualPayment(
  params: WechatVirtualPaymentParams,
  options: { orderId?: string } = {}
) {
  assertVirtualPaymentAvailable()
  const requestVirtualPayment =
    (Taro as unknown as { requestVirtualPayment?: RequestVirtualPayment })
      .requestVirtualPayment ||
    (
      globalThis as unknown as {
        wx?: { requestVirtualPayment?: RequestVirtualPayment }
      }
    ).wx?.requestVirtualPayment

  if (!requestVirtualPayment) {
    throw new Error('当前微信版本不支持虚拟支付，请升级微信后再购买')
  }

  let stopWatchingOrder = false
  const paymentPromise = new Promise<void>((resolve, reject) => {
    requestVirtualPayment({
      mode: params.mode,
      signData: params.signData,
      paySig: params.paySig,
      signature: params.signature,
      success: () => resolve(),
      fail: (error: VirtualPaymentFail) => {
        const paymentError = new WechatVirtualPaymentError(error, params)
        console.error('[virtual-payment] requestVirtualPayment failed', {
          rawError: error,
          debugInfo: paymentError.debugInfo,
        })
        reject(paymentError)
      },
    })
  })

  if (!options.orderId) {
    return paymentPromise
  }

  const orderWatchPromise = watchVirtualPaymentOrder(options.orderId, () => {
    return stopWatchingOrder
  })

  try {
    await Promise.race([paymentPromise, orderWatchPromise])
  } finally {
    stopWatchingOrder = true
    paymentPromise.catch(() => undefined)
  }
}

export async function requestWechatVirtualPaymentWithFallback(
  result: WechatVirtualPaymentOrderResult,
  createFallbackOrder: () => Promise<WechatPaymentOrderResult>
) {
  try {
    await requestWechatVirtualPayment(result.virtualPayment, {
      orderId: result.order.id,
    })

    return result.order
  } catch (error) {
    if (isWechatPaymentCancel(error)) {
      throw error
    }

    console.warn(
      '[virtual-payment] requestVirtualPayment failed, fallback to wechat payment',
      {
        orderId: result.order.id,
        error,
      }
    )
    const fallbackResult = await createFallbackOrder()
    await Taro.requestPayment(fallbackResult.payment)

    return fallbackResult.order
  }
}

export function isWechatVirtualPaymentError(
  error: unknown
): error is WechatVirtualPaymentError {
  return error instanceof WechatVirtualPaymentError
}

export function getWechatVirtualPaymentErrorContent(error: unknown) {
  return getWechatVirtualPaymentAlert(error)?.content ?? ''
}

export function getWechatVirtualPaymentAlert(
  error: unknown
): WechatVirtualPaymentAlert | null {
  if (!isWechatVirtualPaymentError(error)) {
    return null
  }

  const alert = buildWechatVirtualPaymentAlert(error)
  const content = isVirtualPaymentDebugVisible
    ? `${alert.content}\n\n${buildDeveloperDebugContent(error)}`
    : alert.content

  return {
    ...alert,
    content,
  }
}

export async function showWechatVirtualPaymentError(error: unknown) {
  const alert = getWechatVirtualPaymentAlert(error)

  if (!alert) {
    return false
  }

  await Taro.showModal({
    title: alert.title,
    content: alert.content,
    showCancel: false,
    confirmText: alert.confirmText ?? '知道了',
  })

  return true
}

export function isWechatPaymentCancel(error: unknown) {
  const errMsg =
    error && typeof error === 'object' && 'errMsg' in error
      ? String(error.errMsg)
      : ''

  return /cancel|取消/i.test(errMsg)
}

function buildWechatVirtualPaymentAlert(
  error: WechatVirtualPaymentError
): WechatVirtualPaymentAlert {
  switch (getWechatVirtualPaymentErrorType(error)) {
    case 'USER_CANCEL':
      return {
        title: '支付已取消',
        content: '本次购买尚未完成，如需继续开通，请重新发起支付。',
      }
    case 'GOODS_PRICE_INVALID':
      return {
        title: '套餐价格异常',
        content:
          '当前套餐价格与微信支付配置不一致，暂时无法购买。请稍后重试或联系客服处理。',
      }
    case 'COIN_OR_PRODUCT_ID_CREATED_IN_RECENTLY':
      return {
        title: '商品配置同步中',
        content:
          '微信支付商品刚创建或刚调整，配置还在同步中。请稍后再试。',
      }
    case 'PAYMENT_ILLEGAL_IN_SANDBOX':
      return {
        title: '支付环境异常',
        content:
          '当前客户端不支持沙箱支付。请切换到正式支付环境后重试，或联系客服处理。',
      }
    case 'IOS_ORDER_PRICE_TOO_LOW':
      return {
        title: 'iOS 支付金额过低',
        content:
          '当前套餐金额低于 iOS 支付限制，暂时无法在 iOS 端购买。请更换套餐或联系客服处理。',
      }
    case 'IOS_APP_STORE_ACCOUNT_REQUIRED':
      return {
        title: 'iOS 支付不可用',
        content:
          'iOS 购买需要先登录 Apple ID，并确认 App Store 支付功能可用。请登录后重试。',
      }
    case 'REQUEST_VIRTUAL_PAYMENT_UNSUPPORTED':
      return {
        title: '微信版本过低',
        content: '当前微信版本不支持虚拟支付，请升级微信后再购买。',
      }
    default:
      return {
        title: '虚拟支付失败',
        content:
          '本次支付未能完成。请稍后重试；如果多次失败，请联系客服处理。',
      }
  }
}

function getWechatVirtualPaymentErrorType(error: WechatVirtualPaymentError) {
  const rawMessage = getVirtualPaymentRawMessage(error.rawError).toUpperCase()
  const errCode = error.errCode ?? error.rawError.errno

  if (/CANCEL|取消/.test(rawMessage)) {
    return 'USER_CANCEL'
  }

  if (
    rawMessage.includes('GOODS_PRICE_INVALID') ||
    errCode === -15013
  ) {
    return 'GOODS_PRICE_INVALID'
  }

  if (
    rawMessage.includes('COIN_OR_PRODUCT_ID_CREATED_IN_RECENTLY') ||
    errCode === -15014
  ) {
    return 'COIN_OR_PRODUCT_ID_CREATED_IN_RECENTLY'
  }

  if (
    rawMessage.includes('PAYMENT_ILLEGAL_IN_SANDBOX') ||
    errCode === -15011
  ) {
    return 'PAYMENT_ILLEGAL_IN_SANDBOX'
  }

  if (
    rawMessage.includes('IOS_ORDER_PRICE_TOO_LOW') ||
    errCode === -15001
  ) {
    return 'IOS_ORDER_PRICE_TOO_LOW'
  }

  if (
    rawMessage.includes('APPSTORE') ||
    rawMessage.includes('APP_STORE') ||
    (rawMessage.includes('IOS') &&
      (rawMessage.includes('LOGIN') ||
        rawMessage.includes('ACCOUNT') ||
        rawMessage.includes('AUTH')))
  ) {
    return 'IOS_APP_STORE_ACCOUNT_REQUIRED'
  }

  if (
    rawMessage.includes('NOT SUPPORT') ||
    rawMessage.includes('UNSUPPORTED') ||
    rawMessage.includes('不支持')
  ) {
    return 'REQUEST_VIRTUAL_PAYMENT_UNSUPPORTED'
  }

  return 'UNKNOWN'
}

function buildDeveloperDebugContent(error: WechatVirtualPaymentError) {
  return [
    `微信返回：${getVirtualPaymentRawMessage(error.rawError)}`,
    error.debugInfo,
  ].join('\n\n')
}

function buildVirtualPaymentDebugInfo(
  error: VirtualPaymentFail,
  params: WechatVirtualPaymentParams
) {
  const signData = parseSignData(params.signData)
  const lines = [
    `errCode: ${error.errCode ?? error.errno ?? error.code ?? '无'}`,
    `mode: ${params.mode}`,
    `offerId: ${asDebugValue(signData.offerId)}`,
    `env: ${asDebugValue(signData.env)}`,
    `productId: ${asDebugValue(signData.productId)}`,
    `goodsPrice: ${asDebugValue(signData.goodsPrice)}`,
    `outTradeNo: ${asDebugValue(signData.outTradeNo)}`,
  ]

  return lines.join('\n')
}

async function watchVirtualPaymentOrder(
  orderId: string,
  isStopped: () => boolean
) {
  const pollIntervalMs = 1500
  const maxAttempts = 80

  for (let attempt = 0; attempt < maxAttempts && !isStopped(); attempt += 1) {
    if (attempt > 0) {
      await sleep(pollIntervalMs)
    }

    if (isStopped()) {
      break
    }

    try {
      const order = await syncOrderPayment(orderId)

      if (
        order.status === 'completed' ||
        order.status === 'granting' ||
        order.status === 'paid' ||
        order.status === 'grant_failed'
      ) {
        console.info('[virtual-payment] order confirmed by polling', {
          orderId,
          status: order.status,
        })
        return
      }
    } catch (error) {
      console.warn('[virtual-payment] order polling failed', {
        orderId,
        error,
      })
    }
  }

  console.warn('[virtual-payment] order polling timed out', {
    orderId,
    attempts: maxAttempts,
  })
}

function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function getVirtualPaymentRawMessage(error: VirtualPaymentFail) {
  return error.errMsg || String(error.code || error.errCode || '未知错误')
}

function parseSignData(signData: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(signData)

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function asDebugValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '无'
  }

  return String(value)
}

function canUseVirtualPayment() {
  const canIUse = (Taro as unknown as { canIUse?: (schema: string) => boolean })
    .canIUse

  if (typeof canIUse !== 'function') {
    return false
  }

  return canIUse('requestVirtualPayment')
}

function compareVersion(left: string, right: string) {
  const leftParts = left.split('.').map(part => Number(part) || 0)
  const rightParts = right.split('.').map(part => Number(part) || 0)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0
    const rightValue = rightParts[index] ?? 0

    if (leftValue > rightValue) {
      return 1
    }

    if (leftValue < rightValue) {
      return -1
    }
  }

  return 0
}
