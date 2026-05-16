<template>
  <view class="contact-cover-banner">
    <image
      class="contact-cover-banner__hero"
      :src="displayImageUrl"
      mode="aspectFill"
      @longpress="showPicker"
      @tap="handleHeroTap"
    />

    <view v-if="isPickerVisible" class="contact-cover-banner__picker">
      <view class="contact-cover-banner__picker-grid">
        <view
          v-for="item in presetItems"
          :key="item.id"
          class="contact-cover-banner__thumb"
          :class="{ 'contact-cover-banner__thumb--active': item.imageUrl === displayImageUrl }"
          @tap="handlePresetTap(item)"
        >
          <image
            class="contact-cover-banner__thumb-image"
            :src="item.imageUrl"
            mode="aspectFill"
          />
        </view>

        <view
          class="contact-cover-banner__upload"
          :class="{
            'contact-cover-banner__upload--active': isCustomImageSelected,
            'contact-cover-banner__upload--loading': isBusy,
          }"
          @tap="handleUploadTap"
        >
          <view v-if="isBusy" class="contact-cover-banner__spinner" />
          <text v-else class="contact-cover-banner__upload-plus">+</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'ContactCoverBanner',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { buildOssMediaUrl } from '@tzl/shared'
import { computed, ref } from 'vue'
import { ApiException } from '../../api/api-exception'
import { uploadLocalImage } from '../../apis/storage'

interface ContactCoverPreset {
  id: string
  imageKey: string
  imageUrl: string
}

const CONTACT_COVER_PRESET_KEYS = [
  'weapp/cover1.png',
  'weapp/cover2.png',
  'weapp/cover3.png',
  'weapp/cover4.png',
  'weapp/cover5.png',
]

const presetItems = CONTACT_COVER_PRESET_KEYS.map((imageKey, index) => ({
  id: `preset-${index + 1}`,
  imageKey,
  imageUrl: buildOssMediaUrl(imageKey),
}))

const props = withDefaults(defineProps<{
  value?: string
  uploading?: boolean
}>(), {
  value: '',
  uploading: false,
})

const emit = defineEmits<{
  change: [imageReference: string]
  upload: [imageReference: string]
  error: [message: string]
  authExpired: [message: string]
}>()

const isUploading = ref(false)
const isPickerVisible = ref(false)
let longPressGuardTimer: ReturnType<typeof setTimeout> | null = null
let shouldIgnoreNextHeroTap = false

const fallbackImageUrl = computed(() => presetItems[0]?.imageUrl ?? '')
const configuredImageUrl = computed(() => resolveImageUrl(props.value))
const customImageUrl = computed(() => {
  return configuredImageUrl.value
})
const displayImageUrl = computed(() => {
  return configuredImageUrl.value || fallbackImageUrl.value
})
const isBusy = computed(() => props.uploading || isUploading.value)
const isCustomImageSelected = computed(() => {
  return Boolean(customImageUrl.value && !presetItems.some((item) => item.imageUrl === customImageUrl.value))
})

function resolveImageUrl(value: string | undefined) {
  const trimmed = value?.trim() ?? ''

  if (!trimmed) {
    return ''
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : buildOssMediaUrl(trimmed)
}

function handlePresetTap(item: ContactCoverPreset) {
  emit('change', item.imageKey)
  hidePicker()
}

function showPicker() {
  isPickerVisible.value = true
  shouldIgnoreNextHeroTap = true

  if (longPressGuardTimer) {
    clearTimeout(longPressGuardTimer)
  }

  longPressGuardTimer = setTimeout(() => {
    shouldIgnoreNextHeroTap = false
    longPressGuardTimer = null
  }, 350)
}

function hidePicker() {
  isPickerVisible.value = false
}

function handleHeroTap() {
  if (!isPickerVisible.value) {
    return
  }

  if (shouldIgnoreNextHeroTap) {
    shouldIgnoreNextHeroTap = false
    return
  }

  hidePicker()
}

function isUserCanceled(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'errMsg' in error &&
      String(error.errMsg).toLowerCase().includes('cancel'),
  )
}

async function editCoverImage(filePath: string) {
  const result = await Taro.editImage({
    src: filePath,
  })

  return result.tempFilePath
}

async function handleUploadTap() {
  if (isBusy.value) {
    return
  }

  isUploading.value = true

  try {
    const result = await Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album'],
    })
    const filePath = result.tempFilePaths[0]

    if (!filePath) {
      return
    }

    const editedFilePath = await editCoverImage(filePath)

    if (!editedFilePath) {
      return
    }

    const uploaded = await uploadLocalImage(editedFilePath, {
      folder: 'contact-covers',
      fileName: `contact_cover_${Date.now()}.jpg`,
    })

    emit('upload', uploaded.objectKey)
    hidePicker()
  } catch (error) {
    if (isUserCanceled(error)) {
      return
    }

    if (error instanceof ApiException && error.requiresReLogin) {
      emit('authExpired', error.message)
      return
    }

    emit(
      'error',
      error instanceof ApiException ? error.message : '封面上传失败，请稍后重试',
    )
  } finally {
    isUploading.value = false
  }
}
</script>

<style lang="scss">
.contact-cover-banner {
  background: #ffffff;
}

.contact-cover-banner__hero {
  display: block;
  width: 100%;
  height: 230px;
  box-sizing: border-box;
  background: #eef1f5;
}

.contact-cover-banner__picker {
  width: 100%;
  box-sizing: border-box;
  padding: 16px;
  background: #ffffff;
}

.contact-cover-banner__picker-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
}

.contact-cover-banner__thumb,
.contact-cover-banner__upload {
  width: 100%;
  aspect-ratio: 1 / 1;
  box-sizing: border-box;
  border: 2px solid transparent;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #d9d9d9;
}

.contact-cover-banner__thumb--active {
  border-color: #4f8cff;
}

.contact-cover-banner__upload--active {
  border-color: #4f8cff;
}

.contact-cover-banner__thumb-image {
  display: block;
  width: 100%;
  height: 100%;
}

.contact-cover-banner__upload {
  display: flex;
  align-items: center;
  justify-content: center;
  border-color: #b8b8b8;
  border-style: dashed;
  background: #f7f7f7;
}

.contact-cover-banner__upload--loading {
  border-style: solid;
}

.contact-cover-banner__upload-plus {
  font-size: 32px;
  line-height: 1;
  color: #9b9b9b;
}

.contact-cover-banner__spinner {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(0, 0, 0, 0.12);
  border-top-color: #555555;
  border-radius: 999px;
  animation: contact-cover-spin 0.8s linear infinite;
}

@keyframes contact-cover-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
