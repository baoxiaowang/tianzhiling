<template>
  <page-scaffold
    class="memorial-photo-page"
    background="#f7f7f7"
    bottom-background="#ffffff"
    body-padding="0"
    :scroll="true"
    :safe-area-top="false"
    require-auth
    auth-loading-text="正在恢复纪念合照信息..."
  >
    <template #header>
      <app-bar title="纪念合照" background="#f7f7f7" :show-capsule="true" />
    </template>

    <view v-if="isCheckingAuth || isResolvingConversation" class="memorial-photo-state">
      <view class="memorial-photo-state__dot" />
      <text class="memorial-photo-state__text">
        {{ isCheckingAuth ? '正在恢复登录...' : '正在准备会话...' }}
      </text>
    </view>

    <view v-else-if="loadError" class="memorial-photo-state">
      <text class="memorial-photo-state__title">暂时无法生成</text>
      <text class="memorial-photo-state__text">{{ loadError }}</text>
      <view class="memorial-photo-state__button" @tap="handleRetry">重试</view>
    </view>

    <view v-else class="memorial-photo">
      <view class="memorial-photo-section">
        <view class="memorial-photo-section__header">
          <text class="memorial-photo-section__title">TA 的照片</text>
          <text class="memorial-photo-section__count">{{ agentPhotos.length }}/3</text>
        </view>

        <view class="memorial-photo-grid">
          <view
            v-for="photo in agentPhotos"
            :key="photo.id"
            class="memorial-photo-tile"
          >
            <image
              class="memorial-photo-tile__image"
              :src="photo.url"
              mode="aspectFill"
              @tap="handlePreviewPhoto(photo.url)"
            />
            <view class="memorial-photo-tile__remove" @tap.stop="removeAgentPhoto(photo.id)">×</view>
          </view>

          <view
            v-if="agentPhotos.length < MAX_AGENT_PHOTO_COUNT"
            class="memorial-photo-add"
            :class="{ 'memorial-photo-add--disabled': isBusy }"
            @tap="handleChooseAgentPhotos"
          >
            <view v-if="isUploadingAgentPhotos" class="memorial-photo-spinner" />
            <view v-else class="memorial-photo-add__plus" />
          </view>
        </view>
      </view>

      <view class="memorial-photo-section">
        <view class="memorial-photo-section__header">
          <text class="memorial-photo-section__title">你的照片</text>
        </view>

        <view class="memorial-photo-grid memorial-photo-grid--single">
          <view v-if="userPhoto" class="memorial-photo-tile">
            <image
              class="memorial-photo-tile__image"
              :src="userPhoto.url"
              mode="aspectFill"
              @tap="handlePreviewPhoto(userPhoto.url)"
            />
            <view class="memorial-photo-tile__remove" @tap.stop="removeUserPhoto">×</view>
          </view>

          <view
            v-else
            class="memorial-photo-add"
            :class="{ 'memorial-photo-add--disabled': isBusy }"
            @tap="handleChooseUserPhoto"
          >
            <view v-if="isUploadingUserPhoto" class="memorial-photo-spinner" />
            <view v-else class="memorial-photo-add__plus" />
          </view>
        </view>
      </view>

      <view class="memorial-photo-section memorial-photo-prompt">
        <view class="memorial-photo-section__header memorial-photo-prompt__header">
          <view class="memorial-photo-prompt__title-group">
            <text class="memorial-photo-section__title">提示词</text>
          </view>
          <view class="memorial-photo-prompt__meta">
            <view
              class="memorial-photo-prompt-template__button"
              :class="{ 'memorial-photo-prompt-template__button--disabled': isBusy }"
              @tap.stop="handleOpenPromptTemplatePicker"
            >
              <view class="memorial-photo-prompt-template__button-icon" />
            </view>
          </view>
        </view>
        <view class="memorial-photo-prompt-template">
          <text class="memorial-photo-prompt-template__name">
            当前模板：{{ currentPromptTemplateTitle }}
          </text>
          <text class="memorial-photo-section__count">
            {{ customPromptLength }}/{{ MEMORIAL_CUSTOM_PROMPT_MAX_LENGTH }}
          </text>
        </view>
        <textarea
          class="memorial-photo-prompt__textarea"
          :value="customPrompt"
          :maxlength="MEMORIAL_CUSTOM_PROMPT_MAX_LENGTH"
          :disabled="isBusy"
          placeholder="可描述动作、表情、风格和场景，例如：两个人并肩坐在沙发上，微笑看向镜头，温暖真实照片风格"
          placeholder-class="memorial-photo-prompt__placeholder"
          :auto-height="false"
          cursor-spacing="16"
          @input="handleCustomPromptInput"
        />
      </view>

      <view v-if="generatedImageUrl" class="memorial-photo-result">
        <view class="memorial-photo-result__header">
          <text class="memorial-photo-result__title">生成结果</text>
          <text class="memorial-photo-result__tag">AI生成</text>
        </view>
        <image
          class="memorial-photo-result__image"
          :src="generatedImageUrl"
          mode="widthFix"
          @tap="handlePreviewPhoto(generatedImageUrl)"
        />
      </view>

      <view class="memorial-photo-agreement">
        <nut-checkbox
          v-model="isConsentChecked"
          shape="round"
          text-position="right"
          :icon-size="10"
        >
          我已获授权，并知晓图片由 AI 生成
        </nut-checkbox>
      </view>
    </view>

    <nut-popup
      v-model:visible="isPromptTemplatePickerVisible"
      class="memorial-photo-template-picker-popup"
      position="bottom"
      round
      :close-on-click-overlay="!isBusy"
    >
      <view class="memorial-photo-template-picker">
        <view class="memorial-photo-template-picker__header">
          <text class="memorial-photo-template-picker__title">选择提示词模板</text>
          <text class="memorial-photo-template-picker__close" @tap="closePromptTemplatePicker">
            取消
          </text>
        </view>
        <scroll-view scroll-y class="memorial-photo-template-picker__list">
          <view
            v-for="(template, index) in MEMORIAL_PROMPT_TEMPLATES"
            :key="template.title"
            class="memorial-photo-template-picker__item"
            :class="{
              'memorial-photo-template-picker__item--active':
                index === currentPromptTemplateIndex,
            }"
            @tap="handleSelectPromptTemplate(index)"
          >
            <text class="memorial-photo-template-picker__item-title">
              {{ template.title }}
            </text>
            <text class="memorial-photo-template-picker__item-desc">
              {{ template.prompt }}
            </text>
          </view>
        </scroll-view>
      </view>
    </nut-popup>

    <template #bottom>
      <view
        v-if="!loadError && !isCheckingAuth && !isResolvingConversation"
        class="memorial-photo-actions"
      >
        <nut-button
          v-if="generatedImageUrl"
          class="memorial-photo-actions__button memorial-photo-actions__button--secondary"
          block
          shape="round"
          :disabled="isBusy"
          @click="handleReturnToChat"
        >
          返回聊天
        </nut-button>
        <nut-button
          class="memorial-photo-actions__button"
          block
          shape="round"
          type="primary"
          :disabled="generatedImageUrl ? isBusy : !canGenerate"
          :loading="!generatedImageUrl && isGenerating"
          @click="generatedImageUrl ? handleOpenAlbum() : handleGenerate()"
        >
          {{ generatedImageUrl ? '查看聊天相册' : '生成合照' }}
        </nut-button>
      </view>
    </template>
  </page-scaffold>
