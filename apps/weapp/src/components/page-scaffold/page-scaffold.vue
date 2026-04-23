<template>
  <view class="page-scaffold" :style="rootStyle">
    <view
      v-if="hasHeader"
      class="page-scaffold__header"
      :class="{ 'page-scaffold__header--safe-top': safeAreaTop }"
      :style="headerStyle"
    >
      <slot name="header" />
    </view>

    <scroll-view
      v-if="scroll"
      :scroll-y="true"
      class="page-scaffold__body page-scaffold__body--scroll"
      :style="bodyStyle"
      :scroll-into-view="scrollIntoView"
      :scroll-with-animation="scrollWithAnimation"
      :show-scrollbar="showScrollbar"
    >
      <slot />
    </scroll-view>

    <view
      v-else
      class="page-scaffold__body"
      :class="{ 'page-scaffold__body--safe-bottom': safeAreaBottom && !hasBottom }"
      :style="bodyStyle"
    >
      <slot />
    </view>

    <view
      v-if="hasBottom"
      class="page-scaffold__bottom"
      :class="{ 'page-scaffold__bottom--safe-bottom': safeAreaBottom }"
      :style="bottomStyle"
    >
      <slot name="bottom" />
    </view>

    <view
      v-if="hasFloating"
      class="page-scaffold__floating"
      :class="{ 'page-scaffold__floating--safe-bottom': safeAreaBottom && !hasBottom }"
    >
      <view class="page-scaffold__floating-content">
        <slot name="floating" />
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'PageScaffold',
}
</script>

<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { createSafeAreaCssVars } from '../../utils/safe-area'

const props = withDefaults(
  defineProps<{
    background?: string
    headerBackground?: string
    bottomBackground?: string
    bodyPadding?: string
    scroll?: boolean
    scrollIntoView?: string
    scrollWithAnimation?: boolean
    showScrollbar?: boolean
    safeAreaTop?: boolean
    safeAreaBottom?: boolean
  }>(),
  {
    background: 'transparent',
    headerBackground: '',
    bottomBackground: '',
    bodyPadding: '0',
    scroll: false,
    scrollIntoView: '',
    scrollWithAnimation: false,
    showScrollbar: true,
    safeAreaTop: true,
    safeAreaBottom: true,
  },
)

const slots = useSlots()

const hasHeader = computed(() => Boolean(slots.header))
const hasBottom = computed(() => Boolean(slots.bottom))
const hasFloating = computed(() => Boolean(slots.floating))

const resolveSectionBackground = (background: string | undefined) => {
  return background && background.trim() ? background : props.background
}

const expandPadding = (padding: string): [string, string, string, string] => {
  const values = padding.trim().split(/\s+/).filter(Boolean)

  if (values.length === 0) {
    return ['0', '0', '0', '0']
  }

  if (values.length === 1) {
    return [values[0], values[0], values[0], values[0]]
  }

  if (values.length === 2) {
    return [values[0], values[1], values[0], values[1]]
  }

  if (values.length === 3) {
    return [values[0], values[1], values[2], values[1]]
  }

  return [values[0], values[1], values[2], values[3]]
}

const rootStyle = computed(() => {
  return {
    background: props.background,
    ...createSafeAreaCssVars('page-scaffold-safe'),
  }
})

const headerStyle = computed(() => {
  return {
    background: resolveSectionBackground(props.headerBackground),
  }
})

const bottomStyle = computed(() => {
  return {
    background: resolveSectionBackground(props.bottomBackground),
  }
})

const bodyStyle = computed(() => {
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = expandPadding(props.bodyPadding)

  return {
    paddingTop,
    paddingRight,
    paddingBottom:
      props.safeAreaBottom && !hasBottom.value
        ? `calc(${paddingBottom} + var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom)))`
        : paddingBottom,
    paddingLeft,
  }
})
</script>

<style lang="scss">
.page-scaffold {
  position: relative;
  height: 100vh;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-scaffold__header {
  flex-shrink: 0;
}

.page-scaffold__header--safe-top {
  padding-top: constant(safe-area-inset-top);
  padding-top: env(safe-area-inset-top);
  padding-top: var(--page-scaffold-safe-top, env(safe-area-inset-top));
}

.page-scaffold__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.page-scaffold__body--scroll {
  flex: 1;
  min-height: 0;
}

.page-scaffold__body > * {
  min-height: 0;
}

.page-scaffold__body--safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom));
}

.page-scaffold__bottom {
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.page-scaffold__bottom--safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom));
}

.page-scaffold__floating {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
}

.page-scaffold__floating--safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  padding-bottom: var(--page-scaffold-safe-bottom, env(safe-area-inset-bottom));
}

.page-scaffold__floating-content {
  pointer-events: auto;
}
</style>
