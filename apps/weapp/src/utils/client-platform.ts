import Taro from '@tarojs/taro'

interface MiniProgramSystemInfo {
  platform?: string
}

/**
 * 当前微信客户端平台，小写（ios / android / devtools / windows / mac …）。
 * 取不到时返回空串，由调用方按"非 iOS"处理。
 */
export function getClientPlatform(): string {
  try {
    return String(
      (Taro.getSystemInfoSync() as MiniProgramSystemInfo).platform || ''
    )
      .trim()
      .toLowerCase()
  } catch {
    return ''
  }
}

/**
 * 是否 iOS 微信客户端。
 *
 * 业务策略：iOS **主动不用**小程序虚拟支付——虚拟支付的 iOS 通道走 Apple 内购，
 * 手续费高、账期长，因此 iOS 一律走普通微信支付。
 *
 * 反过来微信平台只对**非 iOS** 系统关闭了普通微信支付，所以 iOS 的普通支付是可用的。
 */
export function isIosClientPlatform(): boolean {
  return getClientPlatform() === 'ios'
}
