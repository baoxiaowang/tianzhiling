<template>
  <view
    class="chat-message-bubble"
    :class="{
      'chat-message-bubble--user': isUser,
      'chat-message-bubble--image': type === 'image',
      'chat-message-bubble--voice': type === 'voice',
      'chat-message-bubble--voice-active': type === 'voice' && isVoiceActive,
    }"
  >
    <template v-if="type === 'image'">
      <view
        v-if="imageUrl"
        class="chat-message-bubble__image"
        @tap="handleImagePreview"
      >
        <image
          class="chat-message-bubble__image-content"
          :src="imageUrl"
          mode="aspectFill"
        />
        <view v-if="isSending" class="chat-message-bubble__image-mask">
          <view class="chat-message-bubble__spinner" />
        </view>
      </view>
      <view v-else class="chat-message-bubble__image-placeholder">
        <view class="chat-message-bubble__image-placeholder-icon">
          <view class="chat-message-bubble__image-placeholder-sun" />
          <view
            class="chat-message-bubble__image-placeholder-mountain chat-message-bubble__image-placeholder-mountain--left"
          />
          <view
            class="chat-message-bubble__image-placeholder-mountain chat-message-bubble__image-placeholder-mountain--right"
          />
        </view>
      </view>
    </template>
    <view
      v-else-if="type === 'voice'"
      class="chat-message-bubble__voice"
      :style="voiceStyle"
      @tap="handleVoiceTap"
    >
      <view
        v-if="!isUser"
        class="chat-message-bubble__voice-icon"
        :class="{ 'chat-message-bubble__voice-icon--playing': isVoicePlaying }"
      >
        <view class="chat-message-bubble__voice-wave chat-message-bubble__voice-wave--small" />
        <view class="chat-message-bubble__voice-wave chat-message-bubble__voice-wave--medium" />
        <view class="chat-message-bubble__voice-wave chat-message-bubble__voice-wave--large" />
      </view>
      <text class="chat-message-bubble__voice-duration">
        {{ voiceDurationLabel }}
      </text>
      <view
        v-if="isUser"
        class="chat-message-bubble__voice-icon chat-message-bubble__voice-icon--user"
        :class="{ 'chat-message-bubble__voice-icon--playing': isVoicePlaying }"
      >
        <view class="chat-message-bubble__voice-wave chat-message-bubble__voice-wave--small" />
        <view class="chat-message-bubble__voice-wave chat-message-bubble__voice-wave--medium" />
        <view class="chat-message-bubble__voice-wave chat-message-bubble__voice-wave--large" />
      </view>
      <view v-if="isSending || isVoiceLoading" class="chat-message-bubble__voice-loading">
        <view class="chat-message-bubble__spinner" />
      </view>
    </view>
    <text v-else class="chat-message-bubble__text">{{ text }}</text>
  </view>
</template>

<script lang="ts">
export default {
  name: 'ChatMessageBubble',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    type?: 'text' | 'image' | 'voice'
    text?: string
    imageUrl?: string
    voiceDurationMs?: number
    isVoiceActive?: boolean
    isVoicePlaying?: boolean
    isVoiceLoading?: boolean
    isUser?: boolean
    isSending?: boolean
  }>(),
  {
    type: 'text',
    text: '',
    imageUrl: '',
    voiceDurationMs: 0,
    isVoiceActive: false,
    isVoicePlaying: false,
    isVoiceLoading: false,
    isUser: false,
    isSending: false,
  },
)

const emit = defineEmits<{
  (event: 'voice-tap'): void
}>()

const voiceSeconds = computed(() => {
  return Math.max(1, Math.round(props.voiceDurationMs / 1000))
})

const voiceDurationLabel = computed(() => `${voiceSeconds.value}"`)

const voiceStyle = computed(() => {
  const normalizedSeconds = Math.min(Math.max(voiceSeconds.value, 2), 60)
  const progress = (normalizedSeconds - 2) / 58
  const width = Math.round(84 + progress * 132)

  return {
    width: `${width}px`,
  }
})

function handleImagePreview() {
  const trimmedUrl = props.imageUrl.trim()
  if (!trimmedUrl) {
    return
  }

  void Taro.previewImage({
    current: trimmedUrl,
    urls: [trimmedUrl],
  })
}

