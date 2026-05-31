<template>
  <view class="chat-bottom" :style="composerStyle">
    <view class="chat-composer">
      <view
        class="chat-composer__icon-button"
        :class="{ 'chat-composer__icon-button--selected': isVoiceMode }"
        @tap="emit('voiceModeToggle')"
      >
        <view v-if="isVoiceMode" class="chat-composer__keyboard">
          <image class="chat-composer__keyboard-icon" :src="keyboardIconUrl" mode="aspectFit" />
        </view>
        <view v-else class="chat-composer__mic">
          <image class="chat-composer__mic-icon" :src="micIconUrl" mode="aspectFit" />
        </view>
      </view>

      <view
        v-if="isVoiceMode"
        class="chat-composer__voice-button"
        :class="{
          'chat-composer__voice-button--pressing': isVoiceGestureActive,
          'chat-composer__voice-button--loading': isTranscribingVoice,
        }"
        @touchstart="emit('voiceTouchStart', $event)"
        @touchmove="emit('voiceTouchMove', $event)"
        @touchend="emit('voiceTouchEnd', $event)"
        @touchcancel="emit('voiceTouchCancel')"
      >
        <view v-if="isTranscribingVoice" class="chat-composer__voice-loading" />
        <text class="chat-composer__voice-button-text">{{ voiceButtonLabel }}</text>
      </view>

      <view v-else class="chat-composer__input-shell">
        <input
          :value="draftMessage"
          class="chat-composer__input"
          type="text"
          :maxlength="maxLength"
          confirm-type="send"
          :cursor="cursorControlEnabled ? draftCursor : undefined"
          :adjust-position="false"
          cursor-spacing="16"
          placeholder=""
          placeholder-style="color: #999999;"
          @input="emit('draftInput', $event)"
          @confirm="emit('send')"
          @focus="emit('inputFocus')"
          @blur="emit('inputBlur')"
          @keyboardheightchange="emit('keyboardHeightChange', $event)"
        />
      </view>

      <view
        class="chat-composer__icon-button"
        :class="{ 'chat-composer__icon-button--selected': isEmojiPanelVisible }"
        @tap="emit('emojiToggle')"
      >
        <view class="chat-composer__emoji">
          <image class="chat-composer__emoji-icon" :src="emojiIconUrl" mode="aspectFit" />
        </view>
      </view>

      <view
        v-if="!showSendButton"
        class="chat-composer__icon-button"
        :class="{ 'chat-composer__icon-button--selected': isMorePanelVisible }"
        @tap="emit('moreToggle')"
      >
        <view class="chat-composer__plus">
          <image class="chat-composer__plus-icon" :src="plusIconUrl" mode="aspectFit" />
        </view>
      </view>

      <view
        v-else
        class="chat-composer__send"
        :class="{ 'chat-composer__send--disabled': isSendDisabled }"
        @tap="emit('send')"
      >
        发送
      </view>
    </view>

    <emoji-picker-panel
      :visible="isEmojiPanelVisible"
      @emoji-select="emit('emojiSelect', $event)"
      @backspace="emit('emojiDelete')"
    />

    <chat-more-panel
      :visible="isMorePanelVisible"
      @action="emit('moreAction', $event)"
    />
  </view>
</template>

<script lang="ts">
export default {
  name: 'ChatComposer',
}
</script>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { ITouchEvent } from '@tarojs/components/types/common'
import keyboardIconUrl from '../../assets/icon/keyboard.svg'
import micIconUrl from '../../assets/icon/mic.svg'
import emojiIconUrl from '../../assets/icon/emoji.svg'
import plusIconUrl from '../../assets/icon/plus.svg'
import ChatMorePanel from '../chat-more-panel/chat-more-panel.vue'
import type { ChatMoreActionItem } from '../chat-more-panel/types'
import EmojiPickerPanel from '../emoji-picker-panel/emoji-picker-panel.vue'

