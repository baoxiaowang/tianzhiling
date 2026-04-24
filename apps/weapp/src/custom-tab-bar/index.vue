<template>
  <view v-if="!hidden" class="custom-tab-bar" :style="rootStyle">
    <view
      v-for="(item, index) in items"
      :key="item.key"
      class="custom-tab-bar__item"
      :class="{ 'is-active': selected === index }"
      @tap="handleSwitch(item.pagePath)"
    >
      <view class="custom-tab-bar__icon" :class="`custom-tab-bar__icon--${item.key}`">
        <view class="custom-tab-bar__shape" />
      </view>
      <text class="custom-tab-bar__label">{{ item.text }}</text>
    </view>
  </view>
</template>

<script lang="ts">
import Taro from '@tarojs/taro'
import { createSafeAreaCssVars } from '../utils/safe-area'
import { CUSTOM_TAB_BAR_ITEMS } from '../utils/custom-tab-bar'

export default {
  name: 'CustomTabBar',
  options: {
    addGlobalClass: true,
  },
  data() {
    return {
      items: CUSTOM_TAB_BAR_ITEMS,
      selected: 0,
      hidden: false,
    }
  },
  computed: {
    rootStyle(): Record<string, string> {
      return createSafeAreaCssVars('custom-tab-bar-safe')
    },
  },
  methods: {
    setSelected(index: number) {
      this.selected = index
    },
    setHidden(hidden: boolean) {
      this.hidden = hidden
    },
    async handleSwitch(pagePath: string) {
      const currentItem = this.items[this.selected]

      if (currentItem?.pagePath === pagePath) {
        return
      }

      await Taro.switchTab({
        url: pagePath,
      })
    },
  },
}
</script>

<style lang="scss">
.custom-tab-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 100;
  display: flex;
  padding: 8px 10px calc(var(--custom-tab-bar-safe-bottom, env(safe-area-inset-bottom)) + 8px);
  border-top: 1px solid rgba(17, 24, 39, 0.06);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(14px);
}

.custom-tab-bar__item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding-top: 6px;
  color: $tzl-color-tab-muted;
}

.custom-tab-bar__item.is-active {
  color: $tzl-color-success;
}

.custom-tab-bar__label {
  font-size: 12px;
  font-weight: 600;
}

.custom-tab-bar__icon {
  position: relative;
  width: 28px;
  height: 28px;
}

.custom-tab-bar__shape {
  position: absolute;
  inset: 0;
}

.custom-tab-bar__icon--moments .custom-tab-bar__shape {
  border-radius: 50%;
  border: 1.5px solid currentColor;
}

.custom-tab-bar__item.is-active .custom-tab-bar__icon--moments .custom-tab-bar__shape {
  border: none;
  background: $tzl-gradient-success;
}

.custom-tab-bar__icon--moments .custom-tab-bar__shape::after {
  content: '';
  position: absolute;
  left: 8px;
  top: 8px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
}

.custom-tab-bar__item.is-active .custom-tab-bar__icon--moments .custom-tab-bar__shape::after {
  background: $tzl-color-surface-base;
}

.custom-tab-bar__icon--contacts .custom-tab-bar__shape::before,
.custom-tab-bar__icon--contacts .custom-tab-bar__shape::after {
  content: '';
  position: absolute;
  left: 5px;
  right: 5px;
  height: 5px;
  border-radius: 999px;
  border: 1.5px solid currentColor;
}

.custom-tab-bar__icon--contacts .custom-tab-bar__shape::before {
  top: 5px;
}

.custom-tab-bar__icon--contacts .custom-tab-bar__shape::after {
  bottom: 5px;
}

.custom-tab-bar__icon--me .custom-tab-bar__shape::before,
.custom-tab-bar__icon--me .custom-tab-bar__shape::after {
  content: '';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.custom-tab-bar__icon--me .custom-tab-bar__shape::before {
  top: 4px;
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
}

.custom-tab-bar__icon--me .custom-tab-bar__shape::after {
  bottom: 3px;
  width: 18px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-top-left-radius: 12px;
  border-top-right-radius: 12px;
  border-bottom: none;
}
</style>
