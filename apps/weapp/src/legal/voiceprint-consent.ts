import Taro from '@tarojs/taro'
import { openAgreementDocument } from '../utils/agreement-nav'

const VOICEPRINT_CONSENT_KEY = 'tzl_voiceprint_consent_v1'

export function hasVoiceprintConsent(): boolean {
  try {
    return Taro.getStorageSync<boolean>(VOICEPRINT_CONSENT_KEY) === true
  } catch {
    return false
  }
}

export function setVoiceprintConsent() {
  try {
    Taro.setStorageSync(VOICEPRINT_CONSENT_KEY, true)
  } catch {
    // Non-critical, consent will be re-asked.
  }
}

export async function requestVoiceprintConsent(): Promise<boolean> {
  if (hasVoiceprintConsent()) {
    return true
  }

  const firstAsk = await Taro.showModal({
    title: '声纹信息授权',
    content:
      '为帮助你创建逝去亲人的声音模型，需要收集你的声纹信息（属于敏感个人信息）。\n\n' +
      '请先阅读《天之灵声纹信息授权协议》，了解我们如何收集、使用和保护你的声纹信息。',
    confirmText: '查看协议',
    cancelText: '暂不使用',
  })

  if (!firstAsk.confirm) {
    return false
  }

  // Navigate to full agreement
  await openAgreementDocument('voiceprint')

  const secondAsk = await Taro.showModal({
    title: '声纹信息授权协议',
    content:
      '你已阅读《天之灵声纹信息授权协议》。\n\n' +
      '点击"同意并继续"即表示你同意授权我们按照协议所述目的、方式和用途，收集、使用和存储你的声纹信息。',
    confirmText: '同意并继续',
    cancelText: '暂不同意',
  })

  if (secondAsk.confirm) {
    setVoiceprintConsent()
    return true
  }

  return false
}
