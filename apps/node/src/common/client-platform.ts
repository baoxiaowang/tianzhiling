/**
 * 客户端平台判定：普通支付 / 虚拟支付的路由都依赖它，必须只有一份实现。
 *
 * 业务规则：
 * - iOS 直接走普通微信支付（Apple 通道手续费高、账期长）；
 * - 非 iOS 只能走微信虚拟支付，失败或取消都不得降级到普通支付。
 *
 * **User-Agent 是唯一的信任来源**：真实微信小程序请求一定带 UA，缺 UA 只可能是
 * 服务端调用、压测脚本或伪造请求。此类请求即便自报 `platform=ios` 也**不采信**，
 * 否则非 iOS 客户端只需省掉 UA 再自报 iOS 就能白拿普通微信支付、绕过规则。
 * 自报字段只用于"与 UA 对照"，永远不能单独把请求提升为可信 iOS。
 */
export type ClientPlatform = 'ios' | 'android' | 'other';

/** User-Agent 判定：微信小程序 UA 里带 iPhone/iPad 或 Android。 */
export function readUserAgentPlatform(
  clientUserAgent?: string
): ClientPlatform {
  const value = String(clientUserAgent || '');
  if (!value.trim()) {
    return 'other';
  }
  if (/(iPhone|iPad|iPod)/i.test(value)) {
    return 'ios';
  }
  if (/Android/i.test(value)) {
    return 'android';
  }
  return 'other';
}

/** 客户端自报平台（新增客户端才会带）。 */
export function readDeclaredPlatform(
  value?: unknown
): ClientPlatform | undefined {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!text) {
    return undefined;
  }
  if (text === 'ios') {
    return 'ios';
  }
  if (text === 'android' || text === 'harmony' || text === 'ohos') {
    return 'android';
  }
  // windows / mac / devtools 等桌面与工具环境：都不是 iOS。
  return 'other';
}

export interface ResolvedClientPlatform {
  platform: ClientPlatform;
  source: 'ua' | 'declared' | 'ua+declared' | 'none';
  conflict: boolean;
  isTrustedIos: boolean;
}

/**
 * 解析客户端平台，并做交叉验证。
 *
 * - 旧客户端只带 User-Agent → 按 UA 判定（兼容）；
 * - 新客户端两个都带 → 一致才采信，**不一致视为冲突**；
 * - 缺 UA / 冲突 / 完全判不出来 → `isTrustedIos` 为 false，按非 iOS 处理（fail-closed）。
 */
export function resolveClientPlatform(input: {
  clientUserAgent?: string;
  declaredPlatform?: unknown;
}): ResolvedClientPlatform {
  const hasUserAgent = String(input.clientUserAgent || '').trim().length > 0;
  const fromUa = hasUserAgent
    ? readUserAgentPlatform(input.clientUserAgent)
    : undefined;
  const fromDeclared = readDeclaredPlatform(input.declaredPlatform);

  if (fromUa === undefined && fromDeclared === undefined) {
    return {
      platform: 'other',
      source: 'none',
      conflict: false,
      isTrustedIos: false,
    };
  }

  if (fromDeclared === undefined) {
    return {
      platform: fromUa as ClientPlatform,
      source: 'ua',
      conflict: false,
      isTrustedIos: fromUa === 'ios',
    };
  }

  if (fromUa === undefined) {
    // 缺 UA：不可信来源，自报 ios 也按非 iOS 处理（fail-closed）。
    return {
      platform: fromDeclared ?? 'other',
      source: 'declared',
      conflict: false,
      isTrustedIos: false,
    };
  }

  const conflict = (fromUa === 'ios') !== (fromDeclared === 'ios');

  return {
    platform: conflict ? fromUa : fromDeclared,
    source: 'ua+declared',
    conflict,
    isTrustedIos: !conflict && fromDeclared === 'ios',
  };
}

/**
 * 请求是否来自可信 iOS 设备。
 *
 * 用于「iOS 不下发虚拟支付道具 ID」这类按平台裁剪下发字段的场景：
 * 只依据 UA，与下单守卫的 fail-closed 判定保持一致。
 */
export function isTrustedIosRequest(clientUserAgent?: string): boolean {
  return readUserAgentPlatform(clientUserAgent) === 'ios';
}
