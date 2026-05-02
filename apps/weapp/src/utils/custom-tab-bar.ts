import Taro from '@tarojs/taro'

export const CUSTOM_TAB_BAR_ITEMS = [
  {
    key: 'moments',
    text: '动态',
    pagePath: '/pages/index/index',
    icon: require('../assets/icon/dynamic.svg'),
    activeIcon: require('../assets/icon/dynamic-active.svg'),
  },
  {
    key: 'contacts',
    text: '聊天',
    pagePath: '/pages/contacts/index',
    icon: require('../assets/icon/chat.svg'),
    activeIcon: require('../assets/icon/chat-active.svg'),
  },
  {
    key: 'me',
    text: '我的',
    pagePath: '/pages/me/index',
    icon: require('../assets/icon/mine.svg'),
    activeIcon: require('../assets/icon/mine-active.svg'),
  },
] as const

export type CustomTabBarKey = (typeof CUSTOM_TAB_BAR_ITEMS)[number]['key']

function getCurrentCustomTabBar() {
  const pageObj = Taro.getCurrentInstance().page

  if (!pageObj) {
    return undefined
  }

  return Taro.getTabBar(pageObj) as
    | {
        setSelected?: (index: number) => void
        setHidden?: (hidden: boolean) => void
      }
    | undefined
}

export function syncCustomTabBar(pagePath: string) {
  const tabBar = getCurrentCustomTabBar()

  const selectedIndex = CUSTOM_TAB_BAR_ITEMS.findIndex((item) => item.pagePath === pagePath)

  if (selectedIndex >= 0) {
    tabBar?.setSelected?.(selectedIndex)
  }
}

export function setCustomTabBarHidden(hidden: boolean) {
  getCurrentCustomTabBar()?.setHidden?.(hidden)
}