</template>

<script lang="ts">
export default {
  name: 'MemorialPhotoPage',
}
</script>

<script setup lang="ts">
import Taro, { useLoad } from '@tarojs/taro'
import { computed, ref, shallowRef } from 'vue'
import { ApiConfig } from '../../api/api-config'
import { ApiException } from '../../api/api-exception'
import {
  generateConversationMemorialPhoto,
  getConversations,
  type ConversationImagePayload,
} from '../../apis/conversation'
import { uploadLocalImage } from '../../apis/storage'
import { clearAuthSession } from '../../auth/session'
import AppBar from '../../components/app-bar/app-bar.vue'
import PageScaffold from '../../components/page-scaffold/page-scaffold.vue'
import { ensureAuthenticatedSession, redirectToAuthPage } from '../../utils/auth-guard'

type UploadedPhoto = {
  id: string
  objectKey: string
  url: string
}

type PageStackEntry = {
  route?: string
}

declare function getCurrentPages(): PageStackEntry[]

const MAX_AGENT_PHOTO_COUNT = 3
const MEMORIAL_CUSTOM_PROMPT_MAX_LENGTH = 500
const MEMORIAL_PROMPT_TEMPLATES = [
  {
    title: '家中团圆饭',
    prompt:
      '温暖真实的家庭团圆饭场景，TA和我坐在餐桌旁，桌上有家常菜和热汤，两个人自然微笑看向镜头，室内暖光，像家人真实合照。',
  },
  {
    title: '客厅沙发聊天',
    prompt:
      'TA和我并肩坐在家里客厅沙发上，身体自然靠近，像平常聊天一样放松微笑，背景有柔和灯光和生活气息，真实照片风格。',
  },
  {
    title: '公园散步',
    prompt:
      '阳光明媚的公园里，TA和我一起慢慢散步，身边有树荫和小路，两个人自然看向镜头，表情温柔，纪实家庭照片风格。',
  },
  {
    title: '节日全家福',
    prompt:
      '节日团聚氛围，TA和我穿着整洁自然的衣服站在家中或院子里，背景有温馨节日装饰，两个人亲切微笑，像珍贵全家福。',
  },
  {
    title: '厨房一起做饭',
    prompt:
      'TA和我在家里厨房一起准备饭菜，桌面有食材和碗筷，TA自然地看着我或看向镜头，画面温暖、生活化、真实。',
  },
  {
    title: '生日陪伴',
    prompt:
      '温馨生日场景，TA和我坐在生日蛋糕旁，桌上有简单生日装饰和蜡烛，两个人自然微笑，像家人陪伴过生日的真实照片。',
  },
  {
    title: '院子晒太阳',
    prompt:
      '午后阳光下，TA和我坐在院子或阳台晒太阳，旁边有绿植和椅子，两个人放松地靠近，氛围安静、柔和、真实。',
  },
  {
    title: '旅行合影',
    prompt:
      'TA和我在旅行途中合影，背景是自然风景或城市街道，两个人肩并肩看向镜头，表情轻松开心，真实手机照片风格。',
  },
  {
    title: '温暖拥抱',
    prompt:
      'TA和我在温暖明亮的家中或户外阳光下自然拥抱，彼此靠近，表情安心温柔，画面真实细腻，表达家人之间久别重逢的陪伴与想念。',
  },
  {
    title: '牵手陪伴',
    prompt:
      'TA和我坐在安静温暖的室内或公园长椅上，轻轻牵着手或靠得很近，表情自然温柔，画面表达家人之间的陪伴与想念。',
  },
]

