import Taro from '@tarojs/taro'

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

  return new Promise<boolean>((resolve) => {
    Taro.showModal({
      title: '声纹信息授权协议',
      content:
        '你即将使用声音复刻服务。为帮助你创建逝去亲人的声音模型，我们需要收集、使用和存储你的声纹信息（属于敏感个人信息）。\n\n' +
        '你可以随时在"天之灵声纹信息授权协议"中查看详细说明。\n\n' +
        '点击"同意并继续"即表示你已阅读并同意上述协议，授权我们按照协议所述目的、方式和用途处理你的声纹信息。',
      confirmText: '同意并继续',
      cancelText: '暂不同意',
      success: (res) => {
        if (res.confirm) {
          setVoiceprintConsent()
          resolve(true)
        } else {
          resolve(false)
        }
      },
      fail: () => resolve(false),
    })
  })
}
