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
  { key: 'videoCall', label: '视频通话' },
  { key: 'location', label: '位置' },
  { key: 'redPacket', label: '红包' },
  { key: 'gift', label: '礼物' },
  { key: 'transfer', label: '转账' },
]

function handleActionTap(item: ChatMoreActionItem) {
  emit('action', item)
}
</script>

<style lang="scss">
.chat-more-panel {
  display: flex;
  flex-wrap: wrap;
  min-height: 228px;
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

.chat-more-panel__icon--videoCall .chat-more-panel__icon-inner {
  width: 27px;
  height: 20px;
  border: 2px solid #5b5b5b;
  border-radius: 6px;
}

.chat-more-panel__icon--videoCall .chat-more-panel__icon-inner::after {
  top: 3px;
  right: -10px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 9px solid #5b5b5b;
}

.chat-more-panel__icon--location .chat-more-panel__icon-inner {
  width: 22px;
  height: 28px;
  border: 2px solid #5b5b5b;
  border-radius: 14px 14px 14px 2px;
  transform: rotate(-45deg);
}

.chat-more-panel__icon--location .chat-more-panel__icon-inner::after {
  top: 7px;
  left: 7px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #5b5b5b;
}

.chat-more-panel__icon--redPacket .chat-more-panel__icon-inner {
  width: 25px;
  height: 30px;
  border-radius: 6px;
  background: #5b5b5b;
}

.chat-more-panel__icon--redPacket .chat-more-panel__icon-inner::before {
  top: 10px;
  left: 0;
  width: 25px;
  height: 2px;
  background: #fcfcfc;
}

.chat-more-panel__icon--redPacket .chat-more-panel__icon-inner::after {
  top: 14px;
  left: 8px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #fcfcfc;
}

.chat-more-panel__icon--gift .chat-more-panel__icon-inner {
  width: 28px;
  height: 24px;
  border: 2px solid #5b5b5b;
  border-radius: 4px;
}

.chat-more-panel__icon--gift .chat-more-panel__icon-inner::before {
  top: -7px;
  left: 6px;
  width: 12px;
  height: 7px;
  border: 2px solid #5b5b5b;
  border-radius: 8px 8px 0 0;
}

.chat-more-panel__icon--gift .chat-more-panel__icon-inner::after {
  top: -2px;
  left: 11px;
  width: 2px;
  height: 26px;
  background: #5b5b5b;
}

.chat-more-panel__icon--transfer .chat-more-panel__icon-inner {
  width: 15px;
  height: 27px;
  transform: skew(-16deg);
}

.chat-more-panel__icon--transfer .chat-more-panel__icon-inner::before {
  top: 0;
  left: 5px;
  width: 8px;
  height: 15px;
  border-radius: 2px;
  background: #5b5b5b;
}

.chat-more-panel__icon--transfer .chat-more-panel__icon-inner::after {
  right: 4px;
  bottom: 0;
  width: 8px;
  height: 16px;
  border-radius: 2px;
  background: #5b5b5b;
}

</style>