type DraftInputEvent = InputEvent | {
  detail?: {
    value?: string
    cursor?: number
  }
}

type KeyboardHeightChangeEvent = {
  detail?: {
    height?: number
  }
}

type VoiceTouchEvent = ITouchEvent | TouchEvent

withDefaults(
  defineProps<{
    composerStyle?: CSSProperties
    draftMessage?: string
    draftCursor?: number
    cursorControlEnabled?: boolean
    maxLength: number
    isVoiceMode?: boolean
    isVoiceGestureActive?: boolean
    isTranscribingVoice?: boolean
    voiceButtonLabel?: string
    isEmojiPanelVisible?: boolean
    isMorePanelVisible?: boolean
    showSendButton?: boolean
    isSendDisabled?: boolean
  }>(),
  {
    composerStyle: () => ({}),
    draftMessage: '',
    draftCursor: 0,
    cursorControlEnabled: false,
    isVoiceMode: false,
    isVoiceGestureActive: false,
    isTranscribingVoice: false,
    voiceButtonLabel: '',
    isEmojiPanelVisible: false,
    isMorePanelVisible: false,
    showSendButton: false,
    isSendDisabled: false,
  },
)

const emit = defineEmits<{
  voiceModeToggle: []
  voiceTouchStart: [event: VoiceTouchEvent]
  voiceTouchMove: [event: VoiceTouchEvent]
  voiceTouchEnd: [event: VoiceTouchEvent]
  voiceTouchCancel: []
  draftInput: [event: DraftInputEvent]
  send: []
  inputFocus: []
  inputBlur: []
  keyboardHeightChange: [event: KeyboardHeightChangeEvent]
  emojiToggle: []
  moreToggle: []
  emojiSelect: [emoji: string]
  emojiDelete: []
  moreAction: [item: ChatMoreActionItem]
}>()
</script>

<style lang="scss">
.chat-bottom {
  background: #f7f7f7;
}

.chat-composer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 60px;
  padding: 8px 8px;
  box-sizing: border-box;
  background: #f7f7f7;
  border-top: 0.5px solid #d9d9d9;
}

.chat-composer__icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
}

.chat-composer__input-shell {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  border: 0.5px solid #e5e5e5;
  border-radius: 10px;
  background: #ffffff;
}

.chat-composer__voice-button {
  flex: 1;
  min-width: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0.5px solid #e5e5e5;
  border-radius: 10px;
  background: #ffffff;
  color: #111111;
  font-size: 15px;
  line-height: 22px;
  font-weight: 500;
  box-sizing: border-box;
}

.chat-composer__voice-button--loading {
  border-color: rgba(7, 193, 96, 0.28);
  background: #eaf9f0;
  color: #078c49;
  font-weight: 600;
}

.chat-composer__voice-button--pressing {
  border-color: #bcbcbc;
  background: #e2e2e2;
  font-weight: 600;
}

.chat-composer__voice-loading {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(7, 193, 96, 0.18);
  border-top-color: #07c160;
  border-radius: 50%;
  animation: chat-spin 0.8s linear infinite;
  box-sizing: border-box;
}

.chat-composer__voice-button-text {
  font-size: inherit;
  line-height: inherit;
  font-weight: inherit;
  color: inherit;
}

.chat-composer__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  font-size: 15px;
  color: #111111;
}

.chat-composer__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  background: #07c160;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.chat-composer__send--disabled {
  opacity: 0.6;
}

.chat-composer__mic,
.chat-composer__keyboard,
.chat-composer__emoji,
.chat-composer__plus {
  position: relative;
  width: 38px;
  height: 38px;
}

.chat-composer__mic,
.chat-composer__keyboard,
.chat-composer__emoji,
.chat-composer__plus {
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-composer__mic-icon,
.chat-composer__keyboard-icon,
.chat-composer__emoji-icon,
.chat-composer__plus-icon {
  width: 38px;
  height: 38px;
  display: block;
}

@keyframes chat-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
