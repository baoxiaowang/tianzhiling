<template>
  <view
    class="chat-message-bubble"
    :class="{
      'chat-message-bubble--user': isUser,
      'chat-message-bubble--image': type === 'image',
      'chat-message-bubble--voice': type === 'voice',
      'chat-message-bubble--voice-active': type === 'voice' && isVoiceActive,
      'chat-message-bubble--with-text-voice': type === 'text' && hasVoicePlayback,
      'chat-message-bubble--text-voice-active':
        type === 'text' && hasVoicePlayback && isVoiceActive,
    }"
    @tap="handleBubbleTap"
    @longpress.stop="handleLongPress"
  >
    <template v-if="type === 'image'">
      <view
        v-if="imageUrl"
        class="chat-message-bubble__image"
        @tap.stop="handleImagePreview"
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
      @tap.stop="handleVoiceTap"
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
    <view v-else class="chat-message-bubble__text-wrap">
      <view class="chat-message-bubble__text-row">
        <text
          class="chat-message-bubble__text"
          :class="{ 'chat-message-bubble__text--collapsed': isLongText && isTextCollapsed }"
        >
          {{ text }}
        </text>
        <view
          v-if="hasVoicePlayback"
          class="chat-message-bubble__text-voice-button"
          :class="{
            'chat-message-bubble__text-voice-button--active': isVoiceActive,
            'chat-message-bubble__text-voice-button--playing': isVoicePlaying,
          }"
          @tap.stop="handleVoiceTap"
        >
          <view v-if="isVoiceLoading" class="chat-message-bubble__text-voice-loading">
            <view class="chat-message-bubble__spinner" />
          </view>
          <PlayStop v-else-if="isVoicePlaying" size="14" color="#078c49" />
          <PlayStart v-else size="14" color="#111111" />
        </view>
      </view>
      <view
        v-if="isLongText"
        class="chat-message-bubble__expand"
        @tap.stop="handleExpandToggle"
      >
        <text class="chat-message-bubble__expand-text">
          {{ isTextCollapsed ? '展开' : '收起' }}
        </text>
      </view>
      <view v-if="quotedText" class="chat-message-bubble__quote">
        <text class="chat-message-bubble__quote-text">
          {{ quotedLabel ? `${quotedLabel}：${quotedText}` : quotedText }}
        </text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'ChatMessageBubble',
}
</script>

<script setup lang="ts">
import { PlayStart, PlayStop } from '@nutui/icons-vue-taro'
import Taro from '@tarojs/taro'
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    type?: 'text' | 'image' | 'voice'
    text?: string
    imageUrl?: string
    voiceDurationMs?: number
    hasVoicePlayback?: boolean
    isVoiceActive?: boolean
    isVoicePlaying?: boolean
    isVoiceLoading?: boolean
    isUser?: boolean
    isSending?: boolean
    collapseThreshold?: number
    quotedText?: string
    quotedLabel?: string
  }>(),
  {
    type: 'text',
    text: '',
    imageUrl: '',
    voiceDurationMs: 0,
    hasVoicePlayback: false,
    isVoiceActive: false,
    isVoicePlaying: false,
    isVoiceLoading: false,
    isUser: false,
    isSending: false,
    collapseThreshold: 45,
    quotedText: '',
    quotedLabel: '',
  },
)

const emit = defineEmits<{
  'message-tap': []
  'voice-tap': []
  'message-long-press': []
}>()

const voiceSeconds = computed(() => {
  return Math.max(1, Math.round(props.voiceDurationMs / 1000))
})

const voiceDurationLabel = computed(() => `${voiceSeconds.value}"`)

const isTextCollapsed = ref(true)

const normalizedCollapseThreshold = computed(() => {
  return Math.max(20, Math.floor(props.collapseThreshold))
})

const isLongText = computed(() => {
  return props.type === 'text' && props.text.length > normalizedCollapseThreshold.value
})

watch(
  () => props.text,
  () => {
    isTextCollapsed.value = true
  },
)

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

function handleBubbleTap() {
  emit('message-tap')
}

function handleExpandToggle() {
  isTextCollapsed.value = !isTextCollapsed.value
}

function handleLongPress() {
  emit('message-long-press')
}
</script>

<style lang="scss">
.chat-message-bubble {
  position: relative;
  min-width: 0;
  max-width: var(--chat-message-bubble-max-width, 264px);
  flex-shrink: 1;
  padding: 10px 12px;
  border-radius: 6px;
  background: #ffffff;
  box-sizing: border-box;
}

.chat-message-bubble::before {
  content: '';
  position: absolute;
  top: 13px;
  left: -3px;
  width: 10px;
  height: 10px;
  background: inherit;
  transform: rotate(45deg);
}

.chat-message-bubble--user {
  background: #95ec69;
}

.chat-message-bubble--user::before {
  right: -3px;
  left: auto;
}

.chat-message-bubble--image {
  padding: 0;
  border-radius: 4px;
  background: transparent;
}

.chat-message-bubble--image::before {
  display: none;
}

.chat-message-bubble--voice {
  padding: 0;
  border-radius: 6px;
}

.chat-message-bubble--voice-active {
  box-shadow: 0 0 0 1px rgba(7, 193, 96, 0.28);
}

.chat-message-bubble--with-text-voice {
  padding-right: 10px;
}

.chat-message-bubble--text-voice-active {
  box-shadow: none;
}

.chat-message-bubble__text-wrap {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-message-bubble__text-row {
  min-width: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.chat-message-bubble__text {
  display: block;
  min-width: 0;
  flex: 1;
  color: #111111;
  font-size: 16px;
  line-height: 22.4px;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-message-bubble__text--collapsed {
  max-height: 67.2px;
  overflow: hidden;
}

.chat-message-bubble__expand {
  align-self: flex-start;
  padding-top: 1px;
}

.chat-message-bubble--user .chat-message-bubble__expand {
  align-self: flex-end;
}

.chat-message-bubble__expand-text {
  color: #576b95;
  font-size: 14px;
  line-height: 20px;
}

.chat-message-bubble__quote {
  margin-top: 2px;
  padding-top: 6px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.chat-message-bubble__quote-text {
  display: block;
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
  line-height: 18px;
  word-break: break-word;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-message-bubble__text-voice-button {
  position: relative;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #f2f4f7;
  box-sizing: border-box;
}

.chat-message-bubble__text-voice-button--active {
  background: #eaf9f0;
}

.chat-message-bubble__text-voice-button--playing {
  box-shadow: inset 0 0 0 1px rgba(7, 193, 96, 0.28);
}

.chat-message-bubble__text-voice-loading .chat-message-bubble__spinner {
  width: 14px;
  height: 14px;
  border-color: rgba(7, 193, 96, 0.18);
  border-top-color: #07c160;
}

.chat-message-bubble__image {
  position: relative;
  width: 180px;
  height: 240px;
  overflow: hidden;
  border-radius: 4px;
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
