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
 * 全品牌统一支付路由（天之灵 / 未了言一致）：
 * - 非 iOS（安卓 / 鸿蒙 / Windows / 开发者工具）：只走微信小程序虚拟支付。
 *   微信只对非 iOS 系统关闭了普通微信支付，普通支付在这里起不来。
 * - iOS：只走普通微信支付。iOS 的 `wx.requestVirtualPayment` 走不通，
 *   普通微信支付是 iOS 上唯一能成功的路径。
 *
 * 任何"先试虚拟支付、失败再回退普通支付"的写法都会让 iOS 用户白等一次失败，
 * 并在非 iOS 上留下注定失败的回退尝试，因此调用方必须先按平台选通道。
 */
export function isIosClientPlatform(): boolean {
  return getClientPlatform() === 'ios'
}
