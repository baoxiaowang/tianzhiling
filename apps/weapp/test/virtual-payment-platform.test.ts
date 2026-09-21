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
  isIosClientPlatform,
  isWechatPaymentCancel,
  requestWechatVirtualPayment,
} from '../src/utils/virtual-payment'

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

  it('iOS 上虚拟支付直接不可用，Android（SDK 达标）可用', () => {
    setPlatform('ios')
    expect(() => assertVirtualPaymentAvailable()).toThrow()

    setPlatform('android')
    expect(() => assertVirtualPaymentAvailable()).not.toThrow()
  })

  // 业务策略：iOS 主动不用虚拟支付（Apple 通道手续费高、账期长）。
  // 该错误必须能被页面当作真实失败展示，而不是被误判成"用户主动取消"。
  it('iOS 抛出的错误不会被误判成用户取消', () => {
    setPlatform('ios')

    let thrown: unknown
    try {
      assertVirtualPaymentAvailable()
    } catch (error) {
      thrown = error
    }

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
})
