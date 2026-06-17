import Taro from '@tarojs/taro'

let innerAudioOptionConfigured = false
let innerAudioOptionPromise: Promise<boolean> | null = null

export function ensureInnerAudioPlaybackOptions() {
  if (innerAudioOptionConfigured) {
    return Promise.resolve(true)
  }

  if (innerAudioOptionPromise) {
    return innerAudioOptionPromise
  }

  innerAudioOptionPromise = Taro.setInnerAudioOption({
    obeyMuteSwitch: false,
  }).then(
    () => {
      innerAudioOptionConfigured = true
      innerAudioOptionPromise = null
      return true
    },
    () => {
      innerAudioOptionPromise = null
      return false
    },
  )

  return innerAudioOptionPromise
}
