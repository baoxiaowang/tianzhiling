<template>
  <page-scaffold
    class="post-create-page"
    background="#ffffff"
    bottom-background="#ffffff"
    body-padding="0"
    :safe-area-top="false"
  >
    <view class="post-create-status" :style="statusStyle" />

    <view class="post-create-nav">
      <view class="post-create-nav__cancel" @tap="handleCancel">取消</view>
    </view>

    <view class="post-create-editor">
      <textarea
        class="post-create-textarea"
        :value="content"
        placeholder="有什么话想与Ta说..."
        placeholder-class="post-create-textarea__placeholder"
        maxlength="500"
        @input="handleContentInput"
      />

      <view v-if="images.length" class="post-create-images">
        <view
          v-for="(image, index) in images"
          :key="`${image}-${index}`"
          class="post-create-image-wrap"
        >
          <image class="post-create-image" :src="image" mode="aspectFill" />
          <view class="post-create-image-delete" @tap="handleRemoveImage(index)">×</view>
        </view>
        <view
          v-if="images.length < maxImageCount"
          class="post-create-add"
          @tap="handleChooseImages"
        >
          <image class="post-create-add__icon" :src="addIconUrl" mode="aspectFit" />
        </view>
      </view>

      <view v-else class="post-create-add" @tap="handleChooseImages">
        <image class="post-create-add__icon" :src="addIconUrl" mode="aspectFit" />
      </view>
    </view>

    <view class="post-create-options">
      <view class="post-create-option" @tap="handleLocationTap">
        <view class="post-create-option__main">
          <image class="post-create-option__icon" :src="locationIconUrl" mode="aspectFit" />
          <text class="post-create-option__label">所在位置</text>
        </view>
        <image class="post-create-option__chevron" :src="chevronIconUrl" mode="aspectFit" />
      </view>

      <view class="post-create-option" @tap="handleRemindTap">
        <view class="post-create-option__main">
          <image class="post-create-option__icon" :src="atIconUrl" mode="aspectFit" />
          <text class="post-create-option__label">选择天之灵</text>
        </view>
        <image class="post-create-option__chevron" :src="chevronIconUrl" mode="aspectFit" />
      </view>
    </view>

    <template #bottom>
      <view class="post-create-bottom">
        <view
          class="post-create-bottom__publish"
          :class="{ 'post-create-bottom__publish--active': canSubmit && !isSubmitting && !isUploading }"
          @tap="handleSubmit"
        >
          {{ isSubmitting ? '发布中' : '发布' }}
        </view>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'PostCreatePage',
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Taro, { useDidShow } from '@tarojs/taro'
import { createPost } from '../../apis/post'
import { uploadLocalImage } from '../../apis/storage'
import { ApiException } from '../../api/api-exception'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'
import { readMenuButtonMetrics } from '../../utils/menu-button'

const addIconUrl = 'https://www.figma.com/api/mcp/asset/cd382b2c-ff69-4439-9d69-fe161ceaaaba'
const locationIconUrl = 'https://www.figma.com/api/mcp/asset/edd3adcb-ae7f-4aa5-a878-782cec9c5527'
const atIconUrl = 'https://www.figma.com/api/mcp/asset/f8e0bf12-b0e2-439f-925e-0b1079b589c1'
const chevronIconUrl = 'https://www.figma.com/api/mcp/asset/8282532d-5461-450c-9288-bb6e6d9d8a2c'

const maxImageCount = 9
const content = ref('')
const images = ref<string[]>([])
const isUploading = ref(false)
const isSubmitting = ref(false)
const menuButtonMetrics = readMenuButtonMetrics()
const statusStyle = {
  height: `${menuButtonMetrics.statusBarHeight}px`,
}

const canSubmit = computed(() => {
  return content.value.trim().length > 0 || images.value.length > 0
})

function showToast(title: string) {
  void Taro.showToast({
    title,
    icon: 'none',
    duration: 1800,
  })
}

function isChooseImageCancel(error: unknown) {
  if (!error || typeof error !== 'object' || !('errMsg' in error)) {
    return false
  }

  return String(error.errMsg).toLowerCase().includes('cancel')
}

function handleContentInput(event: { detail?: { value?: string } }) {
  content.value = event.detail?.value ?? ''
}

async function handleCancel() {
  await Taro.navigateBack()
}

function handleLocationTap() {
  showToast('所在位置待接入')
}