const conversationId = shallowRef('')
const agentId = shallowRef('')
const agentName = shallowRef('')
const agentPhotos = ref<UploadedPhoto[]>([])
const userPhoto = ref<UploadedPhoto | null>(null)
const customPrompt = shallowRef('')
const generatedImageUrl = shallowRef('')
const isCheckingAuth = shallowRef(true)
const isResolvingConversation = shallowRef(false)
const isUploadingAgentPhotos = shallowRef(false)
const isUploadingUserPhoto = shallowRef(false)
const isGenerating = shallowRef(false)
const isConsentChecked = shallowRef(false)
const currentPromptTemplateIndex = shallowRef(0)
const isPromptTemplatePickerVisible = shallowRef(false)
const loadError = shallowRef('')

const isBusy = computed(() => {
  return (
    isUploadingAgentPhotos.value ||
    isUploadingUserPhoto.value ||
    isGenerating.value
  )
})
const canGenerate = computed(() => {
  return (
    Boolean(conversationId.value) &&
    agentPhotos.value.length > 0 &&
    Boolean(userPhoto.value?.objectKey) &&
    isConsentChecked.value &&
    !isUploadingAgentPhotos.value &&
    !isUploadingUserPhoto.value &&
    !isGenerating.value
  )
})
const customPromptLength = computed(() => customPrompt.value.trim().length)
const currentPromptTemplateTitle = computed(() => {
  return MEMORIAL_PROMPT_TEMPLATES[currentPromptTemplateIndex.value]?.title ?? '自定义'
})

