<template>
  <view class="custom-bg-banner" :class="{ 'is-open': isPanelOpen }">
    <!-- Big Image -->
    <image
      class="custom-bg-banner__main-image"
      :src="currentBg"
      mode="aspectFill"
      @tap="togglePanel"
    />

    <!-- Thumbnails Panel -->
    <view class="custom-bg-banner__panel-wrapper" :class="{ 'is-open': isPanelOpen }">
      <view class="custom-bg-banner__panel">
        <view class="custom-bg-banner__list">
          <image
            v-for="(preset, index) in presets"
            :key="index"
            class="custom-bg-banner__thumb"
            :class="{ 'custom-bg-banner__thumb--active': currentBg === preset }"
            :src="preset"
            mode="aspectFill"
            @tap="selectBg(preset)"
          />
          <view 
            class="custom-bg-banner__upload"
            :class="{ 'custom-bg-banner__thumb--active': currentBg === uploadedBg && uploadedBg }"
            @tap="uploadedBg && currentBg !== uploadedBg ? selectBg(uploadedBg) : handleUpload()"
          >
            <image
              v-if="uploadedBg"
              class="custom-bg-banner__upload-img"
              :src="uploadedBg"
              mode="aspectFill"
            />
            <text class="custom-bg-banner__plus">+</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script lang="ts">
export default {
  name: 'TopPromoBanner',
}
</script>

<script setup lang="ts">
import Taro from '@tarojs/taro'
import { ref, onMounted } from 'vue'

const STORAGE_KEY = 'contacts_bg_image'
const UPLOADED_BG_KEY = 'contacts_uploaded_bg'
const presets = [
  require('../../assets/images/chat-background-1.png'),
  require('../../assets/images/chat-background-2.png'),
  require('../../assets/images/chat-background-3.png'),
  require('../../assets/images/chat-background-4.png'),
  require('../../assets/images/chat-background-5.png'),
];

const currentBg = ref(presets[0])
const uploadedBg = ref('')
const isPanelOpen = ref(false)

onMounted(() => {
  const savedBg = Taro.getStorageSync(STORAGE_KEY)
  const savedUploadedBg = Taro.getStorageSync(UPLOADED_BG_KEY)

  if (savedUploadedBg) {
    uploadedBg.value = savedUploadedBg
  }

  if (savedBg) {
    currentBg.value = savedBg
  }
})

function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value
}

defineExpose({
  openPanel: () => { isPanelOpen.value = true },
  closePanel: () => { isPanelOpen.value = false },
})

function selectBg(url: string) {
  currentBg.value = url
  Taro.setStorageSync(STORAGE_KEY, url)
}

async function handleUpload() {
  try {
    const res = await Taro.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
    })
    
    const tempFilePath = res.tempFiles[0].tempFilePath

    // 进入简单编辑界面 (微信原生图片编辑)
    const editRes = await Taro.editImage({
      src: tempFilePath,
    })

    const finalPath = editRes.tempFilePath
    
    // 保存到本地文件系统以确保持久化
    const fs = Taro.getFileSystemManager()
    fs.saveFile({
      tempFilePath: finalPath,
      success: (saveRes) => {
        uploadedBg.value = saveRes.savedFilePath
        currentBg.value = saveRes.savedFilePath
        Taro.setStorageSync(STORAGE_KEY, saveRes.savedFilePath)
        Taro.setStorageSync(UPLOADED_BG_KEY, saveRes.savedFilePath)
      },
      fail: () => {
        // 保存失败直接用临时路径作为 fallback
        uploadedBg.value = finalPath
        currentBg.value = finalPath
        Taro.setStorageSync(STORAGE_KEY, finalPath)
        Taro.setStorageSync(UPLOADED_BG_KEY, finalPath)
      }
    })
  } catch (e) {
    console.log('用户取消或上传失败', e)
  }
}
</script>

<style lang="scss">
.custom-bg-banner {
  background: #fff;
  position: relative;
  padding-top: 0;
  transition: padding-top 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.custom-bg-banner.is-open {
  padding-top: 88px;
}

.custom-bg-banner__main-image {
  width: 100%;
  height: 220px;
  display: block;
}

.custom-bg-banner__panel-wrapper {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: #ffffff;
}

.custom-bg-banner__panel-wrapper.is-open {
  max-height: 120px; /* 足以容纳内部内容的最大高度 */
  border-bottom: 1px solid #f0f2f5;
}

.custom-bg-banner__panel {
  padding: 16px;
  box-sizing: border-box;
}

.custom-bg-banner__list {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.custom-bg-banner__thumb,
.custom-bg-banner__upload {
  width: calc((100vw - 92px) / 6);
  height: calc((100vw - 92px) / 6);
  border-radius: 8px;
  box-sizing: border-box;
}

.custom-bg-banner__thumb {
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.custom-bg-banner__thumb--active {
  border-color: $tzl-color-primary;
}

.custom-bg-banner__upload {
  border: 1px dashed #d1d5db;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f9fafb;
  position: relative;
  overflow: hidden;
  transition: all 0.2s ease;
}

.custom-bg-banner__upload.custom-bg-banner__thumb--active {
  border: 2px solid $tzl-color-primary;
  border-style: solid; /* 选中时变成实线边框 */
}

.custom-bg-banner__upload-img {
  width: 100%;
  height: 100%;
  display: block;
}

.custom-bg-banner__plus {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px;
  color: #9ca3af;
  font-weight: 300;
  line-height: 1;
  margin-top: -2px;
}
</style>
