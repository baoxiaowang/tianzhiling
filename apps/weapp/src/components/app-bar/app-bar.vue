<template>
  <view class="app-bar" :style="rootStyle">
    <back-capsule
      v-if="showCapsule"
      class="app-bar__capsule"
      :menus="menus"
      :back-delta="backDelta"
      :back-home-url="backHomeUrl"
      :show-back="showBack"
      @back="handleBack"
      @menu-select="handleMenuSelect"
    >
      <template v-if="hasCapsuleMenu" #menu-icon>
        <slot name="capsule-menu" />
      </template>
    </back-capsule>

    <view v-if="hasLeft" class="app-bar__left" :style="leftStyle">
      <slot name="left" />
    </view>

    <view class="app-bar__content" :style="contentStyle">
      <text class="app-bar__title">{{ title }}</text>
    </view>

    <view v-if="hasRight" class="app-bar__right" :style="rightStyle">
      <slot name="right" />
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'AppBar',
}
</script>

<script setup lang="ts">
import { computed, useSlots } from 'vue'
import BackCapsule from '../back-capsule/back-capsule.vue'
import { readMenuButtonMetrics } from '../../utils/menu-button'

const emit = defineEmits<{
  back: []
  menuSelect: [payload: { item: { key?: string; text: string; url?: string; openType?: string; delta?: number }; index: number }]
}>()

const props = withDefaults(
  defineProps<{
    title: string
    background?: string
    borderColor?: string
    menus?: ReadonlyArray<{
      key?: string
      text: string
      url?: string
      openType?: 'navigateTo' | 'redirectTo' | 'reLaunch' | 'switchTab' | 'navigateBack'
      delta?: number
    }>
    backDelta?: number
    backHomeUrl?: string
    showCapsule?: boolean
    showBack?: boolean
  }>(),
  {
    background: '#ffffff',
    borderColor: '',
    menus: () => [],
    backDelta: 1,
    backHomeUrl: '',
    showCapsule: true,
    showBack: true,
  },
)

const slots = useSlots()
const menuButtonMetrics = readMenuButtonMetrics()

const hasLeft = computed(() => Boolean(slots.left))
const hasRight = computed(() => Boolean(slots.right))
const hasCapsuleMenu = computed(() => Boolean(slots['capsule-menu']))

const rootStyle = computed(() => {
  const borderBottom = props.borderColor
    ? `0.5px solid ${props.borderColor}`
    : 'none'

  return {
    height: `${menuButtonMetrics.totalHeight}px`,
    paddingTop: `${menuButtonMetrics.statusBarHeight}px`,
    background: props.background,
    borderBottom,
  }
})

const contentStyle = computed(() => {
  return {
    height: `${menuButtonMetrics.navBarHeight}px`,
  }
})

const rightStyle = computed(() => {
  return {
    top: `${menuButtonMetrics.statusBarHeight + menuButtonMetrics.navBarHeight / 2}px`,
  }
})

const leftStyle = computed(() => {
  return {
    top: `${menuButtonMetrics.statusBarHeight + menuButtonMetrics.navBarHeight / 2}px`,
  }
})

function handleBack() {
  emit('back')
}

function handleMenuSelect(payload: { item: { key?: string; text: string; url?: string; openType?: string; delta?: number }; index: number }) {
  emit('menuSelect', payload)
}
</script>

<style lang="scss">
.app-bar {
  position: relative;
  box-sizing: border-box;
}

.app-bar__capsule {
  position: absolute;
  z-index: 2;
}

.app-bar__content {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 84px;
  box-sizing: border-box;
}

.app-bar__title {
  min-width: 0;
  max-width: 100%;
  text-align: center;
  font-size: 18px;
  line-height: 28px;
  font-weight: 600;
  color: #111111;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-bar__left {
  position: absolute;
  left: 16px;
  z-index: 2;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.app-bar__right {
  position: absolute;
  right: 16px;
  z-index: 2;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
