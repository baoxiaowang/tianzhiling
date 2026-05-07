<template>
  <page-scaffold
    class="customer-service-page"
    background="#efeff4"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
  >
    <template #header>
      <app-bar title="联系客服" background="#f6f6f6" />
    </template>

    <view class="customer-service">
      <view class="customer-service-card customer-service-card--qr">
        <text class="customer-service-card__title">添加客服：</text>
        <image
          class="customer-service-qr"
          :src="customerServiceQr"
          mode="aspectFill"
          show-menu-by-longpress
          @tap="handlePreviewQr"
          @longpress="handleSaveQr"
        />
        <text class="customer-service-card__hint">长按二维码保存至相册，使用微信扫一扫</text>
      </view>

      <view class="customer-service-card customer-service-card--phone">
        <view class="customer-service-phone__header">
          <text class="customer-service-card__title">客服热线：</text>
          <text class="customer-service-phone__time">工作时间：周一至周日 9:00--21:00</text>
        </view>

        <view class="customer-service-phone__panel">
          <text class="customer-service-phone__number">{{ customerServicePhone }}</text>
          <view class="customer-service-phone__button" @tap="handleCallCustomerService">
            立即拨打
          </view>
        </view>
      </view>
    </view>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'CustomerServicePage',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { buildOssMediaUrl } from '@tzl/shared'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'

const customerServicePhone = '18062525425'
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
.customer-service-page {
  min-height: 100vh;
}

.customer-service {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 40px 24px 48px;
  background: #efeff4;
}

.customer-service-card {
  width: 327px;
  box-sizing: border-box;
  border: 2px dashed #bdbdbd;
  border-radius: 12px;
  background: #f2f2f2;
}

.customer-service-card__title {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #3d3d3d;
}

.customer-service-card--qr {
  min-height: 326px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16px 20px 22px;
}

.customer-service-qr {
  align-self: center;
  width: 188px;
  height: 199px;
  margin-top: 23px;
  border-radius: 10px;
  overflow: hidden;
  background: #ffffff;
}

.customer-service-card__hint {
  align-self: center;
  margin-top: 26px;
  font-size: 12px;
  line-height: 32px;
  font-weight: 600;
  color: #8f8f8f;
}

.customer-service-card--phone {
  min-height: 159px;
  padding: 16px 20px 22px;
}

.customer-service-phone__header {
  display: flex;
  flex-direction: column;
}

.customer-service-phone__time {
  margin-top: 0;
  font-size: 14px;
  line-height: 24px;
  font-weight: 500;
  color: #333333;
}

.customer-service-phone__panel {
  height: 48px;
  margin-top: 17px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 11px 8px 12px;
  border-radius: 6px;
  background: #ededed;
}

.customer-service-phone__number {
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: #3d3d3d;
}

.customer-service-phone__button {
  width: 89px;
  height: 33px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50px;
  background: #3873ac;
  font-size: 14px;
  line-height: 24px;
  font-weight: 600;
  color: #ffffff;
}
</style>
