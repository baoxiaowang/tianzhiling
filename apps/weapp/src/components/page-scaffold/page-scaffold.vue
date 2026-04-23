<template>
  <view class="page-scaffold" :style="rootStyle">
    <view
      v-if="hasHeader"
      class="page-scaffold__header"
      :class="{ 'page-scaffold__header--safe-top': safeAreaTop }"
    >
      <slot name="header" />
    </view>

    <scroll-view
      v-if="scroll"
      scroll-y
      class="page-scaffold__body page-scaffold__body--scroll"
      :style="bodyStyle"
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
    >
      <slot name="bottom" />
    </view>

    <view v-if="hasFloating" class="page-scaffold__floating">
      <slot name="floating" />
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

const props = withDefaults(
  defineProps<{
    background?: string
    bodyPadding?: string
    scroll?: boolean
    safeAreaTop?: boolean
    safeAreaBottom?: boolean
  }>(),
  {
    background: 'transparent',
    bodyPadding: '0',
    scroll: false,
    safeAreaTop: false,
    safeAreaBottom: true,
  },
)

const slots = useSlots()

const hasHeader = computed(() => Boolean(slots.header))
const hasBottom = computed(() => Boolean(slots.bottom))
const hasFloating = computed(() => Boolean(slots.floating))

const rootStyle = computed(() => {
  return {
    background: props.background,
  }
})

const bodyStyle = computed(() => {
  return {
    padding: props.bodyPadding,
  }
})
</script>

<style lang="scss">
.page-scaffold {
  position: relative;
  max-height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-scaffold__header {
  flex-shrink: 0;
}

.page-scaffold__header--safe-top {
  padding-top: env(safe-area-inset-top);
}

.page-scaffold__body {
  flex: 1;
  min-height: 0;
  box-sizing: border-box;
}

.page-scaffold__body--scroll {
  height: 100vh;
}

.page-scaffold__body--safe-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}

.page-scaffold__bottom {
  position: relative;
  z-index: 10;
  flex-shrink: 0;
}

.page-scaffold__bottom--safe-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}

.page-scaffold__floating {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
}

.page-scaffold__floating :deep(*) {
  pointer-events: auto;
}
</style>