useLoad((options) => {
  conversationId.value = decodeRouteParam(options?.conversationId)
  agentId.value = decodeRouteParam(options?.agentId)
  agentName.value = decodeRouteParam(options?.agentName)
  void preparePage()
})

function decodeRouteParam(value?: string) {
  if (typeof value !== 'string') {
    return ''
  }

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function preparePage() {
  isCheckingAuth.value = true
  const authenticated = await ensureAuthenticatedSession()

  if (!authenticated) {
    await redirectToAuthPage()
    return
  }

  applyPromptTemplate(currentPromptTemplateIndex.value)
  isCheckingAuth.value = false
  await resolveConversation()
}

async function resolveConversation() {
  if (conversationId.value) {
    loadError.value = ''
    return
  }

  if (!agentId.value) {
    loadError.value = '缺少会话信息，请返回通讯录重新进入'
    return
  }

  isResolvingConversation.value = true
  loadError.value = ''

  try {
    const conversations = await getConversations()
    const matchedConversation = conversations.find((conversation) => {
      return conversation.agentId === agentId.value
    })
    conversationId.value = matchedConversation?.id ?? ''

    if (!conversationId.value) {
      loadError.value = '缺少会话信息，请返回通讯录重新进入'
    }
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await clearAuthSession()
      await redirectToAuthPage()
      return
    }

    loadError.value =
      error instanceof ApiException
        ? error.message
        : '会话信息加载失败，请稍后重试'
  } finally {
    isResolvingConversation.value = false
  }
}

function handleRetry() {
  void resolveConversation()
}

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

async function handleChooseAgentPhotos() {
  if (isBusy.value || agentPhotos.value.length >= MAX_AGENT_PHOTO_COUNT) {
    return
  }

  try {
    const remainingCount = MAX_AGENT_PHOTO_COUNT - agentPhotos.value.length
    const result = await Taro.chooseImage({
      count: remainingCount,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
    })
    const filePaths = result.tempFilePaths.filter(Boolean)

    if (!filePaths.length) {
      return
    }

    isUploadingAgentPhotos.value = true
    const uploads = await Promise.all(
      filePaths.map((filePath) =>
        uploadLocalImage(filePath, {
          folder: 'memorial-source-photos',
        })
      )
    )
    const nextPhotos = uploads
      .map((uploaded) => buildUploadedPhoto(uploaded.objectKey, uploaded.publicUrl))
      .filter((photo): photo is UploadedPhoto => Boolean(photo))

    agentPhotos.value = [...agentPhotos.value, ...nextPhotos].slice(
      0,
      MAX_AGENT_PHOTO_COUNT
    )
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuthPage()
      return
    }

    if (!isChooseImageCancel(error)) {
      showToast(error instanceof ApiException ? error.message : '图片上传失败，请稍后重试')
    }
  } finally {
    isUploadingAgentPhotos.value = false
  }
}

async function handleChooseUserPhoto() {
  if (isBusy.value) {
    return
  }

  try {
    const result = await Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
    })
    const filePath = result.tempFilePaths.find(Boolean)

    if (!filePath) {
      return
    }

    isUploadingUserPhoto.value = true
    const uploaded = await uploadLocalImage(filePath, {
      folder: 'memorial-source-photos',
    })
    userPhoto.value = buildUploadedPhoto(uploaded.objectKey, uploaded.publicUrl)
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuthPage()
      return
    }

    if (!isChooseImageCancel(error)) {
      showToast(error instanceof ApiException ? error.message : '图片上传失败，请稍后重试')
    }
  } finally {
    isUploadingUserPhoto.value = false
  }
}

