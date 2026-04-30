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
import Taro from '@tarojs/taro'
import { computed, getCurrentInstance, useSlots } from 'vue'
import BackCapsule from '../back-capsule/back-capsule.vue'
import { readMenuButtonMetrics } from '../../utils/menu-button'

type AppBarMenuOpenType = 'navigateTo' | 'redirectTo' | 'reLaunch' | 'switchTab' | 'navigateBack'

interface AppBarMenuItem {
  key?: string
  text: string
  url?: string
  openType?: AppBarMenuOpenType
  delta?: number
}

const emit = defineEmits<{
  back: []
  menuSelect: [payload: { item: AppBarMenuItem; index: number }]
}>()

const props = withDefaults(
  defineProps<{
    title: string
    background?: string
    borderColor?: string
    menus?: ReadonlyArray<AppBarMenuItem>
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

const instance = getCurrentInstance()
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

function hasEventListener(listener: unknown) {
  if (Array.isArray(listener)) {
    return listener.length > 0
  }

  return typeof listener === 'function'
}

function hasBackListener() {
  return hasEventListener(instance?.vnode.props?.onBack)
}

function hasMenuSelectListener() {
  return hasEventListener(instance?.vnode.props?.onMenuSelect)
}

async function handleBack() {
  emit('back')

  if (hasBackListener()) {
    return
  }

  try {
    await Taro.navigateBack({
      delta: props.backDelta,
    })
  } catch {
    if (!props.backHomeUrl) {
      return
    }

    await Taro.reLaunch({
      url: props.backHomeUrl,
    })
  }
}

async function handleMenuSelect(payload: { item: AppBarMenuItem; index: number }) {
  emit('menuSelect', payload)

  if (hasMenuSelectListener()) {
    return
  }

  await navigateWithMenuItem(payload.item)
}

async function navigateWithMenuItem(item: AppBarMenuItem) {
  const openType = item.openType ?? 'navigateTo'

  if (openType === 'navigateBack') {
    await Taro.navigateBack({
      delta: item.delta ?? 1,
    })
    return
  }

  if (!item.url) {
    return
  }

  switch (openType) {
    case 'redirectTo':
      await Taro.redirectTo({ url: item.url })
      return
    case 'reLaunch':
      await Taro.reLaunch({ url: item.url })
      return
    case 'switchTab':
      await Taro.switchTab({ url: item.url })
      return
    default:
      await Taro.navigateTo({ url: item.url })
  }
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
