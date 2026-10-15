/**
 * 管理端「手机 / 电脑」识别。
 *
 * 只按窗口宽度判断在真机上会出错：微信内置浏览器、手机开启「桌面版网站」时
 * 视口宽度可能 ≥992，于是被当成电脑版，手机上就会看到挤成一团的左侧菜单。
 * 因此这里按 UA + 触摸能力 + 视口宽度综合判断，并提供人工覆盖：
 *   - 地址栏 `?view=mobile` / `?view=desktop` / `?view=auto`（会记到 localStorage）
 *   - 右上角头像菜单里的「手机版 / 电脑版」切换
 */

export type ViewMode = 'auto' | 'mobile' | 'desktop';
export type Device = 'mobile' | 'desktop';

export const VIEW_MODE_STORAGE_KEY = 'tzl-admin-view-mode';

// 手机（含微信内置浏览器）
const PHONE_UA =
  /(iPhone|iPod|Android|HarmonyOS|Windows Phone|BlackBerry|Mobile Safari|MicroMessenger|WeChat)/i;
// 平板：屏幕够大，仍用电脑版
const TABLET_UA = /(iPad|Tablet|PlayBook|Silk|Kindle|Macintosh.*Mobile)/i;

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (navigator.maxTouchPoints || 0) > 1 ||
    'ontouchstart' in window ||
    // @ts-ignore 老浏览器兜底
    navigator.msMaxTouchPoints > 0
  );
}

export function readViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'auto';
  try {
    const query = new URLSearchParams(window.location.search).get('view');
    if (query === 'mobile' || query === 'desktop' || query === 'auto') {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, query);
      return query;
    }
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === 'mobile' || saved === 'desktop' || saved === 'auto') {
      return saved;
    }
  } catch (error) {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
  return 'auto';
}

export function writeViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch (error) {
    // 同上
  }
}

/** 是否手机：UA 命中手机 → 手机（即使微信/桌面版把视口撑宽）；平板 → 电脑；其余按宽度兜底 */
export function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (TABLET_UA.test(ua) && !/MicroMessenger|WeChat/i.test(ua)) return false;
  if (PHONE_UA.test(ua)) return true;
  if (
    isTouchDevice() &&
    Math.min(window.innerWidth, window.innerHeight) < 600
  ) {
    return true;
  }
  // 桌面浏览器把窗口拉窄时，沿用原来的「<992 用抽屉菜单」行为
  return window.innerWidth < 992;
}

export function resolveDevice(mode: ViewMode = readViewMode()): Device {
  if (mode === 'mobile') return 'mobile';
  if (mode === 'desktop') return 'desktop';
  return detectMobile() ? 'mobile' : 'desktop';
}

export function applyDeviceClass(device: Device) {
  if (typeof document === 'undefined') return;
  const { body } = document;
  body.classList.toggle('tzl-mobile', device === 'mobile');
  body.classList.toggle('tzl-desktop', device === 'desktop');
  document.documentElement.setAttribute('data-tzl-device', device);
}
