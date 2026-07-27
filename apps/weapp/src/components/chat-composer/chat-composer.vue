<template>
  <view class="chat-bottom" :style="composerStyle">
    <view v-if="quotedText" class="chat-composer-quote">
      <view class="chat-composer-quote__content">
        <text class="chat-composer-quote__label">{{ quotedLabel }}</text>
        <text class="chat-composer-quote__text">{{ quotedText }}</text>
      </view>
      <view class="chat-composer-quote__close" @tap="emit('quoteCancel')">×</view>
    </view>

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
        <textarea
          :value="draftMessage"
          class="chat-composer__input"
          :maxlength="maxLength"
          :auto-height="true"
          :adjust-position="false"
          :show-confirm-bar="false"
          :disable-default-padding="true"
          cursor-spacing="16"
          confirm-type="return"
          placeholder=""
          placeholder-style="color: #999999;"
          @input="emit('draftInput', $event)"
          @focus="emit('inputFocus')"
          @blur="emit('inputBlur')"
          @keyboardheightchange="emit('keyboardHeightChange', $event)"
        ></textarea>
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
    quotedText?: string
    quotedLabel?: string
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
    quotedText: '',
    quotedLabel: '引用',
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
  quoteCancel: []
}>()
</script>

<style lang="scss">
.chat-bottom {
  background: #f7f7f7;
}

.chat-composer-quote {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px 0;
  box-sizing: border-box;
  background: #f7f7f7;
  border-top: 0.5px solid #d9d9d9;
}

.chat-composer-quote__content {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 10px;
  box-sizing: border-box;
  border-radius: 5px;
  background: #e9e9e9;
}

.chat-composer-quote__label {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 18px;
  color: #666666;
}

.chat-composer-quote__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: #333333;
}

.chat-composer-quote__close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #777777;
  font-size: 22px;
  line-height: 28px;
}

.chat-composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-height: 52px;
  padding: 6px 8px;
  box-sizing: border-box;
  background: #f7f7f7;
  border-top: 0.5px solid #d9d9d9;
}

.chat-composer__icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin-bottom: 1px;
  flex-shrink: 0;
}

.chat-composer__input-shell {
  flex: 1;
  min-width: 0;
  min-height: 36px;
  max-height: 78px;
  padding: 7px 10px;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  border: 0.5px solid #e5e5e5;
  border-radius: 5px;
  background: #ffffff;
  overflow: hidden;
}

.chat-composer__voice-button {
  flex: 1;
  min-width: 0;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0.5px solid #e5e5e5;
  border-radius: 5px;
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
  min-height: 22px;
  max-height: 64px;
  font-size: 15px;
  line-height: 22px;
  color: #111111;
  overflow-y: auto;
}

.chat-composer__send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 32px;
  margin-bottom: 2px;
  flex-shrink: 0;
  border-radius: 4px;
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
  width: 34px;
  height: 34px;
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
  width: 34px;
  height: 34px;
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
