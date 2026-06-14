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

    <view class="vip-member-view__section vip-member-view__section--service">
      <view class="vip-member-view__divider">
        <view class="vip-member-view__divider-line" />
        <text class="vip-member-view__divider-text">联系客服</text>
        <view class="vip-member-view__divider-line vip-member-view__divider-line--right" />
      </view>

      <view class="vip-member-view__service-card vip-member-view__service-card--qr">
        <text class="vip-member-view__service-title">添加客服：</text>
        <image
          class="vip-member-view__service-qr"
          :src="customerServiceQr"
          mode="aspectFill"
          show-menu-by-longpress
          @tap="handlePreviewQr"
          @longpress="handleSaveQr"
        />
        <text class="vip-member-view__service-hint">
          长按二维码保存至相册，使用微信扫一扫
        </text>
      </view>

      <view class="vip-member-view__service-card vip-member-view__service-card--phone">
        <view class="vip-member-view__service-phone-header">
          <text class="vip-member-view__service-title">客服热线：</text>
          <text class="vip-member-view__service-time">
            工作时间：周一至周日 9:00--21:00
          </text>
        </view>

        <view class="vip-member-view__service-phone-panel">
          <text class="vip-member-view__service-phone-number">
            {{ customerServicePhone }}
          </text>
          <view
            class="vip-member-view__service-phone-button"
            @tap="handleCallCustomerService"
          >
            立即拨打
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { StarFill } from '@nutui/icons-vue-taro'
import Taro from '@tarojs/taro'
import { buildOssMediaUrl } from '@tzl/shared'

defineProps<{
  planName: string
  periodText: string
  benefitsImageUrl: string
  thanksLines: string[]
}>()

const customerServicePhone = '19986943631'
const customerServiceQr = buildOssMediaUrl('/weapp/service.png')

async function handleCallCustomerService() {
  try {
    await Taro.makePhoneCall({
      phoneNumber: customerServicePhone,
    })
  } catch {
  }
}

function handlePreviewQr() {
  void Taro.previewImage({
    urls: [customerServiceQr],
    current: customerServiceQr,
  })
}

async function handleSaveQr() {
  try {
    const imageInfo = await Taro.getImageInfo({
      src: customerServiceQr,
    })

    await Taro.saveImageToPhotosAlbum({
      filePath: imageInfo.path,
    })
    await Taro.showToast({
      title: '已保存到相册',
      icon: 'success',
    })
  } catch {
    await Taro.showToast({
      title: '可通过图片菜单保存',
      icon: 'none',
    })
  }
}
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

.vip-member-view__section--service {
  padding-top: 24px;
}

.vip-member-view__service-card {
  width: 327px;
  max-width: 100%;
  box-sizing: border-box;
  margin: 16px auto 0;
  border: 2px dashed #bdbdbd;
  border-radius: 12px;
  background: #f2f2f2;
}

.vip-member-view__service-title {
  color: #3d3d3d;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.vip-member-view__service-card--qr {
  min-height: 326px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16px 20px 22px;
}

.vip-member-view__service-qr {
  align-self: center;
  width: 188px;
  height: 199px;
  margin-top: 23px;
  border-radius: 10px;
  overflow: hidden;
  background: #ffffff;
}

.vip-member-view__service-hint {
  align-self: center;
  margin-top: 26px;
  color: #8f8f8f;
  font-size: 12px;
  line-height: 32px;
  font-weight: 600;
}

.vip-member-view__service-card--phone {
  min-height: 159px;
  padding: 16px 20px 22px;
}

.vip-member-view__service-phone-header {
  display: flex;
  flex-direction: column;
}

.vip-member-view__service-time {
  margin-top: 0;
  color: #333333;
  font-size: 14px;
  line-height: 24px;
  font-weight: 500;
}

.vip-member-view__service-phone-panel {
  height: 48px;
  margin-top: 17px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 11px 8px 12px;
  border-radius: 6px;
  background: #ededed;
  box-sizing: border-box;
}

.vip-member-view__service-phone-number {
  color: #3d3d3d;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.vip-member-view__service-phone-button {
  padding: 5px 12px;
  border-radius: 999px;
  color: #ffffff;
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
  background: #111111;
}
</style>