function handleVoiceTap() {
  emit('voice-tap')
}
</script>

<style lang="scss">
.chat-message-bubble {
  min-width: 0;
  max-width: var(--chat-message-bubble-max-width, 264px);
  flex-shrink: 1;
  padding: 10px 12px;
  border-radius: 10px;
  background: #ffffff;
  box-sizing: border-box;
}

.chat-message-bubble--user {
  background: #95ec69;
}

.chat-message-bubble--image {
  padding: 0;
  border-radius: 16px;
  background: transparent;
}

.chat-message-bubble--voice {
  padding: 0;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.chat-message-bubble--voice-active {
  box-shadow: 0 0 0 1px rgba(7, 193, 96, 0.28);
}

.chat-message-bubble__text {
  display: block;
  color: #111111;
  font-size: 16px;
  line-height: 22.4px;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-message-bubble__image {
  position: relative;
  width: 180px;
  height: 240px;
  overflow: hidden;
  border-radius: 16px;
  background: #f1f2f4;
}

.chat-message-bubble__image-content {
  display: block;
  width: 180px;
  height: 240px;
}

.chat-message-bubble__image-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.22);
}

.chat-message-bubble__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: chat-message-bubble-spin 0.8s linear infinite;
}

.chat-message-bubble__voice {
  position: relative;
  min-width: 84px;
  max-width: 100%;
  height: 40px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  box-sizing: border-box;
}

.chat-message-bubble__voice-duration {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: rgba(17, 17, 17, 0.88);
}

.chat-message-bubble__voice-icon {
  position: relative;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.chat-message-bubble__voice-icon--user {
  transform: scaleX(-1);
}

.chat-message-bubble__voice-wave {
  position: absolute;
  top: 50%;
  left: 0;
  border: 2px solid #111111;
  border-left: 0;
  border-top-color: transparent;
  border-bottom-color: transparent;
  border-radius: 0 999px 999px 0;
  transform: translateY(-50%);
  opacity: 0.88;
  box-sizing: border-box;
}

.chat-message-bubble__voice-wave--small {
  width: 5px;
  height: 8px;
}

.chat-message-bubble__voice-wave--medium {
  width: 10px;
  height: 13px;
  opacity: 0.68;
}

.chat-message-bubble__voice-wave--large {
  width: 15px;
  height: 18px;
  opacity: 0.46;
}

.chat-message-bubble__voice-icon--playing .chat-message-bubble__voice-wave--medium {
  animation: chat-message-bubble-voice-pulse 1s ease-in-out infinite;
}

.chat-message-bubble__voice-icon--playing .chat-message-bubble__voice-wave--large {
  animation: chat-message-bubble-voice-pulse 1s ease-in-out 0.18s infinite;
}

.chat-message-bubble__voice-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.16);
}

.chat-message-bubble__voice-loading .chat-message-bubble__spinner {
  width: 18px;
  height: 18px;
}

.chat-message-bubble__image-placeholder {
  width: 140px;
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #f1f2f4;
}

.chat-message-bubble__image-placeholder-icon {
  position: relative;
  width: 54px;
  height: 42px;
  border: 2px solid #98a2b3;
  border-radius: 8px;
  box-sizing: border-box;
}

.chat-message-bubble__image-placeholder-sun,
.chat-message-bubble__image-placeholder-mountain {
  position: absolute;
  box-sizing: border-box;
}

.chat-message-bubble__image-placeholder-sun {
  top: 8px;
  right: 9px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #98a2b3;
}

.chat-message-bubble__image-placeholder-mountain {
  bottom: 8px;
  border-right: 10px solid transparent;
  border-bottom: 12px solid #98a2b3;
  border-left: 10px solid transparent;
}

.chat-message-bubble__image-placeholder-mountain--left {
  left: 8px;
}

.chat-message-bubble__image-placeholder-mountain--right {
  right: 6px;
  border-right-width: 8px;
  border-bottom-width: 10px;
  border-left-width: 8px;
}

@keyframes chat-message-bubble-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@keyframes chat-message-bubble-voice-pulse {
  0%,
  100% {
    opacity: 0.28;
  }

  50% {
    opacity: 0.9;
  }
}
</style>
