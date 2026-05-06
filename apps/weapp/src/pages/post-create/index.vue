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
          <view class="post-create-add__plus" />
        </view>
      </view>

      <view v-else class="post-create-add" @tap="handleChooseImages">
        <view class="post-create-add__plus" />
      </view>
    </view>

    <view class="post-create-options">
      <view class="post-create-option" @tap="handleAgentPickerTap">
        <view class="post-create-option__main">
          <view class="post-create-option__icon post-create-option__icon--at">@</view>
          <text class="post-create-option__label">天之灵</text>
        </view>
        <view class="post-create-option__right">
          <text v-if="selectedAgent" class="post-create-option__value">{{ selectedAgent.name }}</text>
          <image class="post-create-option__chevron" :src="chevronIconUrl" mode="aspectFit" />
        </view>
      </view>

      <view class="post-create-option" @tap="handleVisibilityTap">
        <view class="post-create-option__main">
          <view class="post-create-option__icon post-create-option__icon--lock">
            <view class="post-create-option__lock-shackle" />
            <view class="post-create-option__lock-body" />
          </view>
          <text class="post-create-option__label">可见范围</text>
        </view>
        <view class="post-create-option__right">
          <text class="post-create-option__value">{{ visibilityLabel }}</text>
          <image class="post-create-option__chevron" :src="chevronIconUrl" mode="aspectFit" />
        </view>
      </view>
    </view>

    <nut-popup
      v-model:visible="agentPickerVisible"
      class="post-agent-picker-popup"
      position="bottom"
      round
      :safe-area-inset-bottom="true"
    >
      <view class="post-agent-picker">
        <view class="post-agent-picker__header">
          <text class="post-agent-picker__cancel" @tap="closeAgentPicker">取消</text>
          <text class="post-agent-picker__title">选择天之灵</text>
          <text class="post-agent-picker__confirm" @tap="confirmAgentPicker">确定</text>
        </view>

        <view v-if="isAgentsLoading" class="post-agent-picker__state">正在加载...</view>
        <view v-else-if="agentsLoadError" class="post-agent-picker__state">
          <text>{{ agentsLoadError }}</text>
          <text class="post-agent-picker__retry" @tap="loadAgents">重试</text>
        </view>
        <view v-else-if="!agents.length" class="post-agent-picker__state">暂无天之灵</view>
        <scroll-view v-else scroll-y class="post-agent-picker__list">
          <view
            v-for="agent in agents"
            :key="agent.id"
            class="post-agent-picker__item"
            @tap="selectDraftAgent(agent.id)"
          >
            <image
              v-if="agent.avatar"
              class="post-agent-picker__avatar"
              :src="agent.avatar"
              mode="aspectFill"
            />
            <view v-else class="post-agent-picker__avatar post-agent-picker__avatar--fallback">
              {{ buildAgentFallback(agent.name) }}
            </view>
            <text class="post-agent-picker__name">{{ agent.name || '未命名天之灵' }}</text>
            <view
              class="post-agent-picker__radio"
              :class="{ 'post-agent-picker__radio--checked': draftSelectedAgentId === agent.id }"
            >
              <view class="post-agent-picker__radio-dot" />
            </view>
          </view>
        </scroll-view>
      </view>
    </nut-popup>

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
import { getAgents, type AgentSummary } from '../../apis/agent'
import { uploadLocalImage } from '../../apis/storage'
import { ApiException } from '../../api/api-exception'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'
import { readMenuButtonMetrics } from '../../utils/menu-button'

const chevronIconUrl = 'https://www.figma.com/api/mcp/asset/8282532d-5461-450c-9288-bb6e6d9d8a2c'

type PostVisibility = 'public' | 'private'

const maxImageCount = 9
const content = ref('')
const images = ref<string[]>([])
const agents = ref<AgentSummary[]>([])
const selectedAgentId = ref('')
const draftSelectedAgentId = ref('')
const visibility = ref<PostVisibility>('public')
const isAgentsLoading = ref(false)
const agentsLoadError = ref('')
const agentPickerVisible = ref(false)
const isUploading = ref(false)
const isSubmitting = ref(false)
const menuButtonMetrics = readMenuButtonMetrics()
const statusStyle = {
  height: `${menuButtonMetrics.statusBarHeight}px`,
}

