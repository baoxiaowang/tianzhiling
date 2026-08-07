import { buildOssMediaUrl } from '@tzl/shared'

export interface PromoBannerItem {
  id: string
  imageUrl: string
  link?: string
  text?: string
}

export const DEFAULT_BANNERS: readonly PromoBannerItem[] = [
  // {
  //   id: 'voice-clone',
  //   imageUrl: buildOssMediaUrl('/weapp/post-banner-voice.png'),
  //   link: '/pages/voice-package/index',
  //   text: '创建TA的声音',
  // },
  {
    id: 'vip',
    imageUrl: buildOssMediaUrl('/weapp/post-banner-vip.png'),
    link: '/pages/vip-center/index',
    text: '加入会员，解锁无限畅聊',
  },
]
