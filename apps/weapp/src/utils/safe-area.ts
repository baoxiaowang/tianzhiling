import Taro from '@tarojs/taro'
import { readonly, shallowRef } from 'vue'

export interface SafeAreaInsets {
  top: number
  bottom: number
}

const safeAreaInsetsState = shallowRef<SafeAreaInsets>({
  top: 0,
  bottom: 0,
})

let safeAreaInitialized = false

function readSafeAreaInsets(): SafeAreaInsets {
  try {
    const systemInfo = Taro.getSystemInfoSync() as {
      safeArea?: {
        top?: number
        bottom?: number
      }
      screenHeight?: number
      statusBarHeight?: number
    }

    const top = systemInfo.safeArea?.top ?? systemInfo.statusBarHeight ?? 0
    const bottom =
      typeof systemInfo.safeArea?.bottom === 'number' && typeof systemInfo.screenHeight === 'number'
        ? Math.max(systemInfo.screenHeight - systemInfo.safeArea.bottom, 0)
        : 0

    return { top, bottom }
  } catch {
    return { top: 0, bottom: 0 }
  }
}

export function initSafeAreaInsets() {
  if (safeAreaInitialized) {
    return safeAreaInsetsState.value
  }

  safeAreaInsetsState.value = readSafeAreaInsets()
  safeAreaInitialized = true

  return safeAreaInsetsState.value
}

export function useSafeAreaInsets() {
  return readonly(safeAreaInsetsState)
}

export function createSafeAreaCssVars(prefix: string) {
  const safeAreaInsets = safeAreaInsetsState.value
  const style: Record<string, string> = {}

  if (safeAreaInsets.top > 0) {
    style[`--${prefix}-top`] = `${safeAreaInsets.top}px`
  }

  if (safeAreaInsets.bottom > 0) {
    style[`--${prefix}-bottom`] = `${safeAreaInsets.bottom}px`
  }

  return style
}
