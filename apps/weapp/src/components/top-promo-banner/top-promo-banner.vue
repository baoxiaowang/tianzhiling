<template>
  <swiper
    class="top-promo-banner"
    :indicator-dots="banners.length > 1"
    :autoplay="banners.length > 1"
    :circular="banners.length > 1"
  >
    <swiper-item
      v-for="banner in banners"
      :key="banner.id"
      class="top-promo-banner__item"
    >
      <image
        class="top-promo-banner__image"
        :src="banner.imageUrl"
        mode="aspectFill"
      />
    </swiper-item>
  </swiper>
</template>

<script lang="ts">
export default {
  name: 'TopPromoBanner',
}
</script>

<script setup lang="ts">
import { buildOssMediaUrl } from '@tzl/shared'

interface PromoBannerItem {
  id: string
  imageUrl: string
}

withDefaults(defineProps<{
  banners?: readonly PromoBannerItem[]
}>(), {
  banners: () => [
    {
      id: 'voice-clone',
      imageUrl: buildOssMediaUrl('/weapp/Banner.png'),
    },
  ],
})
</script>

<style lang="scss">
.top-promo-banner {
  height: 220px;
  overflow: hidden;
  background: #f8fafc;
}

.top-promo-banner__item,
.top-promo-banner__image {
  width: 100%;
  height: 220px;
}

.top-promo-banner__image {
  display: block;
}
</style>