const canSubmit = computed(() => {
  return content.value.trim().length > 0 || images.value.length > 0
})
const selectedAgent = computed(() => {
  return agents.value.find((agent) => agent.id === selectedAgentId.value) ?? null
})
const visibilityLabel = computed(() => {
  return visibility.value === 'private' ? '私密' : '公开'
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

function buildAgentFallback(name: string) {
  const trimmedName = name.trim()
  return trimmedName ? trimmedName.slice(0, 1) : '灵'
}

async function loadAgents() {
  if (isAgentsLoading.value) {
    return
  }

  isAgentsLoading.value = true
  agentsLoadError.value = ''

  try {
    agents.value = await getAgents()
    if (!selectedAgentId.value) {
      selectedAgentId.value = agents.value.find((agent) => agent.isDefault)?.id ?? ''
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuthPage()
      return
    }

    agentsLoadError.value = error instanceof ApiException
      ? error.message
      : '天之灵加载失败'
  } finally {
    isAgentsLoading.value = false
  }
}

async function handleAgentPickerTap() {
  draftSelectedAgentId.value = selectedAgentId.value
  agentPickerVisible.value = true

  if (!agents.value.length) {
    await loadAgents()
  }
}

function closeAgentPicker() {
  agentPickerVisible.value = false
}

function selectDraftAgent(agentId: string) {
  draftSelectedAgentId.value = draftSelectedAgentId.value === agentId ? '' : agentId
}

function confirmAgentPicker() {
  selectedAgentId.value = draftSelectedAgentId.value
  agentPickerVisible.value = false
}

async function handleVisibilityTap() {
  try {
    const result = await Taro.showActionSheet({
      itemList: ['公开', '私密'],
    })
    visibility.value = result.tapIndex === 1 ? 'private' : 'public'
  } catch (error) {
    if (!isChooseImageCancel(error)) {
      showToast('可见范围选择失败，请稍后重试')
    }
  }
}

async function handleCancel() {
  await Taro.navigateBack()
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
      remindAgentIds: selectedAgentId.value ? [selectedAgentId.value] : [],
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

.post-create-add__plus {
  position: relative;
  width: 42px;
  height: 42px;
}

.post-create-add__plus::before,
.post-create-add__plus::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 36px;
  height: 3px;
  border-radius: 999px;
  background: #737373;
  transform: translate(-50%, -50%);
}

.post-create-add__plus::after {
  transform: translate(-50%, -50%) rotate(90deg);
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
  flex-shrink: 0;
  width: 24px;
  height: 24px;
}

.post-create-option__icon--at {
  color: #1f2937;
  text-align: center;
  font-size: 25px;
  line-height: 24px;
  font-weight: 500;
}

.post-create-option__icon--lock {
  position: relative;
}

.post-create-option__lock-shackle {
  position: absolute;
  left: 6px;
  top: 1px;
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 2px solid #333333;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
}

.post-create-option__lock-body {
  position: absolute;
  left: 4px;
  top: 10px;
  width: 16px;
  height: 12px;
  box-sizing: border-box;
  border: 2px solid #333333;
  border-radius: 4px;
}

.post-create-option__label {
  color: #1a1a1a;
  font-size: 17px;
  line-height: 26px;
  font-weight: 400;
}

.post-create-option__right {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.post-create-option__value {
  max-width: 180px;
  overflow: hidden;
  color: #8c8c8c;
  font-size: 16px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-create-option__chevron {
  width: 20px;
  height: 20px;
}

.post-agent-picker {
  min-height: 40vh;
  overflow: hidden;
  background: #ffffff;
}

.post-agent-picker__header {
  height: 56px;
  padding: 0 18px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f0f0f0;
}

.post-agent-picker__title {
  color: #111827;
  font-size: 17px;
  line-height: 24px;
  font-weight: 600;
}

.post-agent-picker__cancel,
.post-agent-picker__confirm {
  min-width: 48px;
  color: #6b7280;
  font-size: 16px;
  line-height: 24px;
}

.post-agent-picker__confirm {
  color: $tzl-color-primary;
  text-align: right;
  font-weight: 600;
}

.post-agent-picker__state {
  min-height: 180px;
  padding: 32px 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #8c8c8c;
  font-size: 15px;
  line-height: 22px;
}

.post-agent-picker__retry {
  color: $tzl-color-primary;
  font-weight: 600;
}

.post-agent-picker__list {
  max-height: 360px;
}

.post-agent-picker__item {
  min-height: 64px;
  padding: 8px 18px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #f5f5f5;
}

.post-agent-picker__avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: #eef2f7;
}

.post-agent-picker__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 18px;
  font-weight: 700;
  background: linear-gradient(135deg, #ffd9e5 0%, #ff8daa 100%);
}

.post-agent-picker__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #1a1a1a;
  font-size: 16px;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-agent-picker__radio {
  width: 22px;
  height: 22px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid #d1d5db;
  border-radius: 999px;
}

.post-agent-picker__radio--checked {
  border-color: $tzl-color-primary;
}

.post-agent-picker__radio-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: transparent;
}

.post-agent-picker__radio--checked .post-agent-picker__radio-dot {
  background: $tzl-color-primary;
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