function handleRemindTap() {
  showToast('选择天之灵待接入')
}

async function handleChooseImages() {
  if (isUploading.value || images.value.length >= maxImageCount) {
    return
  }

  try {
    const remainingCount = maxImageCount - images.value.length
    const result = await Taro.chooseImage({
      count: remainingCount,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
    })

    const filePaths = result.tempFilePaths.filter(Boolean)
    if (!filePaths.length) {
      return
    }

    isUploading.value = true
    const uploads = await Promise.all(
      filePaths.map((filePath) => {
        return uploadLocalImage(filePath, {
          folder: 'moments',
        })
      }),
    )

    images.value = [
      ...images.value,
      ...uploads.map((item) => item.publicUrl).filter(Boolean),
    ].slice(0, maxImageCount)
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuthPage()
      return
    }

    if (isChooseImageCancel(error)) {
      return
    }

    showToast(error instanceof ApiException ? error.message : '图片上传失败，请稍后重试')
  } finally {
    isUploading.value = false
  }
}

function handleRemoveImage(index: number) {
  if (isSubmitting.value || isUploading.value) {
    return
  }

  images.value = images.value.filter((_, imageIndex) => imageIndex !== index)
}

async function handleSubmit() {
  if (!canSubmit.value || isSubmitting.value || isUploading.value) {
    return
  }

  isSubmitting.value = true

  try {
    await createPost({
      content: content.value.trim(),
      images: images.value,
    })

    await Taro.showToast({
      title: '已发布',
      icon: 'success',
      duration: 1200,
    })
    await Taro.navigateBack()
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuthPage()
      return
    }

    showToast(error instanceof ApiException ? error.message : '发布失败，请稍后重试')
  } finally {
    isSubmitting.value = false
  }
}

useDidShow(() => {
  void ensureAuthenticatedSession().then((authenticated) => {
    if (!authenticated) {
      void redirectToAuthPage()
    }
  })
})
</script>

<style lang="scss">
.post-create-page {
  min-height: 100vh;
  box-sizing: border-box;
  background: #ffffff;
}

.post-create-status {
  background: #ffffff;
}

.post-create-nav {
  height: 44px;
  padding: 0 16px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  background: #ffffff;
}

.post-create-nav__cancel {
  color: #595959;
  font-size: 17px;
  line-height: 26px;
  font-weight: 400;
}

.post-create-editor {
  padding: 16px 24px 0;
  box-sizing: border-box;
  background: #ffffff;
}

.post-create-textarea {
  width: 100%;
  height: 100px;
  color: #1a1a1a;
  font-size: 17px;
  line-height: 25px;
  font-weight: 400;
}

.post-create-textarea__placeholder {
  color: #8c8c8c;
}

.post-create-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 26px;
}

.post-create-image-wrap,
.post-create-add {
  position: relative;
  width: 120px;
  height: 120px;
  overflow: hidden;
  border-radius: 3px;
  background: #f7f7f7;
}

.post-create-image {
  width: 100%;
  height: 100%;
}

.post-create-image-delete {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.72);
  color: #ffffff;
  font-size: 18px;
  line-height: 22px;
  text-align: center;
}

.post-create-add {
  margin-top: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.post-create-images .post-create-add {
  margin-top: 0;
}

.post-create-add__icon {
  width: 40px;
  height: 40px;
}

.post-create-options {
  margin: 44px 24px 0;
  border-top: 1px solid #e5e5e5;
  background: #ffffff;
}

.post-create-option {
  height: 56px;
  padding: 0 15px;
  box-sizing: border-box;
  border-bottom: 1px solid #e5e5e5;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.post-create-option__main {
  display: flex;
  align-items: center;
  gap: 15px;
}

.post-create-option__icon {
  width: 24px;
  height: 24px;
}

.post-create-option__label {
  color: #1a1a1a;
  font-size: 17px;
  line-height: 26px;
  font-weight: 400;
}

.post-create-option__chevron {
  width: 20px;
  height: 20px;
}

.post-create-bottom {
  padding: 12px 24px;
  box-sizing: border-box;
  background: #ffffff;
}

.post-create-bottom__publish {
  height: 48px;
  border-radius: 8px;
  background: #e5e5e5;
  color: #bfbfbf;
  text-align: center;
  font-size: 17px;
  line-height: 48px;
  font-weight: 500;
}

.post-create-bottom__publish--active {
  background: #00a63e;
  color: #ffffff;
}
</style>
