<template>
  <view v-if="visible" class="chat-more-panel">
    <view
      v-for="item in items"
      :key="item.key"
      class="chat-more-panel__item"
      @tap="handleActionTap(item)"
    >
      <view
        class="chat-more-panel__icon"
        :class="`chat-more-panel__icon--${item.key}`"
      >
        <view class="chat-more-panel__icon-inner" />
      </view>
      <text class="chat-more-panel__label">{{ item.label }}</text>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'ChatMorePanel',
}
</script>

<script setup lang="ts">
import type { ChatMoreActionItem } from './types'

withDefaults(
  defineProps<{
    visible?: boolean
  }>(),
  {
    visible: false,
  },
)

const emit = defineEmits<{
  action: [item: ChatMoreActionItem]
}>()

const items: ChatMoreActionItem[] = [
  { key: 'photo', label: '照片' },
  { key: 'camera', label: '拍摄' },
]

function handleActionTap(item: ChatMoreActionItem) {
  emit('action', item)
}
</script>

<style lang="scss">
.chat-more-panel {
  display: flex;
  flex-wrap: wrap;
  height: 228px;
  padding: 18px 14px 20px;
  box-sizing: border-box;
  background: #f1f1f1;
  border-top: 0.5px solid #e2e2e2;
}

.chat-more-panel__item {
  width: 25%;
  height: 82px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: 14px;
}

.chat-more-panel__icon {
  position: relative;
  width: 58px;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16px;
  background: #fcfcfc;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.chat-more-panel__icon-inner,
.chat-more-panel__icon-inner::before,
.chat-more-panel__icon-inner::after,
.chat-more-panel__icon::before,
.chat-more-panel__icon::after {
  position: absolute;
  box-sizing: border-box;
  content: '';
}

.chat-more-panel__label {
  margin-top: 8px;
  color: #6e6e6e;
  font-size: 13px;
  line-height: 16px;
}

.chat-more-panel__icon--photo .chat-more-panel__icon-inner {
  width: 28px;
  height: 24px;
  border: 2px solid #5b5b5b;
  border-radius: 5px;
}

.chat-more-panel__icon--photo .chat-more-panel__icon-inner::before {
  top: 5px;
  right: 5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #5b5b5b;
}

.chat-more-panel__icon--photo .chat-more-panel__icon-inner::after {
  right: 4px;
  bottom: 4px;
  width: 17px;
  height: 10px;
  border-right: 9px solid transparent;
  border-bottom: 10px solid #5b5b5b;
  border-left: 9px solid transparent;
}

.chat-more-panel__icon--camera .chat-more-panel__icon-inner {
  width: 30px;
  height: 22px;
  border: 2px solid #5b5b5b;
  border-radius: 6px;
}

.chat-more-panel__icon--camera .chat-more-panel__icon-inner::before {
  top: -6px;
  left: 7px;
  width: 12px;
  height: 6px;
  border-radius: 4px 4px 0 0;
  background: #5b5b5b;
}

.chat-more-panel__icon--camera .chat-more-panel__icon-inner::after {
  top: 5px;
  left: 8px;
  width: 10px;
  height: 10px;
  border: 2px solid #5b5b5b;
  border-radius: 50%;
}

</style>
