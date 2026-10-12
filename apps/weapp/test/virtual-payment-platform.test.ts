const mockGetSystemInfoSync = jest.fn()
const mockRequestVirtualPayment = jest.fn()
const mockRequestPayment = jest.fn()

jest.mock('@tarojs/taro', () => ({
  __esModule: true,
  default: {
    getSystemInfoSync: (...args: unknown[]) => mockGetSystemInfoSync(...args),
    requestPayment: (...args: unknown[]) => mockRequestPayment(...args),
    requestVirtualPayment: (...args: unknown[]) =>
      mockRequestVirtualPayment(...args),
    canIUse: jest.fn().mockReturnValue(true),
  },
}))

const mockSyncOrderPayment = jest.fn()

jest.mock('../src/apis/order', () => ({
  syncOrderPayment: (...args: unknown[]) => mockSyncOrderPayment(...args),
}))

import {
  assertVirtualPaymentAvailable,
  getWechatVirtualPaymentAlert,
  isWechatPaymentCancel,
  requestWechatVirtualPayment,
  requestWechatVirtualPaymentForOrder,
} from '../src/utils/virtual-payment'

import { isIosClientPlatform } from '../src/utils/client-platform'

const virtualPaymentParams = {
  mode: 'short_series_goods',
  signData: '{}',
  paySig: 'pay-sig',
  signature: 'signature',
} as never

function setPlatform(platform: string) {
  mockGetSystemInfoSync.mockReturnValue({ platform, SDKVersion: '3.0.0' })
}

/** 让 requestVirtualPayment 以「用户取消」告终。 */
function failVirtualPaymentAsCancel() {
  mockRequestVirtualPayment.mockImplementation(
    (options: { fail?: (error: unknown) => void }) => {
      options.fail?.({ errMsg: 'requestVirtualPayment:fail cancel' })
    }
  )
}

/** 让 requestVirtualPayment 以真实业务错误告终（不是取消）。 */
function failVirtualPaymentWithRealError() {
  mockRequestVirtualPayment.mockImplementation(
    (options: { fail?: (error: unknown) => void }) => {
      options.fail?.({ errMsg: 'requestVirtualPayment:fail', errCode: -15013 })
    }
  )
}

describe('virtual payment platform routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSyncOrderPayment.mockResolvedValue({ status: 'pending' })
  })

  it('按 platform 判定 iOS，其余平台不算 iOS', () => {
    setPlatform('iOS')
    expect(isIosClientPlatform()).toBe(true)

    setPlatform('android')
    expect(isIosClientPlatform()).toBe(false)

    setPlatform('devtools')
    expect(isIosClientPlatform()).toBe(false)

    mockGetSystemInfoSync.mockReturnValue({ SDKVersion: '3.0.0' })
    expect(isIosClientPlatform()).toBe(false)
  })

  it('iOS 直接拒绝虚拟支付（普通 Error，不能被当成用户取消）', () => {
    setPlatform('ios')

    let thrown: unknown
    try { assertVirtualPaymentAvailable() } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(Error)
    expect(isWechatPaymentCancel(thrown)).toBe(false)
    expect(getWechatVirtualPaymentAlert(thrown)).toBeNull()

    setPlatform('android')
    expect(() => assertVirtualPaymentAvailable()).not.toThrow()
  })

  it('不支持的 SDK 错误不会被误判成用户取消', () => {
    mockGetSystemInfoSync.mockReturnValue({ platform: 'ios', SDKVersion: '1.0.0' })
    const taro = require('@tarojs/taro').default
    taro.canIUse.mockReturnValueOnce(false)
    let thrown: unknown
    try { assertVirtualPaymentAvailable() } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(Error)
    expect(isWechatPaymentCancel(thrown)).toBe(false)
  })

  it('Android 上直接拉起虚拟支付，不涉及普通支付', async () => {
    setPlatform('android')
    mockRequestVirtualPayment.mockImplementation(
      (options: { success?: () => void }) => options.success?.()
    )

    await requestWechatVirtualPayment(virtualPaymentParams)

    expect(mockRequestVirtualPayment).toHaveBeenCalledTimes(1)
    expect(mockRequestPayment).not.toHaveBeenCalled()
  })

  it('用户主动取消虚拟支付时被识别为取消', async () => {
    setPlatform('android')
    failVirtualPaymentAsCancel()

    let thrown: unknown
    try {
      await requestWechatVirtualPayment(virtualPaymentParams)
    } catch (error) {
      thrown = error
    }

    expect(isWechatPaymentCancel(thrown)).toBe(true)
    // 页面据此提示"支付已取消"，而不是走支付失败弹窗。
    expect(getWechatVirtualPaymentAlert(thrown)).toMatchObject({
      title: '支付已取消',
    })
  })

  // 业务策略：非 iOS 虚拟支付失败不得回退普通支付，必须保留真实错误。
  it('虚拟支付真实失败时抛出可展示的错误，且不触发普通支付', async () => {
    setPlatform('android')
    failVirtualPaymentWithRealError()

    let thrown: unknown
    try {
      await requestWechatVirtualPayment(virtualPaymentParams)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeDefined()
    expect(isWechatPaymentCancel(thrown)).toBe(false)
    expect(getWechatVirtualPaymentAlert(thrown)).toMatchObject({
      title: '套餐价格异常',
    })
    expect(mockRequestPayment).not.toHaveBeenCalled()
  })

  // 全品牌统一路由：非 iOS 走虚拟支付，且不保留任何普通支付回退。
  it('requestWechatVirtualPaymentForOrder：非 iOS 只调起虚拟支付', async () => {
    setPlatform('android')
    mockRequestVirtualPayment.mockImplementation(
      (options: { success?: () => void }) => options.success?.()
    )
    mockSyncOrderPayment.mockResolvedValue({ status: 'paid' })

    const order = { id: 'order-1', payableAmount: 9900, status: 'pending' }
    const result = await requestWechatVirtualPaymentForOrder({
      order: order as never,
      virtualPayment: virtualPaymentParams,
    })

    expect(result).toBe(order)
    expect(mockRequestVirtualPayment).toHaveBeenCalledTimes(1)
    expect(mockRequestPayment).not.toHaveBeenCalled()
  })

  // iOS 不允许落到虚拟支付：既不能调起收银台，也不能回退普通支付。
  it('requestWechatVirtualPaymentForOrder：iOS 直接失败且不调起任何支付', async () => {
    setPlatform('ios')

    await expect(
      requestWechatVirtualPaymentForOrder({
        order: { id: 'order-1', payableAmount: 9900, status: 'pending' } as never,
        virtualPayment: virtualPaymentParams,
      })
    ).rejects.toThrow('iOS 客户端不支持小程序虚拟支付，请使用普通微信支付')

    expect(mockRequestVirtualPayment).not.toHaveBeenCalled()
    expect(mockRequestPayment).not.toHaveBeenCalled()
  })
})
