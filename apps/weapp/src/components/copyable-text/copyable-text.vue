<template>
  <view class="copyable-text" @tap="handleCopy">
    <text class="copyable-text__content" :class="contentClass">
      {{ displayText }}
    </text>
    <view class="copyable-text__icon" aria-label="复制">
      <view class="copyable-text__icon-back" />
      <view class="copyable-text__icon-front" />
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'CopyableText',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    text?: string
    emptyText?: string
    successText?: string
    failText?: string
    contentClass?: string
  }>(),
  {
    text: '',
    emptyText: '-',
    successText: '已复制',
    failText: '复制失败，请稍后重试',
    contentClass: '',
  },
)

const normalizedText = computed(() => props.text.trim())
const displayText = computed(() => normalizedText.value || props.emptyText)

async function handleCopy() {
  if (!normalizedText.value) {
    return
  }

  try {
    await Taro.setClipboardData({
      data: normalizedText.value,
    })
    await Taro.showToast({
      title: props.successText,
      icon: 'success',
      duration: 1200,
    })
  } catch {
    await Taro.showToast({
      title: props.failText,
      icon: 'none',
      duration: 1600,
    })
  }
}
</script>

<style lang="scss">
.copyable-text {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.copyable-text__content {
  min-width: 0;
  flex: 1;
  color: #3d3d3d;
  font-size: 14px;
  line-height: 24px;
  word-break: break-all;
}

.copyable-text__icon {
  position: relative;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: #999999;
}

.copyable-text__icon-back,
.copyable-text__icon-front {
  position: absolute;
  box-sizing: border-box;
  width: 10px;
  height: 12px;
  border: 1.4px solid currentColor;
  border-radius: 2px;
  background: #ffffff;
}

.copyable-text__icon-back {
  top: 1px;
  left: 2px;
  opacity: 0.72;
}

.copyable-text__icon-front {
  right: 2px;
  bottom: 1px;
}
</style>
