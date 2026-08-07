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

export async function openVoiceprintAgreement() {
  await openAgreementDocument('voiceprint')
}