function buildUploadedPhoto(objectKey: string, url: string): UploadedPhoto | null {
  const normalizedObjectKey = objectKey.trim()
  const normalizedUrl = url.trim() || buildObjectKeyUrl(normalizedObjectKey)

  if (!normalizedObjectKey || !normalizedUrl) {
    return null
  }

  return {
    id: `${normalizedObjectKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    objectKey: normalizedObjectKey,
    url: normalizedUrl,
  }
}

function removeAgentPhoto(photoId: string) {
  if (isBusy.value) {
    return
  }

  agentPhotos.value = agentPhotos.value.filter((photo) => photo.id !== photoId)
}

function removeUserPhoto() {
  if (isBusy.value) {
    return
  }

  userPhoto.value = null
}

function handleCustomPromptInput(event: { detail?: { value?: string } }) {
  const value = String(event.detail?.value ?? '')
  customPrompt.value = value.slice(0, MEMORIAL_CUSTOM_PROMPT_MAX_LENGTH)
}

function handleOpenPromptTemplatePicker() {
  if (isBusy.value) {
    return
  }

  isPromptTemplatePickerVisible.value = true
}

function closePromptTemplatePicker() {
  if (isBusy.value) {
    return
  }

  isPromptTemplatePickerVisible.value = false
}

function handleSelectPromptTemplate(index: number) {
  if (isBusy.value) {
    return
  }

  applyPromptTemplate(index)
  isPromptTemplatePickerVisible.value = false
}

function applyPromptTemplate(index: number) {
  const template = MEMORIAL_PROMPT_TEMPLATES[index]

  if (!template) {
    return
  }

  currentPromptTemplateIndex.value = index
  customPrompt.value = template.prompt.slice(0, MEMORIAL_CUSTOM_PROMPT_MAX_LENGTH)
}

async function handleGenerate() {
  if (!canGenerate.value || !userPhoto.value) {
    if (!isConsentChecked.value) {
      showToast('请先确认照片授权')
    }
    return
  }

  isGenerating.value = true

  try {
    const generatedMessage = await generateConversationMemorialPhoto(
      conversationId.value,
      {
        agentPhotoObjectKeys: agentPhotos.value.map((photo) => photo.objectKey),
        userPhotoObjectKey: userPhoto.value.objectKey,
        customPrompt: customPrompt.value.trim() || undefined,
      },
    )
    const nextImageUrl = resolveImageMessageUrl(generatedMessage.image)

    if (!nextImageUrl) {
      throw new ApiException('生成结果暂不可查看，请稍后到聊天相册刷新')
    }

    generatedImageUrl.value = nextImageUrl
    showToast('已保存到聊天相册')
  } catch (error) {
    if (error instanceof ApiException && error.requiresReLogin) {
      await redirectToAuthPage()
      return
    }

    showToast(error instanceof ApiException ? error.message : '合照生成失败，请稍后重试')
  } finally {
    isGenerating.value = false
  }
}

function handlePreviewPhoto(url: string) {
  const currentUrl = url.trim()

  if (!currentUrl) {
    return
  }

  const urls = [
    ...agentPhotos.value.map((photo) => photo.url),
    ...(userPhoto.value?.url ? [userPhoto.value.url] : []),
    ...(generatedImageUrl.value ? [generatedImageUrl.value] : []),
  ].filter(Boolean)

  void Taro.previewImage({
    current: currentUrl,
    urls,
  })
}

async function handleOpenAlbum() {
  const resolvedConversationId = conversationId.value

  if (!resolvedConversationId) {
    showToast('缺少会话信息，请返回通讯录重新进入')
    return
  }

  const query = [
    ['conversationId', resolvedConversationId],
    ['agentId', agentId.value],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  await Taro.navigateTo({
    url: `/pages/chat-album/index?${query}`,
  })
}

async function handleReturnToChat() {
  if (isBusy.value) {
    return
  }

  if (getPreviousPageRoute() === 'pages/chat/index') {
    try {
      await Taro.navigateBack()
      return
    } catch {
      // Fall back to direct chat navigation below.
    }
  }

  await redirectToChatPage()
}

function getPreviousPageRoute() {
  if (typeof getCurrentPages !== 'function') {
    return ''
  }

  const pages = getCurrentPages()
  const previousPage = pages[pages.length - 2]

  return normalizePageRoute(previousPage?.route)
}

function normalizePageRoute(route?: string) {
  return route?.trim().replace(/^\/+/, '') ?? ''
}

async function redirectToChatPage() {
  const url = buildChatPageUrl()

  if (!url) {
    showToast('缺少会话信息，请返回通讯录重新进入')
    return
  }

  await Taro.redirectTo({ url })
}

function buildChatPageUrl() {
  const resolvedConversationId = conversationId.value

  if (!resolvedConversationId) {
    return ''
  }

  const query = [
    ['conversationId', resolvedConversationId],
    ['agentId', agentId.value],
    ['agentName', agentName.value],
  ]
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return `/pages/chat/index?${query}`
}

function resolveImageMessageUrl(image?: ConversationImagePayload) {
  const directUrl = image?.url?.trim()
  if (directUrl) {
    return directUrl
  }

  const objectKey = image?.objectKey?.trim()
  return buildObjectKeyUrl(objectKey)
}

function buildObjectKeyUrl(objectKey?: string) {
  const value = objectKey?.trim()

  if (!value || !ApiConfig.mediaBaseUrl) {
    return ''
  }

  const encodedKey = value
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  return `${ApiConfig.mediaBaseUrl}/${encodedKey}`
}
</script>

<style lang="scss">
.memorial-photo-page {
  min-height: 100vh;
}

.memorial-photo-state {
  min-height: calc(100vh - 160px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}

.memorial-photo-state__dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: $tzl-gradient-primary;
  box-shadow: $tzl-shadow-primary-sm;
}

.memorial-photo-state__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.memorial-photo-state__text {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.memorial-photo-state__button {
  margin-top: 8px;
  padding: 8px 18px;
  border-radius: 12px;
  color: #ffffff;
  font-size: 14px;
  line-height: 20px;
  background: #111111;
}

.memorial-photo {
  padding: 12px 12px 120px;
  box-sizing: border-box;
}

.memorial-photo-section,
.memorial-photo-result,
.memorial-photo-agreement {
  margin-bottom: 10px;
  padding: 14px;
  border-radius: 8px;
  background: #ffffff;
  box-sizing: border-box;
}

.memorial-photo-section__header,
.memorial-photo-result__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.memorial-photo-section__title,
.memorial-photo-result__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.memorial-photo-section__count {
  color: #8a8f98;
  font-size: 13px;
  line-height: 18px;
}

.memorial-photo-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.memorial-photo-grid--single {
  grid-template-columns: repeat(3, 1fr);
}

.memorial-photo-tile,
.memorial-photo-add {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  box-sizing: border-box;
  background: #f2f4f7;
}

.memorial-photo-tile__image {
  width: 100%;
  height: 100%;
  display: block;
}

.memorial-photo-tile__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: #ffffff;
  font-size: 16px;
  line-height: 20px;
  background: rgba(0, 0, 0, 0.48);
}

.memorial-photo-add {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #cfd4dc;
}

.memorial-photo-add--disabled {
  opacity: 0.62;
}

.memorial-photo-add__plus {
  position: relative;
  width: 28px;
  height: 28px;
}

.memorial-photo-add__plus::before,
.memorial-photo-add__plus::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 24px;
  height: 2px;
  border-radius: 999px;
  background: #98a2b3;
  transform: translate(-50%, -50%);
}

.memorial-photo-add__plus::after {
  transform: translate(-50%, -50%) rotate(90deg);
}

.memorial-photo-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(34, 197, 94, 0.18);
  border-top-color: #22c55e;
  border-radius: 50%;
  animation: memorial-photo-spinner 0.9s linear infinite;
}

.memorial-photo-result__tag {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  color: #15803d;
  font-size: 12px;
  line-height: 16px;
  background: #dcfce7;
}

.memorial-photo-result__image {
  width: 100%;
  display: block;
  border-radius: 8px;
  background: #f2f4f7;
}

.memorial-photo-prompt__textarea {
  width: 100%;
  height: 96px;
  padding: 10px 12px;
  border-radius: 8px;
  color: #111111;
  font-size: 14px;
  line-height: 21px;
  background: #f6f7f9;
  box-sizing: border-box;
}

.memorial-photo-prompt__header {
  margin-bottom: 12px;
  align-items: flex-start;
}

.memorial-photo-prompt__title-group,
.memorial-photo-prompt__meta {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.memorial-photo-prompt__title-group {
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.memorial-photo-prompt__meta {
  flex-shrink: 0;
  justify-content: flex-end;
}

.memorial-photo-prompt__placeholder {
  color: #98a2b3;
}

.memorial-photo-prompt-template {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.memorial-photo-prompt-template__name {
  min-width: 0;
  flex: 1;
  color: #98a2b3;
  font-size: 12px;
  line-height: 18px;
}

.memorial-photo-prompt-template__button {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #eaf3ff;
}

.memorial-photo-prompt-template__button-icon {
  position: relative;
  width: 15px;
  height: 13px;
  border-top: 2px solid #1677ff;
  border-bottom: 2px solid #1677ff;
  box-sizing: border-box;
}

.memorial-photo-prompt-template__button-icon::before,
.memorial-photo-prompt-template__button-icon::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  border-radius: 999px;
  background: #1677ff;
}

.memorial-photo-prompt-template__button-icon::before {
  top: 4px;
}

.memorial-photo-prompt-template__button-icon::after {
  top: 8px;
}

.memorial-photo-prompt-template__button--disabled {
  opacity: 0.55;
}

.memorial-photo-agreement {
  color: #667085;
  font-size: 12px;
  line-height: 18px;
}

.memorial-photo-agreement .nut-checkbox {
  align-items: center;
}

.memorial-photo-agreement .nut-checkbox__label {
  min-width: 0;
  line-height: 18px;
  white-space: nowrap;
}

.memorial-photo-template-picker-popup {
  overflow: hidden;
  background: transparent;
}

.memorial-photo-template-picker {
  height: 64vh;
  overflow: hidden;
  border-radius: 16px 16px 0 0;
  background: #ffffff;
}

.memorial-photo-template-picker__header {
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  box-sizing: border-box;
  border-bottom: 1px solid #f0f0f0;
}

.memorial-photo-template-picker__title {
  color: #111111;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.memorial-photo-template-picker__close {
  color: #8a8f98;
  font-size: 14px;
  line-height: 20px;
}

.memorial-photo-template-picker__list {
  height: calc(64vh - 52px);
  padding: 8px 12px calc(12px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.memorial-photo-template-picker__item {
  padding: 10px 12px;
  border-radius: 8px;
  background: #ffffff;
}

.memorial-photo-template-picker__item + .memorial-photo-template-picker__item {
  margin-top: 6px;
}

.memorial-photo-template-picker__item--active {
  background: #f0f7ff;
}

.memorial-photo-template-picker__item-title {
  display: block;
  color: #111111;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
}

.memorial-photo-template-picker__item-desc {
  display: block;
  margin-top: 4px;
  color: #667085;
  font-size: 12px;
  line-height: 18px;
}

.memorial-photo-actions {
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  box-sizing: border-box;
}

.memorial-photo-actions__button {
  flex: 1;
  min-width: 0;
  --nut-button-border-radius: 999px;
  --nut-button-primary-background-color: #{$tzl-gradient-primary};
  --nut-button-primary-border-color: transparent;
}

.memorial-photo-actions__button--secondary {
  --nut-button-default-border-color: #e5e7eb;
  --nut-button-default-color: #344054;
  --nut-button-default-background-color: #ffffff;
}

.memorial-photo-actions__button .nut-button__text {
  font-weight: 600;
}

@keyframes memorial-photo-spinner {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
