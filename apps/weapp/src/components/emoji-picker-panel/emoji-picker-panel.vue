<template>
  <view v-if="visible" class="emoji-picker-panel">
    <view class="emoji-picker-panel__grid">
      <view
        v-for="emoji in resolvedEmojis"
        :key="emoji"
        class="emoji-picker-panel__cell"
        @tap="handleEmojiTap(emoji)"
      >
        <text class="emoji-picker-panel__emoji">{{ emoji }}</text>
      </view>
    </view>

    <view class="emoji-picker-panel__delete" @tap="handleBackspaceTap">
      <text class="emoji-picker-panel__delete-symbol">⌫</text>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'EmojiPickerPanel',
}
</script>

<script setup lang="ts">
import { computed } from 'vue'

const defaultEmojis = [
  '😀',
  '😄',
  '😁',
  '🥹',
  '😊',
  '😉',
  '😍',
  '😘',
  '🥰',
  '😋',
  '🤔',
  '😎',
  '🥳',
  '😭',
  '😂',
  '😤',
  '😴',
  '🙄',
  '😅',
  '🥲',
  '😇',
  '🤗',
  '🤭',
  '🤩',
  '😌',
  '😔',
  '😢',
  '😡',
  '👍',
  '👋',
  '🙏',
  '❤️',
  '💔',
  '🎉',
  '🎂',
  '🌹',
  '🌈',
  '☀️',
  '🌙',
  '⭐️',
  '🍎',
  '🍜',
  '☕️',
  '🎵',
  '🎈',
  '🐶',
  '🐱',
  '🐼',
]

const props = withDefaults(
  defineProps<{
    visible?: boolean
    emojis?: string[]
  }>(),
  {
    visible: false,
    emojis: () => [],
  },
)

const emit = defineEmits<{
  emojiSelect: [emoji: string]
  backspace: []
}>()

const resolvedEmojis = computed(() => {
  return props.emojis.length ? props.emojis : defaultEmojis
})

function handleEmojiTap(emoji: string) {
  emit('emojiSelect', emoji)
}

function handleBackspaceTap() {
  emit('backspace')
}
</script>

<style lang="scss">
.emoji-picker-panel {
  position: relative;
  height: calc(216px + env(safe-area-inset-bottom));
  border-top: 0.5px solid #e6e6e6;
  background: #f7f7f7;
  box-sizing: border-box;
}

.emoji-picker-panel__grid {
  height: 100%;
  padding: 10px 10px calc(env(safe-area-inset-bottom) + 12px);
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-auto-rows: calc((100vw - 20px - 42px) / 8);
  align-content: start;
  gap: 8px 6px;
  box-sizing: border-box;
  overflow-y: auto;
}

.emoji-picker-panel__cell,
.emoji-picker-panel__delete {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
}

.emoji-picker-panel__cell:active,
.emoji-picker-panel__delete:active {
  background: rgba(0, 0, 0, 0.06);
}

.emoji-picker-panel__emoji {
  font-size: 28px;
  line-height: 1;
}

.emoji-picker-panel__delete {
  position: absolute;
  right: 10px;
  bottom: calc(env(safe-area-inset-bottom) + 12px);
  width: calc((100vw - 20px - 42px) / 8);
  height: calc((100vw - 20px - 42px) / 8);
  border: 0.5px solid rgba(87, 96, 113, 0.14);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.08);
  box-sizing: border-box;
}

.emoji-picker-panel__delete-symbol {
  color: #576071;
  font-size: 25px;
  line-height: 1;
  font-weight: 500;
}
</style>
