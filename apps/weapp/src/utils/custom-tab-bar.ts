import Taro from '@tarojs/taro'

export const CUSTOM_TAB_BAR_ITEMS = [
  {
    key: 'moments',
    text: '朋友圈',
    pagePath: '/pages/index/index',
  },
  {
    key: 'contacts',
    text: '通讯录',
    pagePath: '/pages/contacts/index',
  },
  {
    key: 'me',
    text: '我的',
    pagePath: '/pages/me/index',
  },
] as const

export type CustomTabBarKey = (typeof CUSTOM_TAB_BAR_ITEMS)[number]['key']

export function syncCustomTabBar(pagePath: string) {
  const pageObj = Taro.getCurrentInstance().page

  if (!pageObj) {
    return
  }

  const tabBar = Taro.getTabBar(pageObj) as
    | {
        setSelected?: (index: number) => void
      }
    | undefined

  const selectedIndex = CUSTOM_TAB_BAR_ITEMS.findIndex((item) => item.pagePath === pagePath)

  if (selectedIndex >= 0) {
    tabBar?.setSelected?.(selectedIndex)
  }
}
