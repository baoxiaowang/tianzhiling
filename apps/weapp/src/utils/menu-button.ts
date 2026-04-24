import Taro from '@tarojs/taro'

export interface MenuButtonMetrics {
  top: number
  right: number
  width: number
  height: number
  statusBarHeight: number
  navBarHeight: number
  totalHeight: number
}

export function readMenuButtonMetrics(): MenuButtonMetrics {
  try {
    const systemInfo = Taro.getSystemInfoSync() as {
      statusBarHeight?: number
      windowWidth?: number
    }
    const rect = Taro.getMenuButtonBoundingClientRect?.()
    const statusBarHeight = Math.max(systemInfo.statusBarHeight ?? 0, 0)
    const fallbackHeight = 32
    const fallbackWidth = 87
    const fallbackTop = statusBarHeight > 0 ? statusBarHeight + 6 : 10
    const height =
      rect && Number.isFinite(rect.height) && rect.height > 0
        ? Math.round(rect.height)
        : fallbackHeight
    const width =
      rect && Number.isFinite(rect.width) && rect.width > 0
        ? Math.round(rect.width)
        : fallbackWidth
    const top =
      rect && Number.isFinite(rect.top) && rect.top > 0
        ? Math.round(rect.top)
        : fallbackTop
    const right =
      rect
      && Number.isFinite(rect.right)
      && typeof systemInfo.windowWidth === 'number'
      && systemInfo.windowWidth > 0
        ? Math.max(Math.round(systemInfo.windowWidth - rect.right), 0)
        : 10
    const navPadding = Math.max(top - statusBarHeight, 4)
    const navBarHeight = height + navPadding * 2

    return {
      top,
      right,
      width,
      height,
      statusBarHeight,
      navBarHeight,
      totalHeight: statusBarHeight + navBarHeight,
    }
  } catch {
    return {
      top: 10,
      right: 10,
      width: 87,
      height: 32,
      statusBarHeight: 0,
      navBarHeight: 44,
      totalHeight: 44,
    }
  }
}
