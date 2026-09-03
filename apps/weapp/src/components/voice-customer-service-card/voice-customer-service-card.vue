<template>
  <view class="voice-customer-service-card">
    <view class="voice-customer-service-card__copy">
      <text class="voice-customer-service-card__title">添加客服：</text>
      <text class="voice-customer-service-card__subtitle">
        {{ props.subtitle }}
      </text>
    </view>

    <view class="voice-customer-service-card__qr-wrap">
      <image
        class="voice-customer-service-card__qr"
        :src="customerServiceQr"
        mode="aspectFill"
        show-menu-by-longpress
        @tap="handlePreviewQr"
        @longpress="handleSaveQr"
      />
    </view>

    <text class="voice-customer-service-card__hint">
      长按二维码保存至相册，使用微信扫一扫
    </text>
  </view>
</template>

<script lang="ts">
export default {
  name: 'VoiceCustomerServiceCard',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { buildOssMediaUrl } from '@tzl/shared'
import { brand } from '../../config/brand'

const props = withDefaults(
  defineProps<{
    subtitle?: string
  }>(),
  {
    subtitle: '支付后，可添加客服微信，进行声音定制',
  },
)
const customerServiceQr = buildOssMediaUrl(brand.customerService.wechatQr)

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
.voice-customer-service-card {
  box-sizing: border-box;
  width: 100%;
  height: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16px 20px 10px;
  border: 2px dashed #ffd56a;
  border-radius: 12px;
  background: #fffbe2;
}

.voice-customer-service-card__copy {
  width: 100%;
}

.voice-customer-service-card__title,
.voice-customer-service-card__subtitle {
  display: block;
}

.voice-customer-service-card__title {
  color: #3d3d3d;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.voice-customer-service-card__subtitle {
  margin-top: 0;
  color: #333333;
  font-size: 14px;
  line-height: 24px;
  font-weight: 500;
}

.voice-customer-service-card__qr-wrap {
  align-self: center;
  box-sizing: border-box;
  width: 200px;
  height: 200px;
  margin-top: 13px;
  overflow: hidden;
  border: 2px dashed #ffd56a;
  border-radius: 12px;
  background: #ffffff;
}

.voice-customer-service-card__qr {
  display: block;
  width: 100%;
  height: 100%;
}

.voice-customer-service-card__hint {
  align-self: center;
  margin-top: 5px;
  color: #666666;
  font-size: 14px;
  line-height: 32px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}
</style>
