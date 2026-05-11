<template>
  <view class="vip-member-view">
    <view class="vip-member-view__hero">
      <view class="vip-member-view__badge">
        <StarFill size="14" color="#ffffff" />
        <text>VIP会员</text>
      </view>
      <text class="vip-member-view__title">{{ planName }}</text>
      <text class="vip-member-view__subtitle">{{ periodText }}</text>
    </view>

    <view class="vip-member-view__section vip-member-view__section--benefits-image">
      <image class="vip-member-view__benefits-image" :src="benefitsImageUrl" mode="widthFix" />
    </view>

    <view class="vip-member-view__section vip-member-view__section--thanks">
      <view class="vip-member-view__divider">
        <view class="vip-member-view__divider-line" />
        <text class="vip-member-view__divider-text">特别鸣谢</text>
        <view class="vip-member-view__divider-line vip-member-view__divider-line--right" />
      </view>
      <view class="vip-member-view__thanks vip-member-view__thanks--lines">
        <text
          v-for="line in thanksLines"
          :key="line"
          class="vip-member-view__thanks-line"
        >
          {{ line }}
        </text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { StarFill } from '@nutui/icons-vue-taro'

defineProps<{
  planName: string
  periodText: string
  benefitsImageUrl: string
  thanksLines: string[]
}>()
</script>

<style lang="scss">
.vip-member-view {
  padding: 16px 16px 32px;
}

.vip-member-view__hero {
  padding: 22px 18px;
  border-radius: 16px;
  background: linear-gradient(135deg, #3b2113 0%, #8e5935 55%, #efc17e 100%);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vip-member-view__badge {
  align-self: flex-start;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  line-height: 18px;
  font-weight: 600;
}

.vip-member-view__title {
  margin-top: 4px;
  color: #ffffff;
  font-size: 24px;
  line-height: 32px;
  font-weight: 700;
}

.vip-member-view__subtitle {
  color: rgba(255, 255, 255, 0.78);
  font-size: 13px;
  line-height: 20px;
}

.vip-member-view__section {
  padding-top: 18px;
}

.vip-member-view__section--benefits-image {
  display: flex;
  justify-content: center;
}

.vip-member-view__benefits-image {
  display: block;
  width: 100%;
}

.vip-member-view__section--thanks {
  padding-top: 24px;
}

.vip-member-view__divider {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vip-member-view__divider-line {
  flex: 1;
  height: 3px;
  background: linear-gradient(90deg, rgba(255, 111, 3, 0) 0%, #ff6f03 100%);
}

.vip-member-view__divider-line--right {
  transform: rotate(180deg);
}

.vip-member-view__divider-text {
  color: #3d3d3d;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}

.vip-member-view__thanks {
  margin-top: 14px;
  display: block;
  color: #666666;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}

.vip-member-view__thanks--lines {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 18px;
}

.vip-member-view__thanks-line {
  display: block;
  color: inherit;
  font-size: inherit;
  line-height: 18px;
  font-weight: 500;
}
</style>
