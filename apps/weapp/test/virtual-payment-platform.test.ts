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

jest.mock('../src/apis/order', () => ({
  syncOrderPayment: jest.fn().mockResolvedValue({ status: 'pending' }),
}))

import {
  assertVirtualPaymentAvailable,
  isIosClientPlatform,
  isWechatPaymentCancel,
  requestWechatVirtualPaymentWithFallback,
} from '../src/utils/virtual-payment'

const virtualOrder = {
  order: { id: 'virtual-order-1', payableAmount: 9900 },
  virtualPayment: {
    mode: 'short_series_goods',
    signData: '{}',
    paySig: 'pay-sig',
    signature: 'signature',
  },
} as never

describe('virtual payment platform handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('按 platform 判定 iOS，其余平台不算 iOS', () => {
    mockGetSystemInfoSync.mockReturnValue({ platform: 'iOS', SDKVersion: '3.0.0' })
    expect(isIosClientPlatform()).toBe(true)

    mockGetSystemInfoSync.mockReturnValue({ platform: 'android', SDKVersion: '3.0.0' })
    expect(isIosClientPlatform()).toBe(false)

    mockGetSystemInfoSync.mockReturnValue({ platform: 'devtools', SDKVersion: '3.0.0' })
    expect(isIosClientPlatform()).toBe(false)

    mockGetSystemInfoSync.mockReturnValue({ SDKVersion: '3.0.0' })
    expect(isIosClientPlatform()).toBe(false)
  })

  it('iOS 上虚拟支付直接不可用，Android（SDK 达标）可用', () => {
    mockGetSystemInfoSync.mockReturnValue({ platform: 'ios', SDKVersion: '3.0.0' })
    expect(() => assertVirtualPaymentAvailable()).toThrow()

    mockGetSystemInfoSync.mockReturnValue({ platform: 'android', SDKVersion: '3.0.0' })
    expect(() => assertVirtualPaymentAvailable()).not.toThrow()
  })

  // 这是最关键的不变量：iOS 的失败必须能让上层回退，
  // 一旦被当成"用户取消"就会被直接抛出、不再回退，用户又会被堵死。
  it('iOS 抛出的错误不会被误判成用户取消', () => {
    mockGetSystemInfoSync.mockReturnValue({ platform: 'ios', SDKVersion: '3.0.0' })

    let thrown: unknown
    try {
      assertVirtualPaymentAvailable()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(isWechatPaymentCancel(thrown)).toBe(false)
  })

  it('iOS 上不会尝试虚拟支付，直接回退普通微信支付', async () => {
    mockGetSystemInfoSync.mockReturnValue({ platform: 'ios', SDKVersion: '3.0.0' })
    const createFallbackOrder = jest.fn().mockResolvedValue({
      order: { id: 'ordinary-order-1', payableAmount: 9900 },
      payment: { timeStamp: '1', nonceStr: 'n', package: 'p', signType: 'RSA', paySign: 's' },
    })

    const result = await requestWechatVirtualPaymentWithFallback(
      virtualOrder,
      createFallbackOrder
    )

    expect(mockRequestVirtualPayment).not.toHaveBeenCalled()
    expect(createFallbackOrder).toHaveBeenCalledTimes(1)
    expect(mockRequestPayment).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ id: 'ordinary-order-1' })
  })
})
