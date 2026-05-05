<template>
  <view v-if="!hidden" class="custom-tab-bar" :style="rootStyle">
    <view
      v-for="(item, index) in items"
      :key="item.key"
      class="custom-tab-bar__item"
      :class="{ 'is-active': selected === index }"
      @tap="handleSwitch(item.pagePath)"
    >
      <image
        class="custom-tab-bar__icon"
        :src="selected === index ? item.activeIcon : item.icon"
        mode="aspectFit"
      />
      <text class="custom-tab-bar__label">{{ item.text }}</text>
    </view>
  </view>
</template>

<script lang="ts">
import Taro from '@tarojs/taro'
import { createSafeAreaCssVars } from '../utils/safe-area'
import { CUSTOM_TAB_BAR_ITEMS } from '../utils/custom-tab-bar'

function resolveCurrentSelectedIndex() {
  const routePath = Taro.getCurrentInstance().router?.path ?? ''
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`
  const selectedIndex = CUSTOM_TAB_BAR_ITEMS.findIndex((item) => item.pagePath === normalizedPath)

  return selectedIndex >= 0 ? selectedIndex : 0
}

export default {
  name: 'CustomTabBar',
  options: {
    addGlobalClass: true,
  },
  data() {
    return {
      items: CUSTOM_TAB_BAR_ITEMS,
      selected: resolveCurrentSelectedIndex(),
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
  color: $tzl-color-primary;
}

.custom-tab-bar__label {
  font-size: 12px;
  font-weight: 600;
}

.custom-tab-bar__icon {
  width: 30px;
  height: 30px;
  display: block;
}
</style>
