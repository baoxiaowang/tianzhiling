<template>
  <view class="back-capsule" :style="containerStyle">
    <view class="back-capsule__shell" :style="shellStyle">
      <view
        v-if="showBack"
        class="back-capsule__action back-capsule__action--back"
        @tap="handleBackTap"
      >
        <view class="back-capsule__back-icon" />
      </view>

      <template v-if="hasMenus">
        <view v-if="showBack" class="back-capsule__divider" />

        <view
          class="back-capsule__action back-capsule__action--menu"
          @tap.stop="handleMenuTap"
        >
          <slot name="menu-icon">
            <view class="back-capsule__menu-icon">
              <view class="back-capsule__menu-line" />
              <view class="back-capsule__menu-line" />
              <view class="back-capsule__menu-line" />
            </view>
          </slot>
        </view>
      </template>
    </view>

    <view
      v-if="showDropdown"
      class="back-capsule__mask"
      @tap="closeDropdown"
    />

    <view
      v-if="showDropdown"
      class="back-capsule__dropdown"
      @tap.stop
    >
      <view
        v-for="(menu, index) in props.menus"
        :key="menu.key || `${menu.text}-${index}`"
        class="back-capsule__dropdown-item"
        @tap="handleMenuSelect(menu, index)"
      >
        <text class="back-capsule__dropdown-text">{{ menu.text }}</text>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'BackCapsule',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { computed, getCurrentInstance, ref } from 'vue'
import { readMenuButtonMetrics } from '../../utils/menu-button'

export type BackCapsuleMenuOpenType =
  | 'navigateTo'
  | 'redirectTo'
  | 'reLaunch'
  | 'switchTab'
  | 'navigateBack'

export interface BackCapsuleMenuItem {
  key?: string
  text: string
  url?: string
  openType?: BackCapsuleMenuOpenType
  delta?: number
}

const props = withDefaults(
  defineProps<{
    menus?: ReadonlyArray<BackCapsuleMenuItem>
    backDelta?: number
    backHomeUrl?: string
    anchorToNative?: boolean
    showBack?: boolean
  }>(),
  {
    menus: () => [],
    backDelta: 1,
    backHomeUrl: '',
    anchorToNative: true,
    showBack: true,
  },
)

const emit = defineEmits<{
  back: []
  menuSelect: [payload: { item: BackCapsuleMenuItem; index: number }]
}>()

const instance = getCurrentInstance()
const showDropdown = ref(false)

const nativeMenuMetrics = readMenuButtonMetrics()

const hasMenus = computed(() => props.menus.length > 0)
const isSingleMenu = computed(() => props.menus.length === 1)
const showBack = computed(() => props.showBack)

const containerStyle = computed(() => {
  if (!props.anchorToNative) {
    return {}
  }

  return {
    position: 'absolute',
    top: `${nativeMenuMetrics.top}px`,
    left: `${nativeMenuMetrics.right}px`,
  }
})

const shellStyle = computed(() => {
  const backWidth = showBack.value ? Math.max(nativeMenuMetrics.height + 14, 44) : 0
  const menuWidth = hasMenus.value ? Math.max(nativeMenuMetrics.height + 16, 40) : 0
  const dividerWidth = showBack.value && hasMenus.value ? 1 : 0
  const totalWidth = backWidth + menuWidth + dividerWidth

  return {
    height: `${nativeMenuMetrics.height}px`,
    width: `${totalWidth}px`,
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

async function handleBackTap() {
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

function handleMenuTap() {
  if (!hasMenus.value) {
    return
  }

  if (isSingleMenu.value) {
    void handleMenuSelect(props.menus[0], 0)
    return
  }

  showDropdown.value = !showDropdown.value
}

function closeDropdown() {
  showDropdown.value = false
}

async function handleMenuSelect(item: BackCapsuleMenuItem, index: number) {
  closeDropdown()
  emit('menuSelect', { item, index })

  if (hasMenuSelectListener()) {
    return
  }

  await navigateWithMenuItem(item)
}

async function navigateWithMenuItem(item: BackCapsuleMenuItem) {
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
.back-capsule {
  position: relative;
  display: inline-flex;
  z-index: 30;
}

.back-capsule__shell {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 8px rgba(17, 17, 17, 0.04);
  overflow: hidden;
  backdrop-filter: blur(10px);
}

.back-capsule__action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
}

.back-capsule__action--back {
  padding: 0 12px 0 10px;
}

.back-capsule__action--menu {
  padding: 0 12px;
}

.back-capsule__divider {
  width: 1px;
  margin: 6px 0;
  background: rgba(0, 0, 0, 0.08);
}

.back-capsule__back-icon {
  width: 10px;
  height: 10px;
  margin-left: 2px;
  border-left: 2px solid #111111;
  border-bottom: 2px solid #111111;
  transform: rotate(45deg);
}

.back-capsule__menu-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 18px;
  height: 18px;
}

.back-capsule__menu-line {
  width: 16px;
  height: 2px;
  border-radius: 999px;
  background: #111111;
}

.back-capsule__mask {
  position: fixed;
  inset: 0;
  z-index: 19;
}

.back-capsule__dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  min-width: 132px;
  padding: 6px 0;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 8px 24px rgba(17, 17, 17, 0.08);
}

.back-capsule__dropdown-item {
  padding: 10px 14px;
}

.back-capsule__dropdown-item + .back-capsule__dropdown-item {
  border-top: 1px solid rgba(17, 17, 17, 0.04);
}

.back-capsule__dropdown-text {
  display: block;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
  color: #111111;
}
</style>
